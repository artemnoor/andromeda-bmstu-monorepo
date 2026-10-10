import { describe, expect, it } from "vitest";
import type { ApiSchemas } from "@/shared/api/client";
import type { CatalogProgram } from "@/features/catalog/model";
import { buildAdmissionSummary, type ProgramAdmissionData } from "@/features/catalog/admission-model";

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
      label: "Целевой приём · Бюджет · АО Концерн Галактика",
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
    expect(unlinkedSummary.quotaNote).toContain("кампус и связь с программой не подтверждены");
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
    expect(summary.seatNote).toContain("Связь предложения");
    expect(summary.offers).toEqual([]);
  });

  it("keeps an unknown study form visible when an exact offering only provides its duration", () => {
    const summary = buildAdmissionSummary(program, data({
      offerings: [offering({ study_form: null, study_duration_label: "6 лет" })],
    }));

    expect(summary.offers).toEqual(["Форма обучения: не указана", "Срок обучения: 6 лет"]);
  });
});
