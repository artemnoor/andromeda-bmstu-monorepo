import { describe, expect, it } from "vitest";
import type { ApiSchemas } from "@/shared/api/client";
import type { CatalogProgram } from "@/features/catalog/model";
import { buildAdmissionSummary, type ProgramAdmissionData } from "@/features/catalog/admission-model";
import { presentCompetition } from "@/features/catalog/admission-results";

type Campaign = ApiSchemas["AdmissionCampaignRecord"];
type Offering = ApiSchemas["AdmissionOfferingRecord"];
type Pool = ApiSchemas["CompetitionPoolRecord"];

const program: CatalogProgram = {
  external_key: "program:1",
  code: "09.03.01",
  name: "Информатика",
  direction_key: "direction:1",
  directionCode: "09.03.01",
  directionName: "Информатика и вычислительная техника",
  departmentCode: "ИУ-1",
  departmentName: "Системы обработки информации",
  departments: [{ externalKey: "department:iu1", code: "ИУ-1", name: "Системы обработки информации" }],
  departmentStatus: "verified",
  sourceUrl: "https://bmstu.example/program",
  campus_status: "verified",
  campus_scope: "head_moscow",
  sources: [{ source_artifact_key: "artifact:1", source_url: "https://bmstu.example/program" }],
};

const campaign: Campaign = {
  campaign_kind: "admission",
  external_key: "campaign:2026",
  title: "Приём 2026",
  university_key: "bmstu",
  year: 2026,
  campus_status: "verified",
};

function pool(overrides: Partial<Pool> = {}): Pool {
  return {
    campaign_key: campaign.external_key,
    department_status: "verified",
    external_key: "pool:default",
    ingested_at: "2026-01-01T00:00:00Z",
    funding_type: "budget",
    quota_type: "general_competition",
    scope_level: "offering",
    places: 25,
    ...overrides,
  };
}

function offering(overrides: Partial<Offering> = {}): Offering {
  return {
    campaign_key: campaign.external_key,
    external_key: "offer:1",
    program_key: program.external_key,
    program_link_status: "exact",
    ...overrides,
  };
}

function data(overrides: Partial<ProgramAdmissionData> = {}): ProgramAdmissionData {
  return {
    releaseKey: "release:1",
    campaigns: [campaign],
    offerings: [offering()],
    calendar: [],
    pools: [pool({ offering_key: "offer:1" })],
    quotas: [],
    requirements: [],
    history: [],
    campaignStatistics: [],
    tuition: [],
    ...overrides,
  };
}

