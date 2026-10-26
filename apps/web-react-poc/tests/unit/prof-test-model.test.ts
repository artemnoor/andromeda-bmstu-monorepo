import { describe, expect, it } from "vitest";
import type { CatalogProgram } from "@/features/catalog/model";
import type { ApiSchemas, CurriculumItemDto, StudyPlanDto, SubjectTaxonomyDto } from "@/shared/api/client";
import {
  UNKNOWN_INTEREST,
  NO_ACTIVITY,
  admissionScoreStatus,
  buildProgramProfiles,
  buildProgramProfilesFromSnapshot,
  emptyAnswers,
  evaluateRequirement,
  fitFor,
  normalizedCategoryShare,
  rankPrograms,
  selectAdaptivePair,
  shouldFinishAfterComparison,
  type CareerTestAnswers,
  type SubjectCategory,
} from "@/features/prof-test/model";

function program(externalKey: string, code: string): CatalogProgram {
  return {
    external_key: externalKey,
    code,
    name: `Программа ${code}`,
    direction_key: `direction:${code}`,
    campus_status: "not_stated",
    department_relations: [],
    sources: [],
    directionCode: code,
    directionName: `Направление ${code}`,
    departmentCode: null,
    departmentName: null,
    departments: [],
    departmentStatus: "not_stated",
    sourceUrl: null,
  } as CatalogProgram;
}

function plan(externalKey: string, programKey: string, overrides: Partial<StudyPlanDto> = {}): StudyPlanDto {
  return {
    external_key: externalKey,
    program_key: programKey,
    academic_year: "2025-2026",
    status: "parsed",
    profile_link_status: "verified",
    item_count: 0,
    ...overrides,
  } as StudyPlanDto;
}

function item(
  externalKey: string,
  studyPlanKey: string,
  categoryCode: string | null,
  hours: number | null,
  overrides: Record<string, unknown> = {},
): CurriculumItemDto {
  return {
    external_key: externalKey,
    study_plan_key: studyPlanKey,
    ordinal: 1,
    hours,
    total_hours: hours === null ? null : hours * 3,
    subject_classification: categoryCode === null ? null : {
      category_code: categoryCode,
      category_name: categoryCode,
      confidence: 0.99,
      model: "Jev",
      probabilities: { "03": categoryCode === "03" ? 1 : 0, "04": categoryCode === "04" ? 1 : 0, "05": categoryCode === "05" ? 1 : 0, "06": categoryCode === "06" ? 1 : 0 },
      review_status: "classified",
      run_key: "run:test",
      taxonomy_key: "subjects",
      taxonomy_version: "v1",
    },
    ...overrides,
  } as unknown as CurriculumItemDto;
}

const categories: readonly SubjectCategory[] = [
  { code: "03", name: "Математика", definition: "", ordinal: 3 },
  { code: "04", name: "Физика", definition: "", ordinal: 4 },
  { code: "05", name: "Информатика", definition: "", ordinal: 5 },
  { code: "06", name: "Механика", definition: "", ordinal: 6 },
];

const taxonomy = {
  taxonomy_key: "subjects",
  taxonomy_version: "v1",
  categories: categories.map(({ code, name, definition, ordinal }) => ({
    category_code: code,
    name,
    definition,
    ordinal,
  })),
} as SubjectTaxonomyDto;

