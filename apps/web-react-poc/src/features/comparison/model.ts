import type { components } from "@/shared/api/schema";

export type StudyPlanDto = components["schemas"]["StudyPlanRecord"];
export type CurriculumItemDto = components["schemas"]["CurriculumItemRecord"];
export type SubjectTaxonomyDto = components["schemas"]["SubjectTaxonomyRecord"];

export type PlanSelectionStatus = "ready" | "missing" | "ambiguous" | "needs-review";

export interface PlanSelection {
  programKey: string;
  status: PlanSelectionStatus;
  /** The unique latest plan, even when it is not eligible for comparison. */
  currentPlan: StudyPlanDto | null;
  /** Set only when the unique latest plan is parsed and verified. */
  selectedPlan: StudyPlanDto | null;
  candidatePlanKeys: string[];
}

export interface NullableMetric {
  /** Sum of known numeric values. Use count to distinguish no data from a real zero. */
  value: number;
  count: number;
}

export interface SubjectClassification {
  categoryCode: string;
  categoryName: string;
  taxonomyKey: string;
  taxonomyVersion: string;
}

export interface ComparisonCurriculumItem {
  externalKey: string;
  programKey: string;
  planKey: string;
  ordinal: number;
  disciplineName: string | null;
  displayName: string;
  semester: number | null;
  /** String key intended for filters and grouping; missing semester is "unknown". */
  semesterKey: string;
  credits: number | null;
  hours: number | null;
  assessmentType: string | null;
  classification: SubjectClassification | null;
}

export interface SemesterWorkload {
  key: string;
  semester: number | null;
  hours: NullableMetric;
  credits: NullableMetric;
}

export interface CategoryWorkload {
  key: string;
  categoryCode: string | null;
  name: string;
  items: ComparisonCurriculumItem[];
  hours: NullableMetric;
  credits: NullableMetric;
}

export interface ProgramComparisonModel {
  programKey: string;
  planSelection: PlanSelection;
  itemsStatus: "loaded" | "unavailable";
  items: ComparisonCurriculumItem[];
  total: { hours: NullableMetric; credits: NullableMetric };
  semesters: SemesterWorkload[];
  categories: CategoryWorkload[];
}

export interface MatrixTitleGroup {
  /** Display grouping key only; it is not a canonical curriculum-item identity. */
  visualKey: string;
  title: string;
  identityBasis: "matching-title-for-display" | "unnamed-item";
  itemsByProgram: ReadonlyMap<string, readonly ComparisonCurriculumItem[]>;
}

export interface CurriculumComparisonModel {
  programs: ProgramComparisonModel[];
  matrixRows: MatrixTitleGroup[];
  taxonomyCategories: SubjectTaxonomyDto["categories"];
  matrixIdentityNote: string;
}

export interface BuildCurriculumComparisonInput {
  programKeys: readonly string[];
  /** Include all linked versions, including unverified/review-pending plans. */
  plans: readonly StudyPlanDto[];
  /** Items must be grouped by study-plan external key. */
  itemsByPlanKey: ReadonlyMap<string, readonly CurriculumItemDto[]>;
  taxonomy: SubjectTaxonomyDto | null;
  /** Failed requests are distinct from a legitimately empty plan. */
  unavailablePlanKeys?: ReadonlySet<string>;
}

const MISSING_DISCIPLINE_NAME = "Название не указано";
const UNCLASSIFIED_KEY = "__unclassified__";

/** Parses finite numbers while preserving an explicit zero and treating blank strings as missing. */
export function nullableFiniteNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function academicYearEnd(value: string | null | undefined): number | null {
  const years = value?.match(/(?:19|20)\d{2}/g)?.map(Number) ?? [];
  return years.length ? Math.max(...years) : null;
}

/**
 * Selects a plan only when its latest version is unique and verified. A newer
 * pending/unverified plan blocks an older verified one; it is never a fallback.
 */