describe("buildAdmissionSummary", () => {
  it("keeps one shared intake pool shared instead of duplicating its seats", () => {
    const summary = buildAdmissionSummary(program, data({
      offerings: [offering({ program_key: null, program_link_status: "manual_review", shared_program_keys: [program.external_key, "program:other"], campus_scope: "head_moscow" })],
      pools: [pool({ offering_keys: ["offer:1", "offer:1"], places: 84 })],
    }));
    expect(summary.seats[0]?.value).toBe("84 места");
    expect(summary.seatScope).toBe("единый приёмный план для нескольких программ");
    expect(summary.relatedSeatFacts).toEqual([]);
  });

  it("does not use a shared intake from a different campus", () => {
    const summary = buildAdmissionSummary(program, data({
      offerings: [offering({ program_key: null, program_link_status: "manual_review", shared_program_keys: [program.external_key, "program:other"], campus_scope: "branch_kaluga" })],
      pools: [pool({ offering_key: "offer:1", places: 84 })],
    }));
    expect(summary.seats[0]?.value).toBe("—");
  });

  it("distinguishes zero budget capacity from missing or BVI-only results", () => {
    const zero = buildAdmissionSummary(program, data({ pools: [pool({ offering_key: "offer:1", places: 0 })] }));
    expect(presentCompetition(zero, "budget", "general").value).toBe("Бюджетные места не предусмотрены");
    const unknown = buildAdmissionSummary(program, data({ pools: [] }));
    expect(presentCompetition(unknown, "budget", "general").value).toBe("Результат не опубликован");
    const bvi = buildAdmissionSummary(program, data({ campaignStatistics: [{
      external_key: "stat:bvi", year: 2026, direction_code: program.directionCode, ingested_at: "2026-01-01T00:00:00Z",
      status: "bvi", competition_type: "bvi", admission_stage: "first", funding_type: "budget", score: null,
    }] }));
    expect(presentCompetition(bvi, "budget", "general").value).toBe("Есть зачисление БВИ");
    expect(presentCompetition(bvi, "budget", "general").note).toContain("не означает, что все места заняты БВИ");
    expect(presentCompetition(bvi, "budget", "bvi").value).toBe("БВИ — без вступительных испытаний");
  });

  it("preserves BVI and numeric results within each specific quota", () => {
    const summary = buildAdmissionSummary(program, data({ campaignStatistics: [
      { external_key: "stat:separate", year: 2026, direction_code: program.directionCode, ingested_at: "2026-01-01T00:00:00Z", status: "bvi", competition_type: "separate_quota", admission_stage: "first", funding_type: "budget", score: null },
      { external_key: "stat:special", year: 2026, direction_code: program.directionCode, ingested_at: "2026-01-01T00:00:00Z", status: "numeric", competition_type: "special_quota", admission_stage: "first", funding_type: "budget", score: "247" },
    ] }));
    expect(presentCompetition(summary, "budget", "separate_quota").value).toBe("БВИ — без вступительных испытаний");
    expect(presentCompetition(summary, "budget", "special_quota").value).toBe("247 баллов");
    expect(presentCompetition(summary, "budget", "targeted").value).toBe("Результат не опубликован");
    expect(presentCompetition(summary, "budget", "general").value).toBe("Результат не опубликован");
  });

  it("does not present an unclassified competition as the general competition", () => {
    const summary = buildAdmissionSummary(program, data({ campaignStatistics: [{
      external_key: "stat:unknown-route", year: 2026, direction_code: program.directionCode, ingested_at: "2026-01-01T00:00:00Z",
      status: "numeric", competition_type: "other", admission_stage: "main", funding_type: "budget", score: "300",
    }] }));
    expect(summary.campaignResults).toHaveLength(1);
    expect(presentCompetition(summary, "budget", "general").value).toBe("Результат не опубликован");
  });

  it("does not override an exact program BVI result with a broader numeric score", () => {
    const base = { year: 2026, direction_code: program.directionCode, ingested_at: "2026-01-01T00:00:00Z", competition_type: "separate_quota", admission_stage: "first", funding_type: "budget" };
    const summary = buildAdmissionSummary(program, data({ campaignStatistics: [
      { ...base, external_key: "stat:direction", status: "numeric", scope_type: "direction", score: "150" },
      { ...base, external_key: "stat:program", status: "bvi", scope_type: "program", scope_label: program.name, score: null },
    ] }));
    expect(presentCompetition(summary, "budget", "separate_quota").value).toBe("БВИ — без вступительных испытаний");
  });

  it("shows target organizations only at their printed direction and campus scope", () => {
    const summary = buildAdmissionSummary(program, data({ pools: [
      pool({ external_key: "target:moscow", direction_code: program.directionCode, quota_type: "targeted", scope_level: "direction_and_target_organization", campus_label_in_document: "МГТУ им. Н.Э. Баумана", target_organization: "Заказчик Москва", places: 2 }),
      pool({ external_key: "target:kaluga", direction_code: program.directionCode, quota_type: "targeted", scope_level: "direction_and_target_organization", campus_label_in_document: "КФ МГТУ им. Н.Э. Баумана", target_organization: "Заказчик Калуга", places: 4 }),
    ] }));
    expect(summary.quotas).toEqual([]);
    expect(summary.directionQuotas).toHaveLength(1);
    expect(summary.directionQuotas[0]).toMatchObject({ label: "Заказчик Москва", value: "2 места" });
    expect(summary.seats[0]?.value).toBe("—");
  });

  it("prefers an exact program offering and never adds a quota to general seats", () => {
    const summary = buildAdmissionSummary(program, data({
      offerings: [offering()],
      pools: [
        pool({ external_key: "pool:exact", offering_key: "offer:1", places: 24 }),
        pool({ external_key: "pool:department", scope_level: "department", department_key: "department:1", places: 400 }),
      ],
      quotas: [{
        campaign_key: campaign.external_key,
        external_key: "quota:targeted",
        ingested_at: "2026-01-01T00:00:00Z",
        places: 3,
        pool_key: "pool:exact",
        quota_type: "targeted",
        scope_level: "offering",
      }],
    }));

    expect(summary.seats[0]?.value).toBe("24 места");
    expect(summary.seatScope).toContain("предложение приёма");
    expect(summary.quotas).toHaveLength(1);
    expect(summary.quotas[0]?.value).toBe("3 места");
  });

  it("preserves unknown places and conflicting source values instead of reporting zero", () => {
    const summary = buildAdmissionSummary(program, data({
      pools: [pool({
        places: null,
        places_by_source_row: [{ places: 18 }, { places: 21 }],
        offering_key: "offer:1",
      })],
    }));

    expect(summary.seats[0]?.value).toBe("Конфликт в источнике");
    expect(summary.seats[0]?.value).not.toContain("0");
    expect(summary.seats[0]?.note).toContain("18 и 21");
  });

  it("shows verified quota pool counts when the detailed quota collection is empty", () => {
    const summary = buildAdmissionSummary(program, data({
      offerings: [offering()],
      pools: [
        pool({ external_key: "pool:general", offering_key: "offer:1", places: 25 }),
        pool({
          external_key: "pool:special",
          offering_key: "offer:1",
          quota_type: "special",
          places: 4,
        }),
        pool({
          external_key: "pool:separate",
          offering_key: "offer:1",
          quota_type: "separate",
          places: 6,
        }),
      ],
      quotas: [],
    }));

    expect(summary.quotas.map((quota) => [quota.label, quota.value])).toEqual([
      ["Особая квота · Бюджет", "4 места"],
      ["Отдельная квота · Бюджет", "6 мест"],
    ]);
    expect(summary.seats[0]?.value).toBe("25 мест");
  });

  it("labels a target-organization quota when it is tied to an exact offering", () => {
    const summary = buildAdmissionSummary(program, data({
      offerings: [offering()],
      pools: [pool({
        external_key: "pool:target-organization",
        offering_keys: ["offer:1"],
        scope_level: "offering",
        quota_type: "targeted",
        target_organization: "АО Концерн Галактика",
        places: 5,
      })],
    }));

    expect(summary.quotas).toEqual([expect.objectContaining({
      label: "Целевая квота · Бюджет · АО Концерн Галактика",
      value: "5 мест",
      scope: "предложение приёма",
    })]);
  });

  it("does not attach a broad target pool through direction-wide offering keys", () => {
    const targetPool = pool({
      external_key: "pool:direction-target-organization",
      offering_keys: ["offer:1"],
      scope_level: "direction_and_target_organization",
      direction_code: program.directionCode,
      campus_label_in_document: "КФ МГТУ им. Н.Э. Баумана",
      quota_type: "targeted",
      target_organization: "АО Концерн Галактика",
      places: 5,
    });
    const summary = buildAdmissionSummary(program, data({ offerings: [offering()], pools: [targetPool] }));
    expect(summary.quotas).toEqual([]);
    expect(summary.quotaNote).toContain("Эти места не приписываются программе");

    const otherDirectionProgram: CatalogProgram = {
      ...program,
      external_key: "program:other-direction",
      directionCode: "01.03.02",
    };
    const otherDirectionSummary = buildAdmissionSummary(otherDirectionProgram, data({
      offerings: [],
      pools: [targetPool],
    }));
    expect(otherDirectionSummary.quotas).toEqual([]);

    expect(summary.seatNote).toContain("не используются");

    const unlinkedSummary = buildAdmissionSummary(program, data({ offerings: [], pools: [targetPool] }));
    expect(unlinkedSummary.quotas).toEqual([]);
    expect(unlinkedSummary.quotaNote).toContain("без точного распределения по этому профилю и кампусу");
  });

  it("does not attach a pooled quota to an unrelated program offering", () => {
    const unrelatedProgram: CatalogProgram = {
      ...program,
      external_key: "program:unrelated",
      code: "09.03.01-99",
    };
    const summary = buildAdmissionSummary(unrelatedProgram, data({
      offerings: [offering({ external_key: "offer:unrelated", program_key: unrelatedProgram.external_key })],
      pools: [pool({
        external_key: "pool:target-organization",
        offering_keys: ["offer:1"],
        scope_level: "direction_and_target_organization",
        quota_type: "targeted",
        target_organization: "АО Концерн Галактика",
        places: 5,
      })],
    }));

    expect(summary.quotas).toEqual([]);
  });

  it("uses direction totals only with an explicit direction scope", () => {
    const summary = buildAdmissionSummary(program, data({
      offerings: [],
      pools: [
        pool({ external_key: "pool:direction", scope_level: "direction", direction_code: "09.03.01", places: 120 }),
        pool({ external_key: "pool:other", scope_level: "department", department_key: "department:other", places: 999 }),
      ],
    }));

    expect(summary.seats[0]?.value).toBe("120 мест");
    expect(summary.seatScope).toBe("направление");
  });

  it("preserves nested AND, OR and AT_LEAST requirement operators", () => {
    const root: ApiSchemas["RequirementTreeRecord"]["root"] = {
      kind: "operator",
      node_key: "root",
      operator: "AT_LEAST",
      threshold: 2,
      children: [
        { kind: "leaf", node_key: "math", subject_name: "Математика", minimum_score: "45" },
        {
          kind: "operator",
          node_key: "alternatives",
          operator: "OR",
          children: [
            { kind: "leaf", node_key: "physics", subject_name: "Физика" },
            { kind: "leaf", node_key: "informatics", subject_name: "Информатика" },
          ],
        },
      ],
    };
    const summary = buildAdmissionSummary(program, data({
      requirements: [{
        campaign_key: campaign.external_key,
        direction_key: program.direction_key,
        external_key: "requirement:1",
        ingested_at: "2026-01-01T00:00:00Z",
        root,
      }],
    }));

    expect(summary.requirements[0]?.text).toBe("не менее 2 из: Математика от 45; (Физика или Информатика)");
  });

  it("does not display PDF table fragments as applicant categories or duplicate identical exam sets", () => {
    const base = {
      campaign_key: campaign.external_key, direction_key: program.direction_key,
      ingested_at: "2026-01-01T00:00:00Z",
    };
    const root = { kind: "leaf" as const, node_key: "math", subject_name: "mathematics", minimum_score: "46" };
    const summary = buildAdmissionSummary(program, data({ requirements: [
      { ...base, external_key: "r:1", applicant_category: "Мехатроника 15.03.06 46 46 46", root },
      { ...base, external_key: "r:2", applicant_category: "Минимальнонеобходимыебаллы КодНП(С) 09.03.01", root },
      { ...base, external_key: "r:4", applicant_category: "Приложение 1 к Правилам приёма в МГТУ. Председатель приёмной комиссии", root },
      { ...base, external_key: "r:3", root: { ...root, minimum_score: "40" } },
    ] }));
    expect(summary.requirements).toHaveLength(2);
    expect(summary.requirements[0]).toMatchObject({ applicantCategory: null, sourceRecordCount: 3, text: "Математика от 46" });
    expect(summary.requirements[1]?.text).toBe("Математика от 40");
  });

  it("uses Moscow minima without mixing in Kaluga and GUIMC rows from the same PDF", () => {
    const base = {
      campaign_key: campaign.external_key, direction_key: program.direction_key,
      ingested_at: "2026-01-01T00:00:00Z",
    };
    const root = { kind: "leaf" as const, node_key: "math", subject_name: "mathematics", minimum_score: "46" };
    const source = (page: number, table: number) => [{
      source_artifact_key: "appendix:1",
      sha256: "0d1820ede1e3ceaaab7109f3cb32ac723c9b5e3634d68100d74c87e514ed1afd",
      locator: { page, table, row: 28 },
    }];
    const requirements = [
      { ...base, external_key: "r:moscow", sources: source(2, 1), root },
      { ...base, external_key: "r:kaluga", sources: source(3, 1), root: { ...root, minimum_score: "40" } },
      { ...base, external_key: "r:guimc", sources: source(3, 2), root },
    ];
    const summary = buildAdmissionSummary(program, data({ requirements }));
    expect(summary.requirements).toHaveLength(1);
    expect(summary.requirements[0]).toMatchObject({ sourceRecordCount: 1, text: "Математика от 46" });
    const unknownCampus = buildAdmissionSummary({ ...program, campus_status: "not_stated" }, data({ requirements }));
    expect(unknownCampus.requirements).toHaveLength(0);
  });

  it("groups nested boolean requirements so the published condition keeps its meaning", () => {
    const root: ApiSchemas["RequirementTreeRecord"]["root"] = {
      kind: "operator",
      node_key: "root",
      operator: "OR",
      children: [
        {
          kind: "operator",
          node_key: "required-pair",
          operator: "AND",
          children: [
            { kind: "leaf", node_key: "russian", subject_name: "Русский язык" },
            { kind: "leaf", node_key: "math", subject_name: "Математика" },
          ],
        },
        { kind: "leaf", node_key: "history", subject_name: "История" },
      ],
    };
    const summary = buildAdmissionSummary(program, data({
      requirements: [{
        campaign_key: campaign.external_key,
        direction_key: program.direction_key,
        external_key: "requirement:nested-boolean",
        ingested_at: "2026-01-01T00:00:00Z",
        root,
      }],
    }));

    expect(summary.requirements[0]?.text).toBe("(Русский язык и Математика) или История");
  });

  it("ignores unusable department history before choosing the best paid-score scope", () => {
    const statistic = (
      externalKey: string,
      overrides: Partial<ApiSchemas["OfficialAdmissionStatisticRecord"]>,
    ): ApiSchemas["OfficialAdmissionStatisticRecord"] => ({
      external_key: externalKey,
      ingested_at: "2026-01-01T00:00:00Z",
      year: 2025,
      ...overrides,
    });
    const summary = buildAdmissionSummary(program, data({
      history: [
        statistic("history:department-budget", {
          direction_code: program.directionCode,
          funding_type: "budget",
          minimum_score: "290",
          scope_type: "department",
          scope_label: "ИУ-1",
        }),
        statistic("history:department-paid-unknown", {
          direction_code: program.directionCode,
          funding_type: "paid",
          minimum_score: null,
          score: null,
          scope_type: "department",
          scope_label: "ИУ-1",
        }),
        statistic("history:direction-paid", {
          direction_code: program.directionCode,
          funding_type: "paid",
          minimum_score: "174",
          scope_type: "direction",
        }),
      ],
    }));

    expect(summary.historyScope).toBe("направление");
    expect(summary.history).toHaveLength(1);
    expect(summary.history[0]).toMatchObject({ year: 2025, funding: "Платное", minimum: "174" });
  });

  it("selects the latest admission campaign in the active release, independent of the machine year", () => {
    const summary = buildAdmissionSummary(program, data({
      campaigns: [
        { ...campaign, external_key: "campaign:2025", year: 2025 },
        campaign,
      ],
      campaignStatistics: [
        {
          external_key: "statistic:2025",
          ingested_at: "2026-01-01T00:00:00Z",
          year: 2025,
          direction_code: program.directionCode,
          funding_type: "budget",
          score: "240",
        },
        {
          external_key: "statistic:2026",
          ingested_at: "2026-01-01T00:00:00Z",
          year: 2026,
          direction_code: program.directionCode,
          funding_type: "budget",
          score: "270",
        },
      ],
    }));

    expect(summary.year).toBe(2026);
    expect(summary.campaignResults.map((result) => result.year)).toEqual([2026]);
  });

  it("keeps department admission statistics with their matching program and labels direction-level facts", () => {
    const anotherProgram: CatalogProgram = {
      ...program,
      external_key: "program:2",
      code: "09.03.01-02",
      departmentCode: "ИУ-2",
      departmentName: "Другой факультет",
      departments: [{ externalKey: "department:iu2", code: "ИУ-2", name: "Другой факультет" }],
    };
    const statistic = (
      externalKey: string,
      score: string,
      scopeType: string | null,
      scopeLabel: string | null,
    ): ApiSchemas["OfficialAdmissionStatisticRecord"] => ({
      external_key: externalKey,
      ingested_at: "2026-01-01T00:00:00Z",
      year: 2026,
      direction_code: program.directionCode,
      admission_stage: "main",
      competition_type: "general",
      status: "numeric",
      funding_type: "budget",
      score,
      scope_type: scopeType,
      scope_label: scopeLabel,
    });
    const shared: ProgramAdmissionData = data({
      campaignStatistics: [
        statistic("direction:score", "260", "direction", null),
        statistic("department:iu1", "280", "department", "ИУ-1"),
        statistic("department:iu2", "245", "department", "ИУ-2"),
        statistic("subgroup:unmatched", "310", "subgroup", "ИУ-1 · профиль A"),
      ],
    });

    const first = buildAdmissionSummary(program, shared);
    const second = buildAdmissionSummary(anotherProgram, shared);

    expect(first.campaignResults.map((result) => result.score)).toEqual([260, 280]);
    expect(second.campaignResults.map((result) => result.score)).toEqual([260, 245]);
    expect(first.campaignResults.find((result) => result.score === 280)?.scopeNote).toBe("по кафедре ИУ-1");
    expect(first.campaignResults.find((result) => result.score === 260)?.scopeNote).toContain("по направлению 09.03.01");
    expect(first.campaignResults.map((result) => result.score)).not.toContain(245);
    expect(first.campaignResults.map((result) => result.score)).not.toContain(310);
  });

  it("does not attach offerings with unresolved program identity", () => {
    const summary = buildAdmissionSummary(program, data({
      offerings: [offering({ program_link_status: "manual_review" })],
      pools: [pool({ offering_key: "offer:1", places: 60 })],
    }));

    expect(summary.seats[0]?.value).toBe("—");
    expect(summary.seatNote).toContain("нет однозначной строки этого профиля");
    expect(summary.offers).toEqual([]);
  });

  it("keeps an unknown study form visible when an exact offering only provides its duration", () => {
    const summary = buildAdmissionSummary(program, data({
      offerings: [offering({ study_form: null, study_duration_label: "6 лет" })],
    }));

    expect(summary.offers).toEqual(["Форма обучения: не указана", "Срок обучения: 6 лет"]);
  });

  it("keeps related unresolved seat facts separate from program identity and preserves zero and unknown", () => {
    const verifiedProgram: CatalogProgram = {
      ...program,
      department_relations: [{ department_key: "department:iu1", verification_status: "verified" }],
    };
    const unresolvedOffer = offering({
      program_key: null,
      program_link_status: "manual_review",
      direction_key: program.direction_key,
      direction_code: program.directionCode,
      department_key: "department:iu1",
      department_code: "ИУ-1",
      campus_scope: "head_moscow",
      program_name_in_source: "Другое название в источнике",
      study_form: "Очная",
    });
    const summary = buildAdmissionSummary(verifiedProgram, data({
      offerings: [unresolvedOffer],
      pools: [
        pool({ external_key: "pool:zero", offering_key: "offer:1", direction_key: program.direction_key,
          direction_code: program.directionCode, places: 0 }),
        pool({ external_key: "pool:unknown", offering_keys: ["offer:1"], direction_key: program.direction_key,
          direction_code: program.directionCode, funding_type: "paid", places: null }),
        pool({ external_key: "pool:quota", offering_key: "offer:1", direction_key: program.direction_key,
          direction_code: program.directionCode, quota_type: "special", places: 12 }),
      ],
    }));

    expect(summary.seats.map((metric) => metric.value)).toEqual(["—", "—"]);
    expect(summary.offers).toEqual([]);
    expect(summary.quotas).toEqual([]);
    expect(summary.relatedSeatFacts).toEqual([
      expect.objectContaining({ fundingType: "budget", value: "0 мест", sourceProgramName: "Другое название в источнике" }),
      expect.objectContaining({ fundingType: "paid", value: "Не указано", note: "Количество мест в источнике не указано." }),
    ]);
    expect(summary.relatedSeatFacts).toHaveLength(2);
  });

  it("excludes related seat facts without the same verified department, direction and campus", () => {
    const verifiedProgram: CatalogProgram = {
      ...program,
      department_relations: [{ department_key: "department:iu1", verification_status: "verified" }],
    };
    const baseOffer: Partial<Offering> = {
      program_key: null,
      program_link_status: "manual_review",
      direction_key: program.direction_key,
      direction_code: program.directionCode,
      department_key: "department:iu1",
      campus_scope: "head_moscow",
    };
    const excludedOffers: Offering[] = [
      offering({ ...baseOffer, external_key: "offer:other-campus", campus_scope: "branch_kaluga" }),
      offering({ ...baseOffer, external_key: "offer:other-department", department_key: "department:iu11" }),
      offering({ ...baseOffer, external_key: "offer:other-direction", direction_key: "direction:other" }),
      offering({ ...baseOffer, external_key: "offer:other-code", direction_code: "01.03.02" }),
      offering({ ...baseOffer, external_key: "offer:already-linked", program_key: "program:other" }),
    ];
    const candidatePool = pool({
      offering_keys: excludedOffers.map((item) => item.external_key),
      direction_key: program.direction_key,
      direction_code: program.directionCode,
    });
    expect(buildAdmissionSummary(verifiedProgram, data({ offerings: excludedOffers, pools: [candidatePool] }))
      .relatedSeatFacts).toEqual([]);

    const eligibleData = data({
      offerings: [offering(baseOffer)],
      pools: [pool({ offering_key: "offer:1", direction_key: program.direction_key, direction_code: program.directionCode })],
    });
    expect(buildAdmissionSummary({ ...verifiedProgram, campus_status: "unverified" }, eligibleData).relatedSeatFacts).toEqual([]);
    expect(buildAdmissionSummary({ ...verifiedProgram, department_relations: [
      { department_key: "department:iu1", verification_status: "manual_review" },
    ] }, eligibleData).relatedSeatFacts).toEqual([]);
  });

  it("recognizes department and full program labels without matching a neighboring department code", () => {
    const statistic = (
      externalKey: string,
      scopeType: "department" | "program",
      scopeLabel: string,
    ): ApiSchemas["OfficialAdmissionStatisticRecord"] => ({
      external_key: externalKey,
      ingested_at: "2026-01-01T00:00:00Z",
      year: 2026,
      direction_code: program.directionCode,
      admission_stage: "main",
      competition_type: "general",
      status: "numeric",
      funding_type: "budget",
      score: "280",
      scope_type: scopeType,
      scope_label: scopeLabel,
    });
    const summary = buildAdmissionSummary(program, data({ campaignStatistics: [
      statistic("stat:department", "department", "кафедра ИУ-1"),
      statistic("stat:department-spaced", "department", "Кафедра ИУ 1"),
      statistic("stat:neighbor", "department", "кафедра ИУ11"),
      statistic("stat:program", "program", `Программа: ${program.name}`),
      statistic("stat:program-full", "program", `Образовательная программа ${program.name}`),
      statistic("stat:other-program", "program", `Программа: ${program.name} и программирование`),
    ] }));

    expect(summary.campaignResults.map((result) => result.scopeLabel)).toEqual([
      "кафедра ИУ-1", "Кафедра ИУ 1", "Программа: Информатика", "Образовательная программа Информатика",
    ]);
    expect(summary.campaignResults[0]?.scopeNote).toBe("по кафедре ИУ-1");
    expect(summary.campaignResults[2]?.scopeNote).toBe("по программе Информатика");
  });
});