describe("career test profiles and ranking", () => {
  it("excludes sport and optional modules from professional interests and uses semester hours", () => {
    const result = buildProgramProfiles({
      programs: [program("program:a", "01.03.02-01")], plans: [plan("plan:a", "program:a")], taxonomy,
      itemsByPlanKey: new Map([["plan:a", [
        item("math", "plan:a", "03", 72, { total_hours: 432 }),
        item("pe", "plan:a", "04", 340, { discipline_name: "Элективный курс по физической культуре и спорту" }),
        item("vk", "plan:a", "05", 1512, { workload_scope: "optional" }),
      ]]]),
    });
    expect(result.profiles[0]?.totalHours).toBe(72);
    expect([...result.profiles[0]!.categoryHours]).toEqual([["03", 72]]);
  });
  it("uses exact latest verified plans and keeps the Jev category assignment when it needs review", () => {
    const programs = [
      program("program:a", "01.01.01"),
      program("program:b", "01.01.02"),
      program("program:c", "01.01.03"),
      program("program:missing", "01.01.04"),
    ];
    const plans = [
      plan("plan:a", "program:a", { item_count: 3 }),
      plan("plan:b", "program:b", { item_count: 2 }),
      plan("plan:c:old", "program:c", { academic_year: "2024-2025", item_count: 1 }),
      plan("plan:c:new", "program:c", { academic_year: "2025-2026", status: "unverified", item_count: 1 }),
      plan("plan:alias", "01.01.01", { item_count: 1 }),
    ];
    const result = buildProgramProfiles({
      programs,
      plans,
      itemsByPlanKey: new Map([
        ["plan:a", [
          item("a:math", "plan:a", "03", 80, { lecture_hours: 30 }),
          item("a:review", "plan:a", "04", 20, { subject_classification: { review_status: "needs_review", category_code: "04", taxonomy_key: "subjects", taxonomy_version: "v1" } }),
          item("a:taxonomy", "plan:a", "04", 15, { subject_classification: { review_status: "classified", category_code: "04", taxonomy_key: "subjects", taxonomy_version: "old" } }),
        ]],
        ["plan:b", [
          item("b:math", "plan:b", "03", 10),
          item("b:cs", "plan:b", "05", 90),
        ]],
        ["plan:c:old", [item("c:old", "plan:c:old", "03", 100)]],
      ]),
      taxonomy,
    });

    expect(result.profiles.map(({ program: entry, plan: selected }) => [entry.external_key, selected.external_key])).toEqual([
      ["program:a", "plan:a"],
      ["program:b", "plan:b"],
    ]);
    expect(result.profiles[0]).toMatchObject({
      totalHours: 115,
      assignedHours: 100,
      classifiedRows: 1,
      assignedRows: 2,
      reviewRows: 1,
    });
    expect(result.profiles[0]?.categoryHours).toEqual(new Map([["03", 80], ["04", 20]]));
    expect(result.totalCurriculumRows).toBe(5);
    expect(result.classifiedRows).toBe(3);
    expect(result.assignedRows).toBe(4);
    expect(result.reviewRows).toBe(1);
    expect(result.unavailableProgramCount).toBe(2);
  });

  it("keeps scores relative, applies avoid penalty and breaks ties by Russian program code", () => {
    const a = program("program:a", "01.01.01");
    const b = program("program:b", "01.01.02");
    const profiles = buildProgramProfiles({
      programs: [a, b],
      plans: [plan("plan:a", a.external_key), plan("plan:b", b.external_key)],
      itemsByPlanKey: new Map([
        ["plan:a", [item("a:math", "plan:a", "03", 80), item("a:other", "plan:a", "04", 20)]],
        ["plan:b", [item("b:math", "plan:b", "03", 10), item("b:other", "plan:b", "05", 90)]],
      ]),
      taxonomy,
    }).profiles;
    const answers = { ...emptyAnswers(), interests: ["03"] };
    const ranked = rankPrograms(profiles, answers);
    expect(ranked.map(({ profile }) => profile.program.external_key)).toEqual(["program:a", "program:b"]);
    expect(ranked[0]?.score).toBe(100);
    expect(ranked[1]?.score).toBeCloseTo(12.5);
    expect(normalizedCategoryShare(profiles[1]!, "03")).toBeCloseTo(0.125);
    expect(fitFor(profiles[0]!, { ...answers, avoid: ["03"] }).score).toBe(88);
    expect(fitFor(profiles[0]!, { ...answers, activity: NO_ACTIVITY }).activityFit).toBeNull();
    expect(rankPrograms(profiles, { ...emptyAnswers(), interests: [UNKNOWN_INTEREST] }).map(({ profile }) => profile.program.code)).toEqual(["01.01.01", "01.01.02"]);
  });

  it("omits a partially available activity signal for every program", () => {
    const a = program("program:a", "01.01.01");
    const b = program("program:b", "01.01.02");
    const profiles = buildProgramProfiles({
      programs: [a, b],
      plans: [plan("plan:a", a.external_key), plan("plan:b", b.external_key)],
      itemsByPlanKey: new Map([
        ["plan:a", [item("a:math", "plan:a", "03", 80, { lecture_hours: 40 })]],
        ["plan:b", [item("b:math", "plan:b", "03", 80)]],
      ]),
      taxonomy,
    }).profiles;
    const answers = { ...emptyAnswers(), interests: ["03"], activity: "lecture_hours" as const };
    const ranked = rankPrograms(profiles, answers);

    expect(ranked.map(({ activityFit, score }) => ({ activityFit, score }))).toEqual([
      { activityFit: null, score: 100 },
      { activityFit: null, score: 100 },
    ]);
  });

  it("chooses unused adaptive pairs and finishes at the comparison cap", () => {
    const programs = [program("program:a", "01.01.01"), program("program:b", "01.01.02")];
    const profiles = buildProgramProfiles({
      programs,
      plans: [plan("plan:a", "program:a"), plan("plan:b", "program:b")],
      itemsByPlanKey: new Map([
        ["plan:a", categories.map((category, index) => item(`a:${index}`, "plan:a", category.code, index === 0 ? 70 : 10))],
        ["plan:b", categories.map((category, index) => item(`b:${index}`, "plan:b", category.code, index === 1 ? 70 : 10))],
      ]),
      taxonomy,
    }).profiles;
    const first = selectAdaptivePair(profiles, categories, emptyAnswers());
    expect(first).not.toBeNull();
    const second = selectAdaptivePair(profiles, categories, {
      ...emptyAnswers(),
      comparisons: [{ left: first!.left, right: first!.right, value: 0 }],
    });
    expect(second).not.toBeNull();
    expect([second!.left, second!.right]).not.toContain(first!.left);
    expect([second!.left, second!.right]).not.toContain(first!.right);
    const capped = {
      ...emptyAnswers(),
      comparisons: [
        { left: "03", right: "04", value: 0 },
        { left: "05", right: "06", value: 0 },
        { left: "07", right: "08", value: 0 },
      ],
    };
    expect(shouldFinishAfterComparison(profiles, capped, { left: "09", right: "10", separation: 0 }, 0)).toBe(true);
  });

  it("builds rankings only when a release-bound snapshot exactly matches verified plan identity and totals", () => {
    const a = program("program:a", "01.01.01");
    const b = program("program:b", "01.01.02");
    const plans = [plan("plan:a", a.external_key, { item_count: 4 }), plan("plan:b", b.external_key, { item_count: 2 })];
    const snapshot = [
      {
        program_key: a.external_key,
        plan_key: "plan:a",
        plan_item_count: 4,
        total_hours: 90,
        assigned_hours: 90,
        classified_rows: 3,
        assigned_rows: 4,
        review_rows: 1,
        category_hours: { "03": 60, "04": 30 },
        activity_shares: { lecture_hours: 0.5, practice_hours: 0.5 },
      },
      {
        program_key: b.external_key,
        plan_key: "plan:b",
        plan_item_count: 2,
        total_hours: 80,
        assigned_hours: 80,
        classified_rows: 2,
        assigned_rows: 2,
        review_rows: 0,
        category_hours: { "04": 80 },
        activity_shares: {},
      },
    ];
    const result = buildProgramProfilesFromSnapshot({ programs: [a, b], plans, taxonomy, snapshots: snapshot });
    const withExcluded = buildProgramProfilesFromSnapshot({
      programs: [a, b], plans, taxonomy,
      snapshots: [{ ...snapshot[0]!, excluded_rows: 1, assigned_rows: 3, classified_rows: 2 }, snapshot[1]!],
    });
    expect(withExcluded.assignedRows).toBe(5);
    expect(() => buildProgramProfilesFromSnapshot({
      programs: [a, b], plans, taxonomy,
      snapshots: [{ ...snapshot[0]!, excluded_rows: 4 }, snapshot[1]!],
    })).toThrow(/invalid excluded row count/);

    expect(result.totalCurriculumRows).toBe(6);
    expect(result.classifiedRows).toBe(5);
    expect(result.assignedRows).toBe(6);
    expect(result.reviewRows).toBe(1);
    expect(result.profiles[0]?.plan.external_key).toBe("plan:a");
    expect(result.profiles[0]?.categoryShares.get("03")).toBeCloseTo(2 / 3);
    const activityAnswers = { ...emptyAnswers(), interests: ["03"], activity: "lecture_hours" as const };
    expect(result.profiles.map((profile) => fitFor(profile, activityAnswers).activityFit)).toEqual([null, null]);
    expect(() => buildProgramProfilesFromSnapshot({
      programs: [a, b],
      plans,
      taxonomy,
      snapshots: [{ ...snapshot[0]!, plan_key: "plan:alias" }, snapshot[1]!],
    })).toThrow(/does not match the selected verified plan/);
    expect(() => buildProgramProfilesFromSnapshot({
      programs: [a, b],
      plans,
      taxonomy,
      snapshots: [{ ...snapshot[0]!, category_hours: { "99": 90 } }, snapshot[1]!],
    })).toThrow(/invalid category assignment/);
    expect(() => buildProgramProfilesFromSnapshot({
      programs: [a, b],
      plans,
      taxonomy,
      snapshots: [{ ...snapshot[0]!, review_rows: 0 }, snapshot[1]!],
    })).toThrow(/invalid review counts/);
    expect(() => buildProgramProfilesFromSnapshot({
      programs: [a, b],
      plans,
      taxonomy,
      snapshots: [snapshot[0]!],
    })).toThrow(/every selected verified plan/);
    expect(() => buildProgramProfilesFromSnapshot({
      programs: [a, b],
      plans,
      taxonomy,
      snapshots: [{ ...snapshot[0]!, total_hours: 100 }, snapshot[1]!],
    })).toThrow(/invalid hours/);
  });

  it("samples every subject profile before interests are known, independently of code-order ties", () => {
    const programs = Array.from({ length: 14 }, (_, index) => program(`program:${index}`, `01.01.${String(index).padStart(2, "0")}`));
    const plans = programs.map((entry, index) => plan(`plan:${index}`, entry.external_key));
    const profiles = buildProgramProfiles({
      programs,
      plans,
      itemsByPlanKey: new Map(plans.map((entry, index) => [entry.external_key, [
        item(`item:${index}`, entry.external_key, index < 12 ? "03" : index === 12 ? "05" : "06", 100, { practice_hours: 50 }),
      ]])),
      taxonomy,
    }).profiles;
    const unknown: CareerTestAnswers = { ...emptyAnswers(), interests: [UNKNOWN_INTEREST], activity: NO_ACTIVITY };
    const expected = selectAdaptivePair(profiles, categories, unknown);

    // The first 12 profiles share one subject mix; the remaining two must
    // still influence the question instead of being excluded by code order.
    expect(expected?.separation).toBeGreaterThan(0.1);
    const reversed = selectAdaptivePair([...profiles].reverse(), categories, unknown);
    expect([reversed?.left, reversed?.right]).toEqual([expected?.left, expected?.right]);
    expect(reversed?.separation).toBeCloseTo(expected!.separation);
    expect(selectAdaptivePair(profiles, categories, { ...unknown, activity: "practice_hours" })).toEqual(expected);
  });
});

