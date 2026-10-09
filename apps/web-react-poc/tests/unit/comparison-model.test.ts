import { describe, expect, it } from "vitest";
import type { components } from "@/shared/api/schema";
import {
  buildCurriculumComparison,
  nullableFiniteNumber,
  selectLatestVerifiedPlans,
  type CurriculumItemDto,
  type StudyPlanDto,
  type SubjectTaxonomyDto,
} from "@/features/comparison/model";

function plan(overrides: Partial<StudyPlanDto> = {}): StudyPlanDto {
  return {
    external_key: "plan:a:2025",
    program_key: "program:a",
    academic_year: "2025-2026",
    status: "parsed",
    profile_link_status: "verified",
    ...overrides,
  };
}

function item(overrides: Partial<CurriculumItemDto> = {}): CurriculumItemDto {
  return {
    external_key: "item:one",
    study_plan_key: "plan:a:2025",
    ordinal: 1,
    ...overrides,
  };
}

function taxonomy(overrides: Partial<SubjectTaxonomyDto> = {}): SubjectTaxonomyDto {
  return {
    taxonomy_key: "bmstu-subject-domain-16",
    taxonomy_version: "v1",
    name: "BMSTU subject domain",
    description: "Subject classification for comparison.",
    categories: [{ category_code: "03", name: "Mathematics", definition: "", ordinal: 3 }],
    ...overrides,
  };
}

function classifiedItem(
  externalKey: string,
  studyPlanKey: string,
  categoryOverrides: Partial<components["schemas"]["SubjectClassificationSummary"]> = {},
  itemOverrides: Partial<CurriculumItemDto> = {},
): CurriculumItemDto {
  return item({
    external_key: externalKey,
    study_plan_key: studyPlanKey,
    discipline_name: externalKey,
    ...itemOverrides,
    subject_classification: {
      category_code: "03",
      category_name: "Mathematics",
      confidence: 1,
      model: "fixture",
      probabilities: { "03": 1 },
      review_status: "classified",
      run_key: "classification:fixture",
      taxonomy_key: "bmstu-subject-domain-16",
      taxonomy_version: "v1",
      ...categoryOverrides,
    },
  });
}