export function selectLatestVerifiedPlans(
  programKeys: readonly string[],
  plans: readonly StudyPlanDto[],
): PlanSelection[] {
  const uniqueProgramKeys = [...new Set(programKeys.filter((key) => key.trim() !== ""))];
  return uniqueProgramKeys.map((programKey) => {
    const candidates = plans.filter((plan) => plan.program_key === programKey);
    const candidatePlanKeys = candidates.map((plan) => plan.external_key);
    if (!candidates.length) {
      return { programKey, status: "missing", currentPlan: null, selectedPlan: null, candidatePlanKeys };
    }

    let latestCandidates = candidates;
    if (candidates.length > 1) {
      const yearEnds = candidates.map((plan) => academicYearEnd(plan.academic_year));
      if (yearEnds.some((year) => year === null)) {
        return { programKey, status: "ambiguous", currentPlan: null, selectedPlan: null, candidatePlanKeys };
      }
      const latestYear = Math.max(...yearEnds.filter((year): year is number => year !== null));
      latestCandidates = candidates.filter((_, index) => yearEnds[index] === latestYear);
      if (latestCandidates.length !== 1) {
        return { programKey, status: "ambiguous", currentPlan: null, selectedPlan: null, candidatePlanKeys };
      }
    }

    const currentPlan = latestCandidates[0];
    if (!currentPlan) {
      return { programKey, status: "ambiguous", currentPlan: null, selectedPlan: null, candidatePlanKeys };
    }
    const verifiedAndParsed = currentPlan.status === "parsed" && currentPlan.profile_link_status === "verified";
    return {
      programKey,
      status: verifiedAndParsed ? "ready" : "needs-review",
      currentPlan,
      selectedPlan: verifiedAndParsed ? currentPlan : null,
      candidatePlanKeys,
    };
  });
}

function classifyItem(
  item: CurriculumItemDto,
  taxonomy: SubjectTaxonomyDto | null,
): SubjectClassification | null {
  const source = item.subject_classification;
  if (!source || source.review_status !== "classified" || !taxonomy) return null;
  if (source.taxonomy_key !== taxonomy.taxonomy_key || source.taxonomy_version !== taxonomy.taxonomy_version) return null;
  const category = taxonomy.categories.find((entry) => entry.category_code === source.category_code);
  if (!category) return null;
  return {
    categoryCode: category.category_code,
    categoryName: category.name,
    taxonomyKey: taxonomy.taxonomy_key,
    taxonomyVersion: taxonomy.taxonomy_version,
  };
}

function normalizeItem(
  item: CurriculumItemDto,
  programKey: string,
  planKey: string,
  taxonomy: SubjectTaxonomyDto | null,
): ComparisonCurriculumItem {
  const disciplineName = item.discipline_name?.trim() || null;
  const semester = nullableFiniteNumber(item.semester);
  return {
    externalKey: item.external_key,
    programKey,
    planKey,
    ordinal: item.ordinal,
    disciplineName,
    displayName: disciplineName ?? MISSING_DISCIPLINE_NAME,
    semester,
    semesterKey: semester === null ? "unknown" : String(semester),
    credits: nullableFiniteNumber(item.credits),
    // Keep parity with the original adapter's `total_hours ?? hours` rule.
    hours: nullableFiniteNumber(item.total_hours ?? item.hours),
    assessmentType: item.control_form?.trim() || null,
    classification: classifyItem(item, taxonomy),
  };
}

function sumMetric(items: readonly ComparisonCurriculumItem[], field: "hours" | "credits"): NullableMetric {
  let value = 0;
  let count = 0;
  for (const item of items) {
    const metric = item[field];
    if (metric === null) continue;
    value += metric;
    count += 1;
  }
  return { value, count };
}

function compareSemester(left: string, right: string): number {
  if (left === "unknown") return right === "unknown" ? 0 : 1;
  if (right === "unknown") return -1;
  return Number(left) - Number(right);
}

function buildSemesters(items: readonly ComparisonCurriculumItem[]): SemesterWorkload[] {
  const groups = new Map<string, ComparisonCurriculumItem[]>();
  for (const item of items) {
    const group = groups.get(item.semesterKey) ?? [];
    group.push(item);
    groups.set(item.semesterKey, group);
  }
  return [...groups]
    .sort(([left], [right]) => compareSemester(left, right))
    .map(([key, group]) => ({
      key,
      semester: key === "unknown" ? null : nullableFiniteNumber(key),
      hours: sumMetric(group, "hours"),
      credits: sumMetric(group, "credits"),
    }));
}