describe("admission score checks", () => {
  const leaf = (subjectCode: string, minimum: string) => ({
    kind: "leaf" as const,
    node_key: `leaf:${subjectCode}`,
    subject_code: subjectCode,
    minimum_score: minimum,
  });

  it("evaluates AND, OR, and AT_LEAST with unknown scores kept distinct from failures", () => {
    const andRule = { kind: "operator" as const, node_key: "and", operator: "AND" as const, children: [leaf("math", "70"), leaf("physics", "60")] };
    const orRule = { kind: "operator" as const, node_key: "or", operator: "OR" as const, children: [leaf("math", "70"), leaf("physics", "60")] };
    const thresholdRule = { kind: "operator" as const, node_key: "threshold", operator: "AT_LEAST" as const, threshold: 2, children: [leaf("math", "70"), leaf("physics", "60"), leaf("informatics", "50")] };

    expect(evaluateRequirement(andRule, { math: 70, physics: 59 })).toBe(false);
    expect(evaluateRequirement(andRule, { math: 70 })).toBeNull();
    expect(evaluateRequirement(orRule, { math: 70 })).toBe(true);
    expect(evaluateRequirement(orRule, { math: 20, physics: "" })).toBeNull();
    expect(evaluateRequirement(thresholdRule, { math: 80, physics: 70 })).toBe(true);
    expect(evaluateRequirement(thresholdRule, { math: 80, physics: 20 })).toBeNull();
    expect(evaluateRequirement(thresholdRule, { math: 20, physics: 20 })).toBe(false);
    expect(evaluateRequirement(leaf("math", "70"), { math: 101 })).toBeNull();
    expect(evaluateRequirement(leaf("math", "70"), { math: -1 })).toBeNull();
    expect(evaluateRequirement(leaf("math", "70"), { math: 70.5 })).toBeNull();
    expect(evaluateRequirement(leaf("math", "70.5"), { math: 80 })).toBeNull();
    expect(evaluateRequirement(leaf("math", "70"), { math: 100 })).toBe(true);
  });

  it("summarizes all, some, failed, incomplete, and absent requirement checks", () => {
    const requirement = (root: ReturnType<typeof leaf>) => ({ root }) as ApiSchemas["RequirementTreeRecord"];
    const requirements = [requirement(leaf("math", "60")), requirement(leaf("physics", "60"))];

    expect(admissionScoreStatus([], { math: 100 })).toBe("no-requirements");
    expect(admissionScoreStatus(requirements, {})).toBe("no-scores");
    expect(admissionScoreStatus(requirements, { math: 80, physics: 80 })).toBe("passed-all");
    expect(admissionScoreStatus(requirements, { math: 80, physics: 20 })).toBe("passed-some");
    expect(admissionScoreStatus(requirements, { math: 20, physics: 20 })).toBe("failed-all");
    const incompleteAndRule = {
      kind: "operator" as const,
      node_key: "and:incomplete",
      operator: "AND" as const,
      children: [leaf("math", "60"), leaf("physics", "60")],
    } as ApiSchemas["RequirementTreeRecord"]["root"];
    expect(admissionScoreStatus([{ root: incompleteAndRule } as ApiSchemas["RequirementTreeRecord"]], { math: 80 })).toBe("incomplete");
  });
});
