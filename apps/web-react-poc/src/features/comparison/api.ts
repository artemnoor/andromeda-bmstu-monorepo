import {
  AcademicReleaseMismatchError,
  assertSingleRelease,
  getActiveRelease,
  getStudyPlanItems,
  getStudyPlans,
  getTaxonomy,
  loadCatalog,
} from "@/shared/api/client";
import type { SubjectTaxonomyDto, StudyPlanDto, CurriculumItemDto } from "./model";
import { buildCurriculumComparison, selectLatestVerifiedPlans } from "./model";
import { normalizeCatalogProgram, type CatalogProgram } from "@/features/catalog/model";
import { getProgramAdmission } from "@/features/catalog/admission-api";
import { buildAdmissionSummary, type AdmissionSummary } from "@/features/catalog/admission-model";

declare global {
  interface Window {
    __andromedaQaComparisonProfiling?: boolean;
  }
}

const comparisonProfilePrefix = "andromeda:comparison:stage";

function markComparisonStage(stage: string, phase: "start" | "end"): void {
  if (typeof window !== "undefined" && window.__andromedaQaComparisonProfiling) {
    performance.mark(`${comparisonProfilePrefix}:${stage}:${phase}`);
  }
}

function measureComparisonStage(stage: string): void {
  if (typeof window !== "undefined" && window.__andromedaQaComparisonProfiling) {
    performance.measure(
      `${comparisonProfilePrefix}:${stage}`,
      `${comparisonProfilePrefix}:${stage}:start`,
      `${comparisonProfilePrefix}:${stage}:end`,
    );
  }
}

export interface LoadedProgramComparison {
  readonly releaseKey: string;
  readonly programs: readonly CatalogProgram[];
  readonly invalidSelectionKeys: readonly string[];
  readonly curriculum: ReturnType<typeof buildCurriculumComparison>;
  readonly admission: ReadonlyMap<string, AdmissionSummary>;
  readonly admissionUnavailable: ReadonlySet<string>;
  readonly taxonomyUnavailable: boolean;
}

