import type { ApiSchemas, CurriculumItemDto, SubjectTaxonomyDto, StudyPlanDto } from "@/shared/api/client";
import type { CatalogProgram } from "@/features/catalog/model";
import { selectLatestVerifiedPlans } from "@/features/comparison/model";

export const MAX_INTERESTS = 5;
export const MAX_AVOID = 3;
export const MAX_COMPARISONS = 4;
export const UNKNOWN_INTEREST = "__unknown__";
export const NO_AVOID = "__none__";
export const NO_ACTIVITY = "__no_activity_preference__";

export const ACTIVITY_OPTIONS = [
  { key: "lecture_hours", icon: "01", title: "Слушать и разбираться", detail: "Лекции и объяснение основ" },
  { key: "practice_hours", icon: "02", title: "Решать задачи", detail: "Практические занятия и применение методов" },
  { key: "lab_hours", icon: "03", title: "Собирать и проверять", detail: "Лабораторные и экспериментальная работа" },
  { key: "self_study_hours", icon: "04", title: "Изучать самому", detail: "Самостоятельная работа по плану" },
] as const;

export const PAIR_CHOICES = [
  { value: 2, title: "Точно первое", note: "гораздо интереснее" },
  { value: 1, title: "Скорее первое", note: "немного интереснее" },
  { value: 0, title: "Одинаково", note: "нет предпочтения" },
  { value: -1, title: "Скорее второе", note: "немного интереснее" },
  { value: -2, title: "Точно второе", note: "гораздо интереснее" },
] as const;

export type ActivityKey = (typeof ACTIVITY_OPTIONS)[number]["key"];
export type CareerTestPhase = "interests" | "activity" | "avoid" | "compare" | "results";

export interface SubjectCategory {
  readonly code: string;
  readonly name: string;
  readonly definition: string;
  readonly ordinal: number;
}

export interface PairAnswer {
  readonly left: string;
  readonly right: string;
  readonly value: number;
}

export interface CareerTestAnswers {
  readonly interests: readonly string[];
  readonly activity: ActivityKey | typeof NO_ACTIVITY | "";
  readonly avoid: readonly string[];
  readonly comparisons: readonly PairAnswer[];
}

export interface CategoryPair {
  readonly left: string;
  readonly right: string;
  readonly separation: number;
}

export interface CareerTestProfile {
  readonly program: CatalogProgram;
  readonly plan: StudyPlanDto;
  readonly totalHours: number;
  readonly assignedHours: number;
  readonly classifiedRows: number;
  readonly assignedRows: number;
  readonly reviewRows: number;
  readonly categoryHours: ReadonlyMap<string, number>;
  readonly categoryShares: ReadonlyMap<string, number>;
  readonly activityShares: Readonly<Partial<Record<ActivityKey, number>>>;
  readonly maxCategoryShares: ReadonlyMap<string, number>;
  readonly maxActivityShares: Readonly<Partial<Record<ActivityKey, number>>>;
}

export interface ProfileBuildResult {
  readonly profiles: readonly CareerTestProfile[];
  readonly totalCurriculumRows: number;
  readonly classifiedRows: number;
  readonly assignedRows: number;
  readonly reviewRows: number;
  readonly unavailableProgramCount: number;
}

export interface RankedCareerProfile {
  readonly profile: CareerTestProfile;
  readonly score: number;
  readonly subjectFit: number;
  readonly activityFit: number | null;
  readonly avoidFit: number;
  readonly positivePreferences: readonly (readonly [string, number])[];
}

export interface ProfileBuildInput {
  readonly programs: readonly CatalogProgram[];
  readonly plans: readonly StudyPlanDto[];
  readonly itemsByPlanKey: ReadonlyMap<string, readonly CurriculumItemDto[]>;
  readonly taxonomy: SubjectTaxonomyDto;
}

