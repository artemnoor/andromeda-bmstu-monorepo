(() => {
  const STORAGE = {
    favorites: "andromeda.favorites.v1",
    compare: "andromeda.compare.v1",
    profile: "andromeda.applicant.v1",
  };

  const pending = {};

  function readStore(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeStore(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function cached(name, factory) {
    if (pending[name]) return pending[name];
    pending[name] = factory().catch((error) => {
      delete pending[name];
      throw error;
    });
    return pending[name];
  }

  async function readSnapshot(path, pick = asArray) {
    const response = await fetch(path, { cache: "no-cache" });
    if (!response.ok) throw new Error(`Database snapshot ${response.status}`);
    const data = pick(await response.json());
    if (!data || (Array.isArray(data) && !data.length)) throw new Error("Empty database snapshot");
    return data;
  }

  function sourceUrl(record) {
    return text(record?.source_url)
      || text(record?.sources?.find((source) => text(source?.source_url))?.source_url)
      || text(record?.evidence?.find((item) => text(item?.claim))?.sources?.find((source) => text(source?.source_url))?.source_url);
  }

  function mapLiveProgram(record, directions, departments) {
    const direction = directions.get(record.direction_key);
    const relation = (record.department_relations || []).find((item) => item.verification_status === "verified")
      || (record.department_relations || [])[0];
    const department = relation ? departments.get(relation.department_key) : null;
    return {
      ...record,
      direction_code: text(direction?.code),
      direction: text(direction?.name),
      department_code: text(department?.official_code || department?.code),
      department: text(department?.name),
      source_url: sourceUrl(record),
      study_plan: {},
      catalog_course_names: Array.isArray(record.catalog_course_names) ? record.catalog_course_names : [],
    };
  }

  function loadPrograms() {
    return cached("programs", async () => {
      const api = window.AcademicData;
      if (!api) throw new Error("Academic Data client is unavailable");
      const records = await api.programs();
      if (api.isDemoMode?.()) return { data: records, source: "demo" };
      const [directionRows, departmentRows] = await Promise.all([
        api.list("/v1/directions"),
        api.list("/v1/departments"),
      ]);
      const directions = new Map(directionRows.map((item) => [item.external_key, item]));
      const departments = new Map(departmentRows.map((item) => [item.external_key, item]));
      return { data: records.map((item) => mapLiveProgram(item, directions, departments)), source: "api" };
    });
  }

  function mapCurriculumItem(item, plan) {
    return {
      external_key: item.external_key,
      program_key: plan.program_key,
      program_code: plan.profile_code,
      curriculum_key: plan.external_key,
      education_year: plan.academic_year,
      row_no: item.ordinal,
      discipline: item.discipline_name,
      semester: item.semester,
      credits: item.credits,
      hours: item.total_hours ?? item.hours,
      lecture_hours: item.lecture_hours,
      practice_hours: item.practice_hours,
      lab_hours: item.lab_hours,
      self_study_hours: item.self_study_hours,
      assessment_type: item.control_form,
      subject_classification: item.subject_classification || null,
      source_url: sourceUrl(item),
    };
  }

  function loadCurriculum() {
    return cached("curriculum", async () => {
      const api = window.AcademicData;
      if (!api) throw new Error("Academic Data client is unavailable");
      if (api.isDemoMode?.()) return { data: await readSnapshot("data/curriculum.json"), source: "demo" };
      const plans = await api.list("/v1/study-plans");
      const parsedPlans = plans.filter((plan) => plan.status === "parsed");
      const groups = await loadLiveCurriculumPlans(api, parsedPlans);
      return {
        data: groups.flatMap((group) => group.rows),
        plans,
        source: "api",
        failedPlans: groups.filter((group) => group.failed).length,
      };
    });
  }

  async function loadLiveCurriculumPlans(api, plans) {
    const groups = new Array(plans.length);
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < plans.length) {
        const index = nextIndex++;
        const plan = plans[index];
        try {
          const items = await api.list(`/v1/study-plans/${encodeURIComponent(plan.external_key)}/items`);
          groups[index] = { plan, rows: items.map((item) => mapCurriculumItem(item, plan)) };
        } catch (error) {
          groups[index] = { plan, rows: [], failed: true, error };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, plans.length) }, worker));
    return groups;
  }

  async function loadCurriculumForProgram(programKey) {
    const key = text(programKey);
    if (!key) return { data: [], source: window.AcademicData?.isDemoMode?.() ? "demo" : "api" };
    return cached(`curriculum:${key}`, async () => {
      if (pending.programs) await pending.programs;
      const api = window.AcademicData;
      if (!api) throw new Error("Academic Data client is unavailable");
      if (api.isDemoMode?.()) {
        const snapshot = await loadCurriculum();
        return {
          data: snapshot.data.filter((item) => item.program_key === key || item.program_code === key),
          plans: [],
          source: "demo",
        };
      }
      const plans = await api.list("/v1/study-plans", { program_key: key });
      const groups = await loadLiveCurriculumPlans(api, plans.filter((plan) => plan.status === "parsed"));
      return {
        data: groups.flatMap((group) => group.rows),
        plans,
        source: "api",
        failedPlans: groups.filter((group) => group.failed).length,
      };
    });
  }

  async function loadCurriculumForPrograms(programKeys) {
    const keys = [...new Set(programKeys.map(text).filter(Boolean))].sort();
    if (!keys.length) return { data: [], plans: [], source: window.AcademicData?.isDemoMode?.() ? "demo" : "api", failedPlans: 0 };
    return cached(`curriculum-batch:${keys.join("|")}`, async () => {
      const api = window.AcademicData;
      if (!api) throw new Error("Academic Data client is unavailable");
      if (api.isDemoMode?.()) {
        const snapshot = await loadCurriculum();
        return {
          data: snapshot.data.filter((item) => keys.includes(text(item.program_key)) || keys.includes(text(item.program_code))),
          plans: [],
          source: "demo",
          failedPlans: 0,
        };
      }
      const keySet = new Set(keys);
      const plans = (await api.list("/v1/study-plans")).filter((plan) => keySet.has(text(plan.program_key)));
      const parsedPlans = plans.filter((plan) => plan.status === "parsed");
      const groups = await loadLiveCurriculumPlans(api, parsedPlans);
      const failedKeys = new Set(
        groups
          .filter((group) => group.failed || (!group.rows.length && Number(group.plan.item_count) > 0))
          .map((group) => text(group.plan.program_key))
          .filter(Boolean),
      );
      const returnedPlanKeys = new Set(plans.map((plan) => text(plan.program_key)).filter(Boolean));
      for (const key of keys) if (!returnedPlanKeys.has(key)) failedKeys.add(key);
      return {
        data: groups.flatMap((group) => group.rows),
        plans,
        source: "api",
        failedPlans: failedKeys.size,
      };
    });
  }

  function mapRequirementNode(node) {
    if (!node) return null;
    if (node.kind === "leaf" || node.subject_code) {
      return {
        exam: {
          subject_code: node.subject_code,
          minimum_score: node.minimum_score,
          is_choice: Boolean(node.is_choice),
          tiebreak_rank: node.tiebreak_rank,
        },
      };
    }
    const operator = text(node.operator).toUpperCase() || "AND";
    return {
      operator,
      min_count: node.threshold ?? node.min_count,
      children: (node.children || []).map(mapRequirementNode).filter(Boolean),
    };
  }

  async function loadAdmissionFromApi(api) {
    const campaigns = await api.list("/v1/campaigns", { year: 2026 });
    const campaign = campaigns.find((item) => Number(item.year) === 2026 && item.campaign_kind === "admission") || campaigns[0];
    if (!campaign?.external_key) throw new Error("2026 admission campaign is unavailable");
    const campaignPath = `/v1/campaigns/${encodeURIComponent(campaign.external_key)}`;
    const dataRequests = [
      ["dates", `${campaignPath}/calendar`],
      ["offerings", `${campaignPath}/offerings`],
      ["pools", "/v1/competition-pools", { campaign_key: campaign.external_key }],
      ["requirements", "/v1/requirements", { campaign_key: campaign.external_key }],
      ["achievements", "/v1/individual-achievements", { campaign_key: campaign.external_key }],
      ["tuition", "/v1/tuition"],
      ["history", "/api/v1/statistics", { kind: "historical" }],
      ["campaignStatistics", "/api/v1/statistics", { kind: "admission", year: 2026 }],
    ];
    const admissionData = {};
    let nextRequest = 0;
    const worker = async () => {
      while (nextRequest < dataRequests.length) {
        const [key, path, params] = dataRequests[nextRequest++];
        admissionData[key] = await api.list(path, params);
      }
    };
    await Promise.all(Array.from({ length: 2 }, worker));
    const { dates, offerings, pools, requirements, achievements, tuition, history, campaignStatistics } = admissionData;
    const offeringsByKey = new Map(offerings
      .filter((row) => text(row.external_key))
      .map((row) => [text(row.external_key), row]));
    const examMap = new Map();
    const mappedRequirements = requirements.map((row) => {
      const exams = [];
      const collect = (node) => {
        if (!node) return;
        if (node.kind === "leaf" || node.subject_code) {
          const exam = {
            subject_code: node.subject_code,
            minimum_score: node.minimum_score,
            is_choice: Boolean(node.is_choice),
            tiebreak_rank: node.tiebreak_rank,
          };
          exams.push(exam);
          if (exam.subject_code) examMap.set(exam.subject_code, exam);
          return;
        }
        for (const child of node.children || []) collect(child);
      };
      collect(row.root);
      return {
        external_key: row.external_key,
        direction_code: row.direction_code,
        applicant_category_text: row.applicant_category,
        requirement_tree: mapRequirementNode(row.root),
        exams,
        source_url: sourceUrl(row),
      };
    });
    return {
      offerings: offerings.map((row) => ({
        external_key: row.external_key,
        campaign_year: String(campaign.year),
        direction_code: row.direction_code,
        department_code: row.department_code,
        program_name_in_document: row.program_name_in_source,
        study_form: row.study_form,
        language: row.language,
        educational_program_key: row.program_key,
        catalog_join_status: row.program_link_status,
        study_duration_label: row.study_duration_label,
        source_url: sourceUrl(row),
      })),
      pools: pools.map((row) => {
        const offeringKeys = [...new Set([
          ...(Array.isArray(row.offering_keys) ? row.offering_keys : []),
          row.offering_key,
        ].map(text).filter(Boolean))];
        const linkedOfferings = offeringKeys.map((key) => offeringsByKey.get(key)).filter(Boolean);
        return ({
        external_key: row.external_key,
        campaign_year: String(campaign.year),
        direction_code: row.direction_code,
        department_code: row.department_code,
        scope_level: row.scope_level,
        offering_keys: offeringKeys,
        program_keys: [...new Set(linkedOfferings
          .filter((offering) => offering.program_link_status === "exact")
          .map((offering) => text(offering.program_key))
          .filter(Boolean))],
        offering_link_statuses: [...new Set(linkedOfferings.map((offering) => text(offering.program_link_status)).filter(Boolean))],
        funding_type: row.funding_type,
        quota_type: row.quota_type,
        places: row.places,
        target_organization: row.target_organization,
        target_organization_inn: row.target_organization_inn,
        target_region: row.target_region,
        source_url: sourceUrl(row),
      });
      }),
      requirements: mappedRequirements,
      exams: [...examMap.values()],
      achievements: achievements.map((row) => ({
        external_key: row.external_key,
        campaign_year: String(campaign.year),
        achievement_name: row.name,
        additional_points: row.points,
        required_document: row.required_document,
        source_url: sourceUrl(row),
      })),
      dates: dates.map((row) => ({
        external_key: row.external_key,
        campaign_year: String(campaign.year),
        date: row.date_value || row.starts_at,
        date_text: row.date_text || row.label,
        time: row.time_value,
        context: row.context,
        source_url: sourceUrl(row),
      })),
      tuition: tuition.map((row) => ({
        external_key: row.external_key,
        direction_code: row.direction_code,
        direction_name: row.direction_name,
        study_year_label: row.academic_year,
        annual_amount_rub: row.currency === "RUB" ? row.amount : null,
        currency: row.currency,
        campus_scope: row.campus_scope,
        source_url: sourceUrl(row),
      })),
      history: history.map((row) => ({
        external_key: row.external_key,
        admission_year: row.year,
        direction_code: row.direction_code,
        department_code: row.department_code,
        funding_type: row.funding_type,
        scope_type: row.scope_type,
        scope_label: row.scope_label,
        study_form: row.study_form,
        minimum_score: row.minimum_score ?? row.score,
        average_score: row.average_score,
        maximum_score: row.maximum_score,
        admitted_count: row.admitted_count,
        snapshot_date: row.snapshot_date,
        outcome_type: row.statistic_kind,
        source_url: sourceUrl(row),
      })),
      campaign_statistics: campaignStatistics.map((row) => ({
        external_key: row.external_key,
        admission_year: row.year,
        direction_code: row.direction_code,
        funding_type: row.funding_type,
        admission_stage: row.admission_stage,
        competition_type: row.competition_type,
        status: row.status,
        score: row.score ?? row.minimum_score,
        minimum_score: row.minimum_score,
        snapshot_date: row.snapshot_date || row.observed_at,
        source_locator: row.sources?.[0]?.locator || null,
        source_url: sourceUrl(row),
      })),
    };
  }

  function loadAdmission() {
    return cached("admission", async () => {
      const api = window.AcademicData;
      if (!api) throw new Error("Academic Data client is unavailable");
      if (api.isDemoMode?.()) {
        return { data: await readSnapshot("data/admission.json", (value) => value?.data || value), source: "demo" };
      }
      return { data: await loadAdmissionFromApi(api), source: "api" };
    });
  }

  async function loadSnapshotInfo() {
    if (!window.AcademicData?.isDemoMode?.()) return {};
    if (pending.snapshotInfo) return pending.snapshotInfo;
    pending.snapshotInfo = fetch("data/snapshot.json", { cache: "no-cache" })
      .then((response) => response.ok ? response.json() : {})
      .catch(() => ({}));
    return pending.snapshotInfo;
  }

  function formatSnapshotDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "дата не указана";
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow",
    }).format(date);
  }

  function asArray(value) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.data)) return value.data;
    if (Array.isArray(value?.items)) return value.items;
    if (Array.isArray(value?.programs)) return value.programs;
    return [];
  }

  function text(value) {
    return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
  }

  function getSubjectClassification(item) {
    const classification = item?.subject_classification || item?.subjectClassification || null;
    const name = text(classification?.category_name) || text(item?.subject_category) || text(item?.subject_category_name);
    if (!name) return null;
    return {
      name,
      code: text(classification?.category_code),
    };
  }

  function safeUrl(value) {
    try {
      const target = text(value);
      if (!target) return "";
      const url = new URL(target, window.location.href);
      return ["https:", "http:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  }

  function formatNumber(value, maximumFractionDigits = 0) {
    if (value === null || value === undefined || value === "") return "—";
    const number = Number(value);
    if (!Number.isFinite(number)) return text(value) || "—";
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits }).format(number);
  }

  function readList(key) {
    const browserState = window.AndromedaBrowserState;
    if (typeof browserState?.readList === "function") return browserState.readList(key);
    const value = readStore(key, []);
    return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
  }

  function setList(key, values) {
    const normalized = [...new Set(values)].filter((entry) => typeof entry === "string");
    const browserState = window.AndromedaBrowserState;
    if (typeof browserState?.writeList === "function") return browserState.writeList(key, normalized) !== null;
    return writeStore(key, normalized);
  }

  function normalizeExamCode(value) {
    return text(value).toLocaleLowerCase("ru-RU");
  }

  const examLabels = {
    russian_language: "Русский язык",
    mathematics: "Математика",
    physics: "Физика",
    informatics_and_ict: "Информатика и ИКТ",
    chemistry: "Химия",
    biology: "Биология",
    foreign_language: "Иностранный язык",
    history: "История",
    social_studies: "Обществознание",
    literature: "Литература",
    creative_exam: "Творческое испытание",
  };

  function examLabel(code) {
    const key = normalizeExamCode(code);
    return examLabels[key] || text(code).replaceAll("_", " ");
  }

  function planStatusLabel(value) {
    const status = text(value);
    const labels = {
      parsed_and_profile_identity_verified: "профиль учебного плана проверен",
      parsed_via_user_confirmed_catalog_link: "связь с каталогом подтверждена",
      linked_public_resource_has_no_file: "файл учебного плана недоступен",
      public_plan_metadata_unavailable: "метаданные учебного плана недоступны",
      verified: "связь профиля с учебным планом подтверждена",
      parsed: "учебный план разобран",
    };
    return labels[status] || status.replaceAll("_", " ");
  }

  function numberPlural(number, words) {
    const form = new Intl.PluralRules("ru-RU").select(number);
    if (form === "one") return words[0];
    if (form === "few") return words[1];
    return words[2];
  }

  function updateSet(key, value, enabled) {
    const values = readList(key).filter((entry) => entry !== value);
    if (enabled) values.push(value);
    setList(key, values);
    return values;
  }

  function getProfile() {
    const value = typeof window.AndromedaBrowserState?.readProfile === "function"
      ? window.AndromedaBrowserState.readProfile()
      : readStore(STORAGE.profile, {});
    return {
      scores: value?.scores && typeof value.scores === "object" ? value.scores : {},
      interests: Array.isArray(value?.interests) ? value.interests : [],
      achievements: Array.isArray(value?.achievements) ? value.achievements : [],
      targetDirection: text(value?.targetDirection),
      note: text(value?.note),
    };
  }

  function setProfile(value) {
    const normalized = {
      scores: value?.scores && typeof value.scores === "object" ? value.scores : {},
      interests: Array.isArray(value?.interests) ? value.interests : [],
      achievements: Array.isArray(value?.achievements) ? value.achievements : [],
      targetDirection: text(value?.targetDirection),
    };
    if (typeof value?.note === "string") normalized.note = text(value.note);
    if (typeof window.AndromedaBrowserState?.writeProfile === "function") {
      return window.AndromedaBrowserState.writeProfile(normalized);
    }
    return writeStore(STORAGE.profile, normalized);
  }

  function clearProfile() {
    if (typeof window.AndromedaBrowserState?.clearProfile === "function") {
      return window.AndromedaBrowserState.clearProfile();
    }
    try {
      localStorage.removeItem(STORAGE.profile);
      return true;
    } catch {
      return false;
    }
  }

  function askClearComparison() {
    return new Promise((resolve) => {
      const dialog = document.createElement("dialog");
      dialog.className = "comparison-limit-dialog";
      dialog.setAttribute("aria-labelledby", "comparisonLimitTitle");
      dialog.setAttribute("aria-describedby", "comparisonLimitMessage");

      const content = document.createElement("div");
      content.className = "comparison-limit-content";
      const count = document.createElement("span");
      count.className = "comparison-limit-count";
      count.textContent = "3 из 3";
      const title = document.createElement("h2");
      title.id = "comparisonLimitTitle";
      title.textContent = "Уже достаточно программ";
      const message = document.createElement("p");
      message.id = "comparisonLimitMessage";
      message.textContent = "В сравнении уже выбраны 3 из 3 программ. Очистить список, чтобы выбрать программы заново?";
      const actions = document.createElement("div");
      actions.className = "comparison-limit-actions";
      const keep = document.createElement("button");
      keep.type = "button";
      keep.className = "comparison-limit-keep";
      keep.textContent = "Оставить";
      keep.autofocus = true;
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "comparison-limit-clear";
      clear.textContent = "Очистить";
      actions.append(keep, clear);
      content.append(count, title, message, actions);
      dialog.append(content);

      let settled = false;
      const finish = (shouldClear) => {
        if (settled) return;
        settled = true;
        if (dialog.open) dialog.close();
        dialog.remove();
        resolve(shouldClear);
      };
      keep.addEventListener("click", () => finish(false));
      clear.addEventListener("click", () => finish(true));
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        finish(false);
      });
      dialog.addEventListener("close", () => finish(false));
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) finish(false);
      });
      document.body.append(dialog);
      dialog.showModal();
      keep.focus();
    });
  }

  window.Andromeda = Object.freeze({
    loadPrograms,
    loadCurriculum,
    loadCurriculumForProgram,
    loadCurriculumForPrograms,
    loadAdmission,
    loadSnapshotInfo,
    formatSnapshotDate,
    getFavorites: () => readList(STORAGE.favorites),
    setFavorites: (values) => setList(STORAGE.favorites, values),
    toggleFavorite: (code, enabled) => updateSet(STORAGE.favorites, code, enabled),
    getComparison: () => readList(STORAGE.compare),
    setComparison: (values) => setList(STORAGE.compare, values.slice(0, 3)),
    askClearComparison,
    toggleComparison: (code, enabled) => {
      const current = readList(STORAGE.compare).filter((entry) => entry !== code);
      if (enabled && current.length < 3) current.push(code);
      setList(STORAGE.compare, current);
      return current;
    },
    getProfile,
    setProfile,
    clearProfile,
    text,
    safeUrl,
    formatNumber,
    examLabel,
    planStatusLabel,
    getSubjectClassification,
    numberPlural,
    keys: Object.freeze({ ...STORAGE }),
  });
})();