export async function loadProgramComparison(
  selectedKeys: readonly string[],
  signal?: AbortSignal,
): Promise<LoadedProgramComparison> {
  markComparisonStage("total", "start");
  markComparisonStage("catalog", "start");
  const catalog = await loadCatalog(signal);
  markComparisonStage("catalog", "end");
  measureComparisonStage("catalog");
  markComparisonStage("selection", "start");
  const directions = new Map(catalog.directions.items.map((item) => [item.external_key, item]));
  const departments = new Map(catalog.departments.items.map((item) => [item.external_key, item]));
  const programs = catalog.programs.items.map((program) => normalizeCatalogProgram(program, directions, departments));
  const byExternalKey = new Map(programs.map((program) => [program.external_key, program]));
  const codeCounts = new Map<string, number>();
  for (const program of programs) codeCounts.set(program.code, (codeCounts.get(program.code) ?? 0) + 1);
  const byUniqueCode = new Map(programs
    .filter((program) => codeCounts.get(program.code) === 1)
    .map((program) => [program.code, program]));

  const selectedPrograms: CatalogProgram[] = [];
  const invalidSelectionKeys: string[] = [];
  const seenProgramKeys = new Set<string>();
  for (const storedKey of selectedKeys) {
    const program = byExternalKey.get(storedKey) ?? byUniqueCode.get(storedKey);
    if (!program) {
      invalidSelectionKeys.push(storedKey);
      continue;
    }
    if (seenProgramKeys.has(program.external_key)) continue;
    seenProgramKeys.add(program.external_key);
    selectedPrograms.push(program);
  }
  markComparisonStage("selection", "end");
  measureComparisonStage("selection");

  markComparisonStage("plans", "start");
  const planCollections = await Promise.all(selectedPrograms.map((program) => (
    getStudyPlans(program.external_key, signal)
  )));
  markComparisonStage("plans", "end");
  measureComparisonStage("plans");
  assertSingleRelease(catalog.release.release_key, ...planCollections);
  const plans: StudyPlanDto[] = planCollections.flatMap((collection) => collection.items);
  const selections = selectLatestVerifiedPlans(selectedPrograms.map((program) => program.external_key), plans);

  markComparisonStage("items", "start");
  const itemResults = await Promise.all(selections.flatMap((selection) => (
    selection.selectedPlan ? [selection.selectedPlan] : []
  )).map(async (plan) => {
    try {
      const collection = await getStudyPlanItems(plan.external_key, signal);
      assertSingleRelease(catalog.release.release_key, collection);
      const itemCount = plan.item_count;
      if (itemCount != null && collection.items.length !== itemCount) {
        return { planKey: plan.external_key, collection: null };
      }
      return { planKey: plan.external_key, collection };
    } catch (error) {
      if (error instanceof AcademicReleaseMismatchError || signal?.aborted) throw error;
      return { planKey: plan.external_key, collection: null };
    }
  }));

  const itemsByPlanKey = new Map<string, readonly CurriculumItemDto[]>();
  const unavailablePlanKeys = new Set<string>();
  const itemCollections = [];
  for (const result of itemResults) {
    if (!result.collection) {
      unavailablePlanKeys.add(result.planKey);
      continue;
    }
    itemCollections.push(result.collection);
    itemsByPlanKey.set(result.planKey, result.collection.items);
  }
  markComparisonStage("items", "end");
  measureComparisonStage("items");

  markComparisonStage("taxonomy", "start");
  const taxonomyIdentities = new Map<string, { key: string; version: string }>();
  for (const item of [...itemsByPlanKey.values()].flat()) {
    const classification = item.subject_classification;
    if (!classification?.taxonomy_key || !classification.taxonomy_version) continue;
    const identity = `${classification.taxonomy_key}\u0000${classification.taxonomy_version}`;
    taxonomyIdentities.set(identity, { key: classification.taxonomy_key, version: classification.taxonomy_version });
  }

  let taxonomy: SubjectTaxonomyDto | null = null;
  let taxonomyUnavailable = false;
  if (taxonomyIdentities.size <= 1) {
    const identity = taxonomyIdentities.size === 1
      ? [...taxonomyIdentities.values()][0]
      : { key: "bmstu-subject-domain-16", version: "v1" };
    if (identity) {
      try {
        taxonomy = await getTaxonomy(identity.key, identity.version, signal);
      } catch (error) {
        if (error instanceof AcademicReleaseMismatchError || signal?.aborted) throw error;
        taxonomyUnavailable = true;
      }
    }
  } else if (taxonomyIdentities.size > 1) {
    // Categories from different taxonomies/versions are not comparable. Keep all
    // curriculum rows and their numeric metrics, but mark them unclassified.
    taxonomyUnavailable = true;
  }
  markComparisonStage("taxonomy", "end");
  measureComparisonStage("taxonomy");

  markComparisonStage("curriculum-model", "start");
  const curriculum = buildCurriculumComparison({
    programKeys: selectedPrograms.map((program) => program.external_key),
    plans,
    itemsByPlanKey,
    taxonomy,
    unavailablePlanKeys,
  });
  markComparisonStage("curriculum-model", "end");
  measureComparisonStage("curriculum-model");

  markComparisonStage("admission", "start");
  const admissionSettled = await Promise.allSettled(selectedPrograms.map(async (program) => ({
    programKey: program.external_key,
    summary: buildAdmissionSummary(program, await getProgramAdmission(program)),
  })));
  markComparisonStage("admission", "end");
  measureComparisonStage("admission");
  const admission = new Map<string, AdmissionSummary>();
  const admissionUnavailable = new Set<string>();
  admissionSettled.forEach((result, index) => {
    const program = selectedPrograms[index];
    if (!program) return;
    if (result.status === "fulfilled") admission.set(result.value.programKey, result.value.summary);
    else if (result.reason instanceof AcademicReleaseMismatchError) throw result.reason;
    else admissionUnavailable.add(program.external_key);
  });

  markComparisonStage("final-release-check", "start");
  assertSingleRelease(catalog.release.release_key, ...planCollections, ...itemCollections);
  const activeAfterRead = await getActiveRelease(signal);
  assertSingleRelease(catalog.release.release_key, {
    releaseKey: activeAfterRead.release_key,
    label: "active release after comparison load",
  });
  markComparisonStage("final-release-check", "end");
  measureComparisonStage("final-release-check");
  markComparisonStage("total", "end");
  measureComparisonStage("total");

  return {
    releaseKey: catalog.release.release_key,
    programs: selectedPrograms,
    invalidSelectionKeys,
    curriculum,
    admission,
    admissionUnavailable,
    taxonomyUnavailable,
  };
}