export interface CareerTestProfileSnapshotRecord {
  readonly program_key: string;
  readonly plan_key: string;
  readonly plan_item_count: number;
  readonly total_hours: number;
  readonly assigned_hours: number;
  readonly classified_rows: number;
  readonly assigned_rows: number;
  readonly review_rows: number;
  readonly category_hours: Readonly<Record<string, number>>;
  readonly activity_shares: Readonly<Partial<Record<ActivityKey, number>>>;
}

type RequirementNode = ApiSchemas["RequirementLeaf"] | ApiSchemas["RequirementOperatorNode"];
type RequirementRecord = ApiSchemas["RequirementTreeRecord"];

export type AdmissionScoreStatus =
  | "no-requirements"
  | "no-scores"
  | "passed-all"
  | "passed-some"
  | "failed-all"
  | "incomplete";

export function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || (typeof value !== "number" && typeof value !== "string")) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function examScore(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && Number.isInteger(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}

/** Evaluate published AND/OR/AT_LEAST exam rules with unknown scores kept unknown. */
export function evaluateRequirement(
  node: RequirementNode,
  scores: Readonly<Record<string, unknown>>,
): boolean | null {
  if (node.kind === "leaf") {
    if (!node.subject_code) return null;
    const score = examScore(scores[node.subject_code]);
    const minimum = examScore(node.minimum_score);
    return score === null || minimum === null ? null : score >= minimum;
  }

  const children = node.children.map((child) => evaluateRequirement(child, scores));
  if (!children.length) return null;
  if (node.operator === "AND") {
    if (children.includes(false)) return false;
    return children.every((value) => value === true) ? true : null;
  }

  const required = node.operator === "AT_LEAST" ? Math.max(1, node.threshold ?? 1) : 1;
  const passed = children.filter((value) => value === true).length;
  const unknown = children.filter((value) => value === null).length;
  if (passed >= required) return true;
  if (passed + unknown < required) return false;
  return null;
}

export function admissionScoreStatus(
  requirements: readonly RequirementRecord[],
  scores: Readonly<Record<string, unknown>>,
): AdmissionScoreStatus {
  if (!requirements.length) return "no-requirements";
  if (!Object.values(scores).some((score) => finiteNumber(score) !== null)) return "no-scores";
  const states = requirements.map((requirement) => evaluateRequirement(requirement.root, scores));
  if (states.every((value) => value === true)) return "passed-all";
  if (states.some((value) => value === true)) return "passed-some";
  if (states.every((value) => value === false)) return "failed-all";
  return "incomplete";
}

export function buildProgramProfiles(input: ProfileBuildInput): ProfileBuildResult {
  const taxonomyCodes = new Set(input.taxonomy.categories.map((category) => category.category_code));
  const selections = selectLatestVerifiedPlans(
    input.programs.map((program) => program.external_key),
    input.plans,
  );
  const selectionByProgram = new Map(selections.map((selection) => [selection.programKey, selection]));
  const profiles: Omit<CareerTestProfile, "maxCategoryShares" | "maxActivityShares">[] = [];
  let totalCurriculumRows = 0;
  let classifiedRows = 0;
  let assignedRows = 0;
  let reviewRows = 0;

  for (const program of input.programs) {
    const selection = selectionByProgram.get(program.external_key);
    const plan = selection?.selectedPlan;
    if (!plan) continue;
    const rows = input.itemsByPlanKey.get(plan.external_key) ?? [];
    totalCurriculumRows += rows.length;

    const categoryHours = new Map<string, number>();
    let totalHours = 0;
    let assignedHours = 0;
    let profileClassifiedRows = 0;
    let profileAssignedRows = 0;
    let profileReviewRows = 0;
    const activityTotals: Partial<Record<ActivityKey, number>> = {};
    const knownActivities = new Set<ActivityKey>();

    for (const row of rows) {
      if (row.study_plan_key !== plan.external_key) {
        throw new Error(`Curriculum item ${row.external_key} does not belong to the selected plan.`);
      }

      const hours = finiteNumber(row.total_hours ?? row.hours);
      if (hours !== null && hours > 0) totalHours += hours;

      const classification = row.subject_classification;
      const code = classification?.category_code;
      if (
        classification?.taxonomy_key === input.taxonomy.taxonomy_key
        && classification.taxonomy_version === input.taxonomy.taxonomy_version
        && code
        && taxonomyCodes.has(code)
      ) {
        if (classification.review_status !== "classified" && classification.review_status !== "needs_review") {
          throw new Error(`Curriculum item ${row.external_key} has an unsupported classification review status.`);
        }
        profileAssignedRows += 1;
        assignedRows += 1;
        if (classification.review_status === "classified") {
          profileClassifiedRows += 1;
          classifiedRows += 1;
        } else if (classification.review_status === "needs_review") {
          profileReviewRows += 1;
          reviewRows += 1;
        }
        if (hours !== null && hours > 0) {
          categoryHours.set(code, (categoryHours.get(code) ?? 0) + hours);
          assignedHours += hours;
        }
      }

      for (const option of ACTIVITY_OPTIONS) {
        const value = finiteNumber(row[option.key]);
        if (value === null || value < 0) continue;
        knownActivities.add(option.key);
        activityTotals[option.key] = (activityTotals[option.key] ?? 0) + value;
      }
    }

    if (assignedHours <= 0) continue;
    const categoryShares = new Map([...categoryHours].map(([code, hours]) => [code, hours / assignedHours]));
    const activityTotal = Object.values(activityTotals).reduce((sum, value) => sum + (value ?? 0), 0);
    const activityShares: Partial<Record<ActivityKey, number>> = {};
    if (activityTotal > 0) {
      for (const key of knownActivities) activityShares[key] = (activityTotals[key] ?? 0) / activityTotal;
    }
    profiles.push({
      program,
      plan,
      totalHours,
      assignedHours,
      classifiedRows: profileClassifiedRows,
      assignedRows: profileAssignedRows,
      reviewRows: profileReviewRows,
      categoryHours,
      categoryShares,
      activityShares,
    });
  }

  const maxCategoryShares = new Map<string, number>();
  const maxActivityShares: Partial<Record<ActivityKey, number>> = {};
  const incompleteActivityKeys = new Set<ActivityKey>();
  for (const profile of profiles) {
    for (const [code, share] of profile.categoryShares) {
      maxCategoryShares.set(code, Math.max(maxCategoryShares.get(code) ?? 0, share));
    }
    for (const option of ACTIVITY_OPTIONS) {
      const share = profile.activityShares[option.key];
      if (share === undefined) {
        // Activity data must be comparable across every program. A partial
        // field is treated as unavailable for the whole ranking instead of
        // changing the score formula for only some profiles.
        incompleteActivityKeys.add(option.key);
      } else {
        maxActivityShares[option.key] = Math.max(maxActivityShares[option.key] ?? 0, share);
      }
    }
  }
  for (const key of incompleteActivityKeys) maxActivityShares[key] = 0;

  const rankedProfiles = profiles.map((profile) => ({ ...profile, maxCategoryShares, maxActivityShares }));
  return {
    profiles: rankedProfiles,
    totalCurriculumRows,
    classifiedRows,
    assignedRows,
    reviewRows,
    unavailableProgramCount: selections.filter((selection) => selection.status !== "ready").length,
  };
}

export function buildProgramProfilesFromSnapshot(input: {
  readonly programs: readonly CatalogProgram[];
  readonly plans: readonly StudyPlanDto[];
  readonly taxonomy: SubjectTaxonomyDto;
  readonly snapshots: readonly CareerTestProfileSnapshotRecord[];
}): ProfileBuildResult {
  const taxonomyCodes = new Set(input.taxonomy.categories.map((category) => category.category_code));
  const selections = selectLatestVerifiedPlans(
    input.programs.map((program) => program.external_key),
    input.plans,
  );
  const programByKey = new Map(input.programs.map((program) => [program.external_key, program]));
  const selectionByProgram = new Map(selections.map((selection) => [selection.programKey, selection]));
  const requiredProgramKeys = new Set(
    selections.flatMap((selection) => selection.selectedPlan ? [selection.programKey] : []),
  );
  if (input.snapshots.length !== requiredProgramKeys.size) {
    throw new Error("Profile snapshot does not contain every selected verified plan.");
  }
  const seen = new Set<string>();
  const profiles: Omit<CareerTestProfile, "maxCategoryShares" | "maxActivityShares">[] = [];
  let totalCurriculumRows = 0;
  let classifiedRows = 0;
  let assignedRows = 0;
  let reviewRows = 0;

  for (const snapshot of input.snapshots) {
    if (seen.has(snapshot.program_key)) {
      throw new Error(`Profile snapshot repeated program ${snapshot.program_key}.`);
    }
    seen.add(snapshot.program_key);
    const program = programByKey.get(snapshot.program_key);
    const planSelection = selectionByProgram.get(snapshot.program_key);
    const plan = planSelection?.selectedPlan;
    if (!program || !plan || plan.external_key !== snapshot.plan_key || plan.program_key !== snapshot.program_key) {
      throw new Error(`Profile snapshot does not match the selected verified plan for ${snapshot.program_key}.`);
    }
    if (plan.item_count !== null && plan.item_count !== undefined && plan.item_count !== snapshot.plan_item_count) {
      throw new Error(`Profile snapshot item count does not match plan ${snapshot.plan_key}.`);
    }
    if (!Number.isInteger(snapshot.plan_item_count) || snapshot.plan_item_count < 1) {
      throw new Error(`Profile snapshot has an invalid row count for ${snapshot.plan_key}.`);
    }

    const totalHours = finiteNumber(snapshot.total_hours);
    const assignedHours = finiteNumber(snapshot.assigned_hours);
    if (
      totalHours === null || totalHours <= 0 || assignedHours === null || assignedHours <= 0
      || Math.abs(assignedHours - totalHours) > 0.05
    ) {
      throw new Error(`Profile snapshot has invalid hours for ${snapshot.plan_key}.`);
    }
    if (!Number.isInteger(snapshot.classified_rows) || snapshot.classified_rows < 0 || snapshot.classified_rows > snapshot.plan_item_count) {
      throw new Error(`Profile snapshot has an invalid classified row count for ${snapshot.plan_key}.`);
    }
    if (!Number.isInteger(snapshot.assigned_rows) || snapshot.assigned_rows !== snapshot.plan_item_count || snapshot.assigned_rows < snapshot.classified_rows) {
      throw new Error(`Profile snapshot has an invalid assigned row count for ${snapshot.plan_key}.`);
    }
    if (
      !Number.isInteger(snapshot.review_rows)
      || snapshot.review_rows < 0
      || snapshot.review_rows > snapshot.assigned_rows
      || snapshot.classified_rows + snapshot.review_rows !== snapshot.assigned_rows
    ) {
      throw new Error(`Profile snapshot has invalid review counts for ${snapshot.plan_key}.`);
    }

    const categoryHours = new Map<string, number>();
    for (const [code, rawHours] of Object.entries(snapshot.category_hours)) {
      const hours = finiteNumber(rawHours);
      if (!taxonomyCodes.has(code) || hours === null || hours <= 0) {
        throw new Error(`Profile snapshot contains an invalid category assignment for ${snapshot.plan_key}.`);
      }
      categoryHours.set(code, hours);
    }
    const categoryTotal = [...categoryHours.values()].reduce((sum, hours) => sum + hours, 0);
    if (categoryHours.size === 0 || Math.abs(categoryTotal - assignedHours) > 0.05) {
      throw new Error(`Profile snapshot category hours do not add up for ${snapshot.plan_key}.`);
    }

    const categoryShares = new Map([...categoryHours].map(([code, hours]) => [code, hours / assignedHours]));
    const activityShares: Partial<Record<ActivityKey, number>> = {};
    for (const option of ACTIVITY_OPTIONS) {
      const value = snapshot.activity_shares[option.key];
      if (value === undefined) continue;
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(`Profile snapshot contains an invalid activity share for ${snapshot.plan_key}.`);
      }
      activityShares[option.key] = value;
    }
    const activityTotal = Object.values(activityShares).reduce((sum, value) => sum + (value ?? 0), 0);
    if (activityTotal > 0 && Math.abs(activityTotal - 1) > 0.015) {
      throw new Error(`Profile snapshot activity shares do not add up for ${snapshot.plan_key}.`);
    }

    totalCurriculumRows += snapshot.plan_item_count;
    classifiedRows += snapshot.classified_rows;
    assignedRows += snapshot.assigned_rows;
    reviewRows += snapshot.review_rows;
    profiles.push({
      program,
      plan,
      totalHours,
      assignedHours,
      classifiedRows: snapshot.classified_rows,
      assignedRows: snapshot.assigned_rows,
      reviewRows: snapshot.review_rows,
      categoryHours,
      categoryShares,
      activityShares,
    });
  }

  if (seen.size !== requiredProgramKeys.size || [...requiredProgramKeys].some((programKey) => !seen.has(programKey))) {
    throw new Error("Profile snapshot does not contain every selected verified plan.");
  }

  const maxCategoryShares = new Map<string, number>();
  const maxActivityShares: Partial<Record<ActivityKey, number>> = {};
  const incompleteActivityKeys = new Set<ActivityKey>();
  for (const profile of profiles) {
    for (const [code, share] of profile.categoryShares) {
      maxCategoryShares.set(code, Math.max(maxCategoryShares.get(code) ?? 0, share));
    }
    for (const option of ACTIVITY_OPTIONS) {
      const share = profile.activityShares[option.key];
      if (share === undefined) {
        // Keep a single scoring formula across the ranking when the snapshot
        // does not contain comparable activity data for every program.
        incompleteActivityKeys.add(option.key);
      } else {
        maxActivityShares[option.key] = Math.max(maxActivityShares[option.key] ?? 0, share);
      }
    }
  }
  for (const key of incompleteActivityKeys) maxActivityShares[key] = 0;

  return {
    profiles: profiles.map((profile) => ({ ...profile, maxCategoryShares, maxActivityShares })),
    totalCurriculumRows,
    classifiedRows,
    assignedRows,
    reviewRows,
    unavailableProgramCount: selections.filter((selection) => selection.status !== "ready").length,
  };
}