describe("comparison domain model", () => {
  it("uses only the exact program key and refuses ties or a newer plan that needs review", () => {
    const plans = [
      plan({ external_key: "plan:a:old", program_key: "program:a", academic_year: "2024-2025" }),
      plan({
        external_key: "plan:a:pending",
        program_key: "program:a",
        academic_year: "2025-2026",
        profile_link_status: "manual_review",
      }),
      plan({ external_key: "plan:b:first", program_key: "program:b", academic_year: "2025-2026" }),
      plan({ external_key: "plan:b:second", program_key: "program:b", academic_year: "2025-2026" }),
      plan({ external_key: "plan:a:code-alias", program_key: "A" }),
    ];

    const selections = selectLatestVerifiedPlans(["program:a", "program:b", "A", "program:missing"], plans);

    expect(selections.map(({ programKey, status }) => [programKey, status])).toEqual([
      ["program:a", "needs-review"],
      ["program:b", "ambiguous"],
      ["A", "ready"],
      ["program:missing", "missing"],
    ]);
    expect(selections[0]?.currentPlan?.external_key).toBe("plan:a:pending");
    expect(selections[0]?.selectedPlan).toBeNull();
    expect(selections[1]?.currentPlan).toBeNull();
    expect(selections[2]?.selectedPlan?.external_key).toBe("plan:a:code-alias");
  });

  it("does not fall back to an older verified plan when the unique latest plan is unverified or unparsed", () => {
    const selections = selectLatestVerifiedPlans(["program:a", "program:b"], [
      plan({ external_key: "plan:a:old", program_key: "program:a", academic_year: "2024-2025" }),
      plan({
        external_key: "plan:a:new",
        program_key: "program:a",
        academic_year: "2025-2026",
        status: "unverified",
      }),
      plan({ external_key: "plan:b:old", program_key: "program:b", academic_year: "2024-2025" }),
      plan({
        external_key: "plan:b:new",
        program_key: "program:b",
        academic_year: "2025-2026",
        status: "parsed",
        profile_link_status: "unresolved",
      }),
    ]);

    expect(selections.map((selection) => selection.status)).toEqual(["needs-review", "needs-review"]);
    expect(selections.map((selection) => selection.currentPlan?.external_key)).toEqual(["plan:a:new", "plan:b:new"]);
    expect(selections.map((selection) => selection.selectedPlan)).toEqual([null, null]);
  });

  it("rejects multiple candidate plans when a year is unknown instead of guessing the newest", () => {
    const [selection] = selectLatestVerifiedPlans(["program:a"], [
      plan({ external_key: "plan:a:known", academic_year: "2025-2026" }),
      plan({ external_key: "plan:a:unknown-year", academic_year: null }),
    ]);
    expect(selection?.status).toBe("ambiguous");
    expect(selection?.selectedPlan).toBeNull();
  });

  it("keeps curriculum rows isolated by exact selected plan key and program key", () => {
    const result = buildCurriculumComparison({
      programKeys: ["program:1", "program:10"],
      plans: [
        plan({ external_key: "plan:1", program_key: "program:1" }),
        plan({ external_key: "plan:10", program_key: "program:10" }),
        plan({ external_key: "plan:10-extra", program_key: "program:10-extra" }),
      ],
      itemsByPlanKey: new Map([
        ["plan:1", [
          item({ external_key: "item:one", study_plan_key: "plan:1", discipline_name: "Only program one" }),
          item({ external_key: "item:wrong-plan", study_plan_key: "plan:10", discipline_name: "Must be excluded" }),
        ]],
        ["plan:10", [item({ external_key: "item:ten", study_plan_key: "plan:10", discipline_name: "Only program ten" })]],
        ["plan:10-extra", [item({ external_key: "item:extra", study_plan_key: "plan:10-extra", discipline_name: "Not selected" })]],
      ]),
      taxonomy: null,
    });

    expect(result.programs.map((program) => program.items.map((row) => [row.programKey, row.planKey, row.displayName]))).toEqual([
      [["program:1", "plan:1", "Only program one"]],
      [["program:10", "plan:10", "Only program ten"]],
    ]);
    expect(result.matrixRows.map((row) => row.title)).toEqual(["Only program one", "Only program ten"]);
  });

  it("keeps three programs' category and semester workloads isolated by their verified plan", () => {
    const result = buildCurriculumComparison({
      programKeys: ["program:a", "program:b", "program:c"],
      plans: [
        plan({ external_key: "plan:a", program_key: "program:a" }),
        plan({ external_key: "plan:b", program_key: "program:b" }),
        plan({ external_key: "plan:c", program_key: "program:c" }),
      ],
      itemsByPlanKey: new Map([
        ["plan:a", [classifiedItem("item:a", "plan:a", {}, { semester: 1, total_hours: 10, credits: "1" }), item({ external_key: "item:a2", study_plan_key: "plan:a", discipline_name: "Algorithms", semester: 2, total_hours: 15, credits: "1" })]],
        ["plan:b", [classifiedItem("item:b", "plan:b", { category_code: "04" }, { semester: 1, total_hours: 20, credits: "2" }), item({ external_key: "item:b2", study_plan_key: "plan:b", discipline_name: "Databases", semester: 4, total_hours: 45, credits: "3" })]],
        ["plan:c", [classifiedItem("item:c", "plan:c", {}, { semester: 1, total_hours: 30, credits: "3" }), item({ external_key: "item:c2", study_plan_key: "plan:c", discipline_name: "Networks", semester: 6, total_hours: 75, credits: "5" })]],
      ]),
      taxonomy: taxonomy({ categories: [
        { category_code: "03", name: "Mathematics", definition: "", ordinal: 3 },
        { category_code: "04", name: "Computer science", definition: "", ordinal: 4 },
      ] }),
    });

    expect(result.programs.map(({ programKey, total }) => [programKey, total.hours, total.credits])).toEqual([
      ["program:a", { value: 25, count: 2 }, { value: 2, count: 2 }],
      ["program:b", { value: 65, count: 2 }, { value: 5, count: 2 }],
      ["program:c", { value: 105, count: 2 }, { value: 8, count: 2 }],
    ]);
    expect(result.programs.map(({ categories }) => categories.map(({ categoryCode, hours, credits }) => [categoryCode, hours, credits]))).toEqual([
      [["03", { value: 10, count: 1 }, { value: 1, count: 1 }], [null, { value: 15, count: 1 }, { value: 1, count: 1 }]],
      [["04", { value: 20, count: 1 }, { value: 2, count: 1 }], [null, { value: 45, count: 1 }, { value: 3, count: 1 }]],
      [["03", { value: 30, count: 1 }, { value: 3, count: 1 }], [null, { value: 75, count: 1 }, { value: 5, count: 1 }]],
    ]);
    expect(result.programs.map(({ semesters }) => semesters.map(({ key, hours }) => [key, hours.value]))).toEqual([
      [["1", 10], ["2", 15]],
      [["1", 20], ["4", 45]],
      [["1", 30], ["6", 75]],
    ]);
  });

  it("preserves explicit zero, applies total_hours nullish fallback, and keeps unknown metrics nullable", () => {
    const result = buildCurriculumComparison({
      programKeys: ["program:a"],
      plans: [plan()],
      itemsByPlanKey: new Map([[
        "plan:a:2025",
        [
          item({ external_key: "item:zero", semester: 1, total_hours: 0, hours: 45, credits: "0" }),
          item({ external_key: "item:fallback", ordinal: 2, semester: 1, total_hours: null, hours: 30, credits: "3.5" }),
          item({ external_key: "item:unknown", ordinal: 3, semester: null, total_hours: null, hours: null, credits: "  " }),
        ],
      ]]),
      taxonomy: null,
    });
    const program = result.programs[0];

    expect(nullableFiniteNumber(0)).toBe(0);
    expect(nullableFiniteNumber("0")).toBe(0);
    expect(nullableFiniteNumber(" ")).toBeNull();
    expect(nullableFiniteNumber("NaN")).toBeNull();
    expect(program?.items.map((row) => [row.hours, row.credits, row.semesterKey])).toEqual([
      [0, 0, "1"],
      [30, 3.5, "1"],
      [null, null, "unknown"],
    ]);
    expect(program?.total).toEqual({
      hours: { value: 30, count: 2 },
      credits: { value: 3.5, count: 2 },
    });
    expect(program?.semesters).toEqual([
      { key: "1", semester: 1, hours: { value: 30, count: 2 }, credits: { value: 3.5, count: 2 } },
      { key: "unknown", semester: null, hours: { value: 0, count: 0 }, credits: { value: 0, count: 0 } },
    ]);
  });

  it("requires a matching verified taxonomy category and preserves every other course as unclassified", () => {
    const matchingTaxonomy = taxonomy();
    const result = buildCurriculumComparison({
      programKeys: ["program:a"],
      plans: [plan()],
      itemsByPlanKey: new Map([[
        "plan:a:2025",
        [
          classifiedItem("item:verified", "plan:a:2025"),
          classifiedItem("item:review", "plan:a:2025", { review_status: "needs_review" }),
          classifiedItem("item:wrong-taxonomy", "plan:a:2025", { taxonomy_key: "other-taxonomy" }),
          classifiedItem("item:unknown-category", "plan:a:2025", { category_code: "99" }),
        ],
      ]]),
      taxonomy: matchingTaxonomy,
    });

    const program = result.programs[0];
    expect(program?.items.map((row) => row.classification?.categoryName ?? null)).toEqual([
      "Mathematics", null, null, null,
    ]);
    expect(program?.categories.map(({ key, name, items }) => [key, name, items.length])).toEqual([
      ["code:03", "Mathematics", 1],
      ["__unclassified__", "Категория не указана", 3],
    ]);
    expect(result.taxonomyCategories).toEqual(matchingTaxonomy.categories);
  });

  it("keeps courses unclassified when taxonomy is unavailable and labels title groups as visual only", () => {
    const result = buildCurriculumComparison({
      programKeys: ["program:a", "program:b"],
      plans: [
        plan({ external_key: "plan:a", program_key: "program:a" }),
        plan({ external_key: "plan:b", program_key: "program:b" }),
      ],
      itemsByPlanKey: new Map([
        ["plan:a", [item({ external_key: "item:a", study_plan_key: "plan:a", discipline_name: "Linear Algebra" })]],
        ["plan:b", [item({ external_key: "item:b", study_plan_key: "plan:b", discipline_name: "linear algebra" })]],
      ]),
      taxonomy: null,
    });

    expect(result.programs.every((program) => program.items[0]?.classification === null)).toBe(true);
    expect(result.matrixRows).toHaveLength(1);
    expect(result.matrixRows[0]?.identityBasis).toBe("matching-title-for-display");
    expect([...result.matrixRows[0]!.itemsByProgram.keys()]).toEqual(["program:a", "program:b"]);
    expect(result.matrixIdentityNote).toContain("не подтверждает идентичность дисциплин");
  });

  it("does not merge unnamed courses from separate plans into one visual row", () => {
    const result = buildCurriculumComparison({
      programKeys: ["program:a", "program:b"],
      plans: [
        plan({ external_key: "plan:a", program_key: "program:a" }),
        plan({ external_key: "plan:b", program_key: "program:b" }),
      ],
      itemsByPlanKey: new Map([
        ["plan:a", [item({ external_key: "item:a", study_plan_key: "plan:a", discipline_name: null })]],
        ["plan:b", [item({ external_key: "item:b", study_plan_key: "plan:b", discipline_name: null })]],
      ]),
      taxonomy: null,
    });

    expect(result.matrixRows).toHaveLength(2);
    expect(result.matrixRows.every((row) => row.identityBasis === "unnamed-item")).toBe(true);
  });
});
