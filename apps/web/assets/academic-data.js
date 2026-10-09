(() => {
  const modeKey = "andromeda.academic-data-mode";
  const query = new URLSearchParams(window.location.search);
  try {
    if (query.get("data") === "demo") sessionStorage.setItem(modeKey, "demo");
    if (query.get("data") === "live") sessionStorage.setItem(modeKey, "live");
  } catch {
    // A private browsing context may disable sessionStorage; the URL still controls this page.
  }
  let demoMode = query.get("data") === "demo";
  try {
    demoMode ||= sessionStorage.getItem(modeKey) === "demo";
  } catch {
    // Keep live mode as the safe default when browser storage is unavailable.
  }

  const apiBase = (window.ACADEMIC_DATA_API_BASE || "/api/v1").replace(/\/$/, "");
  const requests = new Map();
  const snapshots = new Map();
  let programDataSource = demoMode ? "demo" : "unknown";

  const browserStorageKeys = {
    favorites: "andromeda.favorites.v1",
    compare: "andromeda.compare.v1",
    profile: "andromeda.applicant.v1",
  };
  const legacyBrowserStorageKeys = {
    favorites: "andromeda-favorite-programs-v1",
    compare: "andromeda-compare-programs-v1",
    profile: "andromeda-applicant-profile-v1",
  };
  const compareOverflowKey = "andromeda.compare.migration-overflow.v1";
  const profileMigrationMarkerKey = "andromeda.applicant.migration.v1";

  function parseStoredValue(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? null : JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function storeValue(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function removeStoredValue(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  function storageKind(kindOrKey) {
    return Object.keys(browserStorageKeys).find((kind) => (
      kindOrKey === kind
      || kindOrKey === browserStorageKeys[kind]
      || kindOrKey === legacyBrowserStorageKeys[kind]
    ));
  }

  function stringList(value) {
    return Array.isArray(value)
      ? [...new Set(value.filter((entry) => typeof entry === "string" && entry.length > 0))]
      : [];
  }

  function profileRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function mergeProfiles(canonical, legacy) {
    const primary = profileRecord(canonical);
    const old = profileRecord(legacy);
    return {
      scores: {
        ...(old.scores && typeof old.scores === "object" && !Array.isArray(old.scores) ? old.scores : {}),
        ...(primary.scores && typeof primary.scores === "object" && !Array.isArray(primary.scores) ? primary.scores : {}),
      },
      interests: stringList([...(Array.isArray(old.interests) ? old.interests : []), ...(Array.isArray(primary.interests) ? primary.interests : [])]),
      achievements: stringList([
        ...(Array.isArray(old.achievements) ? old.achievements : []),
        ...(Array.isArray(old.achievementKeys) ? old.achievementKeys : []),
        ...(Array.isArray(primary.achievements) ? primary.achievements : []),
        ...(Array.isArray(primary.achievementKeys) ? primary.achievementKeys : []),
      ]),
      targetDirection: typeof primary.targetDirection === "string" && primary.targetDirection
        ? primary.targetDirection
        : typeof old.directionCode === "string" ? old.directionCode : "",
      note: typeof primary.note === "string" && primary.note
        ? primary.note
        : typeof old.note === "string" ? old.note : "",
    };
  }

  function profileMigrationHasConflicts(canonical, legacy) {
    const primary = profileRecord(canonical);
    const old = profileRecord(legacy);
    const primaryScores = primary.scores && typeof primary.scores === "object" && !Array.isArray(primary.scores)
      ? primary.scores
      : {};
    const oldScores = old.scores && typeof old.scores === "object" && !Array.isArray(old.scores)
      ? old.scores
      : {};
    if (Object.entries(oldScores).some(([key, value]) => (
      Object.hasOwn(primaryScores, key) && JSON.stringify(primaryScores[key]) !== JSON.stringify(value)
    ))) return true;

    const primaryDirection = typeof primary.targetDirection === "string" ? primary.targetDirection : "";
    const oldDirection = typeof old.directionCode === "string" ? old.directionCode : "";
    if (primaryDirection && oldDirection && primaryDirection !== oldDirection) return true;

    return typeof primary.note === "string"
      && primary.note.length > 0
      && typeof old.note === "string"
      && old.note.length > 0
      && primary.note !== old.note;
  }

  function writeProfileRecord(value, previous) {
    const input = profileRecord(value);
    const current = profileRecord(previous);
    const inputScores = input.scores && typeof input.scores === "object" && !Array.isArray(input.scores)
      ? input.scores
      : null;
    const interests = Array.isArray(input.interests) ? input.interests : current.interests;
    const achievements = Array.isArray(input.achievements)
      ? input.achievements
      : Array.isArray(input.achievementKeys) ? input.achievementKeys : current.achievements;
    const targetDirection = typeof input.targetDirection === "string"
      ? input.targetDirection
      : typeof input.directionCode === "string" ? input.directionCode : current.targetDirection;
    const note = typeof input.note === "string" ? input.note : current.note;
    return {
      scores: inputScores || current.scores || {},
      interests: stringList(interests),
      achievements: stringList(achievements),
      targetDirection: typeof targetDirection === "string" ? targetDirection : "",
      note: typeof note === "string" ? note : "",
    };
  }

  function readBrowserProfile() {
    const canonical = parseStoredValue(browserStorageKeys.profile);
    const migrationComplete = parseStoredValue(profileMigrationMarkerKey) === true;
    const legacy = migrationComplete ? null : parseStoredValue(legacyBrowserStorageKeys.profile);
    const merged = mergeProfiles(canonical, legacy);
    if (!migrationComplete && storeValue(browserStorageKeys.profile, merged)) {
      if (storeValue(profileMigrationMarkerKey, true)) {
        if (legacy !== null && !profileMigrationHasConflicts(canonical, legacy)) {
          removeStoredValue(legacyBrowserStorageKeys.profile);
        }
      }
    }
    return merged;
  }

  function writeBrowserProfile(value) {
    const current = readBrowserProfile();
    const normalized = writeProfileRecord(value, current);
    if (!storeValue(browserStorageKeys.profile, normalized)) return false;
    if (!storeValue(profileMigrationMarkerKey, true)) return false;
    const legacy = parseStoredValue(legacyBrowserStorageKeys.profile);
    if (legacy !== null && !profileMigrationHasConflicts(normalized, legacy)) {
      removeStoredValue(legacyBrowserStorageKeys.profile);
    }
    return true;
  }

  function clearBrowserProfile() {
    const canonicalRemoved = removeStoredValue(browserStorageKeys.profile);
    const legacyRemoved = removeStoredValue(legacyBrowserStorageKeys.profile);
    const markerRemoved = removeStoredValue(profileMigrationMarkerKey);
    return canonicalRemoved && legacyRemoved && markerRemoved;
  }

  function readBrowserList(kindOrKey) {
    const kind = storageKind(kindOrKey);
    if (!kind || kind === "profile") return [];
    const canonical = stringList(parseStoredValue(browserStorageKeys[kind]));
    const legacy = stringList(parseStoredValue(legacyBrowserStorageKeys[kind]));
    const merged = stringList([...canonical, ...legacy]);
    const active = kind === "compare" ? merged.slice(0, 3) : merged;
    if (legacy.length > 0) {
      const overflow = kind === "compare" ? merged.slice(3) : [];
      const overflowValues = stringList([
        ...stringList(parseStoredValue(compareOverflowKey)),
        ...overflow,
      ]);
      const overflowStored = overflow.length === 0 || storeValue(compareOverflowKey, overflowValues);
      if (overflowStored && storeValue(browserStorageKeys[kind], active)) {
        removeStoredValue(legacyBrowserStorageKeys[kind]);
      }
    } else if (kind === "compare" && merged.length > 3) {
      if (storeValue(compareOverflowKey, stringList([
        ...stringList(parseStoredValue(compareOverflowKey)),
        ...merged.slice(3),
      ]))) {
        storeValue(browserStorageKeys[kind], active);
      }
    }
    return active;
  }

  function writeBrowserList(kindOrKey, values) {
    const kind = storageKind(kindOrKey);
    if (!kind || kind === "profile") return null;
    readBrowserList(kind);
    const unique = stringList(values);
    const normalized = kind === "compare" ? unique.slice(0, 3) : unique;
    if (!storeValue(browserStorageKeys[kind], normalized)) return null;
    removeStoredValue(legacyBrowserStorageKeys[kind]);
    return normalized;
  }

  function normalizeRequirementNode(rule) {
    if (!rule || typeof rule !== "object") return null;
    if (rule.kind === "leaf" || rule.subject_code) return { ...rule, kind: "leaf" };
    if (rule.exam && typeof rule.exam === "object") return { ...rule, ...rule.exam, kind: "leaf" };
    const children = Array.isArray(rule.children)
      ? rule.children.map(normalizeRequirementNode).filter(Boolean)
      : [];
    return {
      ...rule,
      kind: "operator",
      threshold: rule.threshold ?? rule.min_count,
      children,
    };
  }

  function normalizeRequirementRows(rows) {
    return rows.map((row) => ({
      ...row,
      root: normalizeRequirementNode(row.root ?? row.requirement_tree),
    }));
  }

  window.AndromedaBrowserState = Object.freeze({
    readList: readBrowserList,
    writeList: writeBrowserList,
    readProfile: readBrowserProfile,
    writeProfile: writeBrowserProfile,
    clearProfile: clearBrowserProfile,
  });

  function showDemoBanner() {
    if (!demoMode) return;
    const mount = () => {
      if (!document.body || document.getElementById("andromeda-demo-data-banner")) return;
      const style = document.createElement("style");
      style.textContent = "#andromeda-demo-data-banner{position:sticky;top:0;z-index:10000;display:flex;justify-content:center;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 14px;background:#fff1c2;color:#593c00;border-bottom:1px solid #d8b45b;font:600 12px/1.35 Arial,sans-serif;text-align:center}#andromeda-demo-data-banner a{color:inherit;text-decoration:underline;text-underline-offset:2px}#andromeda-demo-data-banner strong{letter-spacing:.04em}.andromeda-site-logo,.andromeda-menu-button,.logo,#menuButton{z-index:10001}@media(max-width:600px){#andromeda-demo-data-banner{gap:5px;padding:8px 72px 8px 100px;font-size:10px;line-height:1.25}}";
      const banner = document.createElement("aside");
      banner.id = "andromeda-demo-data-banner";
      banner.setAttribute("role", "status");
      banner.setAttribute("aria-live", "polite");
      const label = document.createElement("strong");
      label.textContent = "ДЕМО-ДАННЫЕ";
      const detail = document.createElement("span");
      detail.textContent = "Локальные JSON-снимки; это не данные активного API.";
      const liveLink = document.createElement("a");
      liveLink.href = window.location.href;
      liveLink.textContent = "Вернуться к API";
      liveLink.addEventListener("click", (event) => {
        event.preventDefault();
        try {
          sessionStorage.setItem(modeKey, "live");
        } catch {
          // The data=live query parameter below still selects live mode for the next page.
        }
        const next = new URL(window.location.href);
        next.searchParams.set("data", "live");
        window.location.assign(next);
      });
      banner.append(label, detail, liveLink);
      document.body.prepend(banner);
      document.head.append(style);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
    else mount();
  }

  function announceSource(source, count) {
    programDataSource = source;
    window.dispatchEvent(new CustomEvent("academic-data-source", { detail: { source, count } }));
  }

  function canonicalPath(path) {
    const pathname = String(path).split("?", 1)[0];
    const route = pathname.startsWith("/api/v1")
      ? pathname.slice("/api/v1".length) || "/"
      : pathname.startsWith("/v1")
        ? pathname.slice("/v1".length) || "/"
        : pathname;
    if (route === "/statistics/historical") return { route: "/statistics", kind: "historical" };
    if (route === "/statistics/campaign") return { route: "/statistics", kind: "admission" };
    return { route, kind: null };
  }

  function urlFor(path, params = {}) {
    const normalized = canonicalPath(path);
    const url = new URL(`${apiBase}${normalized.route}`, window.location.href);
    if (normalized.kind) url.searchParams.set("kind", normalized.kind);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    return url;
  }

  async function snapshot(name) {
    if (!snapshots.has(name)) {
      snapshots.set(name, fetch(`data/${name}.json`, { cache: "no-cache" }).then(async (response) => {
        if (!response.ok) throw new Error(`Demo snapshot ${name}: HTTP ${response.status}`);
        return response.json();
      }).catch((error) => {
        snapshots.delete(name);
        throw error;
      }));
    }
    return snapshots.get(name);
  }

  const text = (value) => String(value ?? "").trim();
  const uniqueBy = (rows, key) => [...new Map(rows.map((row) => [key(row), row]).filter(([value]) => value)).values()];
  const campaignKey = "campaign:bmstu:2026:admission";

  async function demoPrograms() {
    return snapshot("programs");
  }

  async function demoCurriculum() {
    return snapshot("curriculum");
  }

  async function demoAdmission() {
    return snapshot("admission");
  }

  async function demoList(path, params = {}) {
    const normalized = canonicalPath(path);
    const route = decodeURIComponent(normalized.route);
    params = normalized.kind ? { ...params, kind: normalized.kind } : params;
    if (route === "/programs") return demoPrograms();
    if (route === "/directions") {
      const programs = await demoPrograms();
      return uniqueBy(programs.map((program) => ({
        external_key: `direction:bmstu:${text(program.direction_code)}`,
        code: text(program.direction_code),
        name: text(program.direction),
        program_keys: programs.filter((item) => item.direction_code === program.direction_code).map((item) => item.external_key),
      })), (item) => item.code);
    }
    if (route === "/departments") {
      const programs = await demoPrograms();
      return uniqueBy(programs.map((program) => ({
        external_key: `department:bmstu:${text(program.department_code)}`,
        official_code: text(program.department_code),
        name: text(program.department),
        campus_status: "unverified",
      })), (item) => item.official_code);
    }
    if (route === "/study-plans") {
      const [programs, curriculum] = await Promise.all([demoPrograms(), demoCurriculum()]);
      const selected = text(params.program_key);
      const groups = new Map();
      for (const row of curriculum) {
        if (selected && row.program_key !== selected && row.program_code !== selected) continue;
        const program = programs.find((item) => item.external_key === row.program_key || item.code === row.program_code);
        const planKey = `study_plan:${row.program_key || row.program_code}:${row.education_year || "unknown"}`;
        if (!groups.has(planKey)) groups.set(planKey, {
          external_key: planKey,
          program_key: row.program_key || program?.external_key || null,
          profile_code: row.program_code || program?.code || null,
          academic_year: row.education_year || null,
          profile_name_in_plan: program?.name || null,
          profile_link_status: "verified",
          status: "parsed",
          item_count: 0,
        });
        groups.get(planKey).item_count += 1;
      }
      return [...groups.values()];
    }
    if (route.startsWith("/study-plans/") && route.endsWith("/items")) {
      const planKey = route.slice("/study-plans/".length, -"/items".length);
      const plan = (await demoList("/study-plans")).find((item) => item.external_key === planKey);
      if (!plan) return [];
      return (await demoCurriculum()).filter((row) => row.program_key === plan.program_key && String(row.education_year) === String(plan.academic_year)).map((row) => ({
        ...row,
        study_plan_key: planKey,
        ordinal: Number(row.row_no) || 0,
        discipline_name: row.discipline || row.course || null,
        total_hours: row.hours,
        lecture_hours: row.lectures,
        practice_hours: row.practices,
        lab_hours: row.labs,
        self_study_hours: row.self_study,
        control_form: row.assessment_type,
      }));
    }
    if (route === "/campaigns") {
      return [{
        external_key: campaignKey,
        university_key: "university:bmstu",
        year: 2026,
        campaign_kind: "admission",
        title: "Приёмная кампания 2026",
        campus_status: "not_stated",
      }];
    }
    const admission = await demoAdmission();
    if (route === "/requirements") return (admission.requirements || []).map((row) => ({ ...row, campaign_key: campaignKey, root: row.root || row.requirement_tree }));
    if (route === "/competition-pools") return (admission.pools || []).map((row) => ({ ...row, campaign_key: campaignKey }));
    if (route === "/individual-achievements") return (admission.achievements || []).map((row) => ({
      ...row, campaign_key: campaignKey, name: row.name || row.achievement_name,
      points: row.points ?? row.additional_points,
    }));
    if (route === "/tuition") return admission.tuition || [];
    if (route === "/statistics") {
      const rows = params.kind === "admission" ? admission.campaign_statistics : admission.history;
      return rows || [];
    }
    if (route === "/exams") return admission.exams || [];
    if (route === `/campaigns/${campaignKey}/offerings`) return admission.offerings || [];
    if (route === `/campaigns/${campaignKey}/calendar`) return (admission.dates || []).map((row) => ({
      ...row, campaign_key: campaignKey, date_value: row.date || null, label: row.date_text || "Дата кампании",
    }));
    throw new Error(`Demo data does not contain route ${route}`);
  }

  async function demoGet(path) {
    const route = decodeURIComponent(canonicalPath(path).route);
    if (route === "/release") {
      const profiles = await snapshot("prof-test-profiles");
      return profiles.release || {};
    }
    if (route.startsWith("/subject-taxonomies/")) {
      const profiles = await snapshot("prof-test-profiles");
      return profiles.taxonomy || { categories: [] };
    }
    if (route.startsWith("/programs/")) {
      const key = route.slice("/programs/".length);
      return (await demoPrograms()).find((row) => row.external_key === key || row.code === key);
    }
    if (route.startsWith("/study-plans/") && route.endsWith("/items")) {
      return demoList(route);
    }
    return undefined;
  }

  async function fetchJson(url) {
    const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-cache" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload?.error?.message || payload?.detail || `HTTP ${response.status}`;
      throw new Error(`Academic data API: ${message}`);
    }
    return payload;
  }

  async function request(url) {
    const key = url.toString();
    if (!requests.has(key)) {
      requests.set(key, fetchJson(url).catch((error) => {
        requests.delete(key);
        throw error;
      }));
    }
    return requests.get(key);
  }

  async function get(path, params) {
    if (demoMode) return demoGet(path);
    return request(urlFor(path, params));
  }

  async function list(path, params = {}) {
    if (demoMode) {
      const rows = await demoList(path, params);
      return canonicalPath(path).route === "/requirements" ? normalizeRequirementRows(rows) : rows;
    }
    const rows = [];
    const seen = new Set();
    let cursor = "";
    for (let pageIndex = 0; pageIndex < 500; pageIndex += 1) {
      const pageParams = { limit: 100, ...params };
      if (cursor) pageParams.cursor = cursor;
      const payload = await request(urlFor(path, pageParams));
      if (!Array.isArray(payload?.items) || !payload.page) {
        throw new Error(`Unexpected /api/v1 response for ${path}`);
      }
      rows.push(...payload.items);
      cursor = payload.page.next_cursor || "";
      if (!cursor) return canonicalPath(path).route === "/requirements" ? normalizeRequirementRows(rows) : rows;
      if (seen.has(cursor)) throw new Error(`Repeated pagination cursor for ${path}`);
      seen.add(cursor);
    }
    throw new Error(`Too many pages returned for ${path}`);
  }

  async function programs() {
    const rows = demoMode ? await demoPrograms() : await list("/v1/programs");
    if (!Array.isArray(rows) || !rows.length) throw new Error("Academic data API returned no programs");
    announceSource(demoMode ? "demo" : "live", rows.length);
    return rows;
  }

  showDemoBanner();
  window.AcademicData = Object.freeze({
    apiBase,
    get,
    list,
    programs,
    normalizeRequirementNode,
    isDemoMode: () => demoMode,
    getProgramDataSource: () => programDataSource,
  });
})();