export function preferenceWeights(answers: CareerTestAnswers): Map<string, number> {
  const weights = new Map<string, number>();
  for (const code of answers.interests) {
    if (code !== UNKNOWN_INTEREST) weights.set(code, 1);
  }
  for (const comparison of answers.comparisons) {
    const delta = comparison.value * 0.45;
    weights.set(comparison.left, (weights.get(comparison.left) ?? 0) + delta);
    weights.set(comparison.right, (weights.get(comparison.right) ?? 0) - delta);
  }
  return weights;
}

export function normalizedCategoryShare(profile: CareerTestProfile, code: string): number {
  const maximum = profile.maxCategoryShares.get(code) ?? 0;
  return maximum > 0 ? (profile.categoryShares.get(code) ?? 0) / maximum : 0;
}

export function fitFor(profile: CareerTestProfile, answers: CareerTestAnswers): RankedCareerProfile {
  const weights = preferenceWeights(answers);
  const positivePreferences = [...weights].filter(([, weight]) => weight > 0.04);
  const preferenceTotal = positivePreferences.reduce((sum, [, weight]) => sum + weight, 0);
  const subjectFit = preferenceTotal > 0
    ? positivePreferences.reduce((sum, [code, weight]) => sum + weight * normalizedCategoryShare(profile, code), 0) / preferenceTotal
    : 0;

  const activityKey = answers.activity && answers.activity !== NO_ACTIVITY ? answers.activity : "";
  const activityShare = activityKey ? profile.activityShares[activityKey] : undefined;
  const activityMaximum = activityKey ? profile.maxActivityShares[activityKey] ?? 0 : 0;
  const activityFit = activityShare !== undefined && activityMaximum > 0 ? activityShare / activityMaximum : null;
  const blend = activityFit === null ? subjectFit : subjectFit * 0.82 + activityFit * 0.18;
  const avoided = answers.avoid.filter((code) => code !== NO_AVOID);
  const avoidFit = avoided.length
    ? avoided.reduce((sum, code) => sum + normalizedCategoryShare(profile, code), 0) / avoided.length
    : 0;

  return {
    profile,
    score: Math.max(0, Math.min(100, blend * 100 - avoidFit * 12)),
    subjectFit,
    activityFit,
    avoidFit,
    positivePreferences,
  };
}