function buildCategories(items: readonly ComparisonCurriculumItem[]): CategoryWorkload[] {
  const groups = new Map<string, { code: string | null; name: string; items: ComparisonCurriculumItem[] }>();
  for (const item of items) {
    const classification = item.classification;
    const key = classification ? `code:${classification.categoryCode}` : UNCLASSIFIED_KEY;
    const group = groups.get(key) ?? {
      code: classification?.categoryCode ?? null,
      name: classification?.categoryName ?? "Категория не указана",
      items: [],
    };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups]
    .sort(([left], [right]) => left === UNCLASSIFIED_KEY ? 1 : right === UNCLASSIFIED_KEY ? -1 : left.localeCompare(right, "ru"))
    .map(([key, group]) => ({
      key,
      categoryCode: group.code,
      name: group.name,
      items: group.items,
      hours: sumMetric(group.items, "hours"),
      credits: sumMetric(group.items, "credits"),
    }));
}

function buildMatrixRows(programs: readonly ProgramComparisonModel[]): MatrixTitleGroup[] {
  const groups = new Map<string, Map<string, ComparisonCurriculumItem[]>>();
  const titles = new Map<string, string>();
  const identityBases = new Map<string, MatrixTitleGroup["identityBasis"]>();

  for (const program of programs) {
    for (const item of program.items) {
      const normalizedTitle = item.disciplineName?.toLocaleLowerCase("ru-RU");
      const visualKey = normalizedTitle
        ? `title:${normalizedTitle}`
        : `unnamed:${program.programKey}:${item.planKey}:${item.externalKey}`;
      const itemsByProgram = groups.get(visualKey) ?? new Map<string, ComparisonCurriculumItem[]>();
      const programItems = itemsByProgram.get(program.programKey) ?? [];
      programItems.push(item);
      itemsByProgram.set(program.programKey, programItems);
      groups.set(visualKey, itemsByProgram);
      titles.set(visualKey, item.disciplineName ?? MISSING_DISCIPLINE_NAME);
      identityBases.set(visualKey, normalizedTitle ? "matching-title-for-display" : "unnamed-item");
    }
  }

  const result = [...groups].map(([visualKey, itemsByProgram]) => ({
    visualKey,
    title: titles.get(visualKey) ?? MISSING_DISCIPLINE_NAME,
    identityBasis: identityBases.get(visualKey) ?? "unnamed-item",
    itemsByProgram,
  }));
  return result.sort((left, right) => {
    const leftSemester = Math.min(...[...left.itemsByProgram.values()].flat().map((item) => item.semester ?? Number.POSITIVE_INFINITY));
    const rightSemester = Math.min(...[...right.itemsByProgram.values()].flat().map((item) => item.semester ?? Number.POSITIVE_INFINITY));
    return leftSemester - rightSemester || left.title.localeCompare(right.title, "ru");
  });
}

/**
 * Builds comparison-ready data only from a uniquely latest verified plan for
 * each exact program key. Matrix title matching is visual grouping only.
 */
export function buildCurriculumComparison(input: BuildCurriculumComparisonInput): CurriculumComparisonModel {
  const selections = selectLatestVerifiedPlans(input.programKeys, input.plans);
  const programs = selections.map((planSelection): ProgramComparisonModel => {
    const selectedPlan = planSelection.selectedPlan;
    const planKey = selectedPlan?.external_key ?? "";
    const unavailable = selectedPlan !== null && (input.unavailablePlanKeys?.has(planKey) ?? false);
    const rows = selectedPlan && !unavailable
      ? (input.itemsByPlanKey.get(planKey) ?? [])
        .filter((item) => item.study_plan_key === planKey)
        .map((item) => normalizeItem(item, planSelection.programKey, planKey, input.taxonomy))
      : [];
    return {
      programKey: planSelection.programKey,
      planSelection,
      itemsStatus: unavailable ? "unavailable" : "loaded",
      items: rows,
      total: { hours: sumMetric(rows, "hours"), credits: sumMetric(rows, "credits") },
      semesters: buildSemesters(rows),
      categories: buildCategories(rows),
    };
  });

  return {
    programs,
    matrixRows: buildMatrixRows(programs),
    taxonomyCategories: input.taxonomy?.categories ?? [],
    matrixIdentityNote: "Совпадение названия объединяет строки только для отображения и само по себе не подтверждает идентичность дисциплин.",
  };
}