export function rankPrograms(
  profiles: readonly CareerTestProfile[],
  answers: CareerTestAnswers,
): RankedCareerProfile[] {
  return profiles.map((profile) => fitFor(profile, answers))
    .sort((left, right) => right.score - left.score || left.profile.program.code.localeCompare(right.profile.program.code, "ru"));
}

export function selectAdaptivePair(
  profiles: readonly CareerTestProfile[],
  categories: readonly SubjectCategory[],
  answers: CareerTestAnswers,
): CategoryPair | null {
  if (categories.length < 2 || profiles.length < 2) return null;
  const used = new Set(answers.comparisons.flatMap((item) => [item.left, item.right]));
  const available = categories.filter((category) => !used.has(category.code));
  if (available.length < 2) return null;

  // With no subject preference yet, code-order ties (or a preferred lesson
  // format alone) must not decide which subject areas the user gets to see.
  const hasSubjectPreference = [...preferenceWeights(answers).values()].some((weight) => weight > 0.04);
  const leaders = hasSubjectPreference
    ? rankPrograms(profiles, answers).slice(0, 12).map((item) => item.profile)
    : profiles;
  let best: CategoryPair | null = null;
  for (let leftIndex = 0; leftIndex < available.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < available.length; rightIndex += 1) {
      const left = available[leftIndex];
      const right = available[rightIndex];
      if (!left || !right) continue;
      const deltas = leaders.map((profile) => (
        (profile.categoryShares.get(left.code) ?? 0) - (profile.categoryShares.get(right.code) ?? 0)
      ));
      const mean = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
      const variance = deltas.reduce((sum, value) => sum + (value - mean) ** 2, 0) / deltas.length;
      const separation = Math.sqrt(variance) + Math.abs(mean) * 0.1;
      if (!best || separation > best.separation) best = { left: left.code, right: right.code, separation };
    }
  }
  return best;
}

export function shouldFinishAfterComparison(
  profiles: readonly CareerTestProfile[],
  answers: CareerTestAnswers,
  pair: CategoryPair,
  value: number,
): boolean {
  const nextComparisons = [...answers.comparisons, { left: pair.left, right: pair.right, value }];
  if (nextComparisons.length >= MAX_COMPARISONS) return true;
  const nextAnswers: CareerTestAnswers = { ...answers, comparisons: nextComparisons };
  const beforeTop = rankPrograms(profiles, answers).slice(0, 3).map((item) => item.profile.program.external_key);
  const after = rankPrograms(profiles, nextAnswers);
  const afterTop = after.slice(0, 3).map((item) => item.profile.program.external_key);
  const stableTop = beforeTop.length === afterTop.length && beforeTop.every((key) => afterTop.includes(key));
  const separation = after.length > 3 ? (after[2]?.score ?? 0) - (after[3]?.score ?? 0) : Number.POSITIVE_INFINITY;
  return nextComparisons.length >= 2 && stableTop && separation >= 3.5;
}

export function emptyAnswers(): CareerTestAnswers {
  return { interests: [], activity: "", avoid: [], comparisons: [] };
}
