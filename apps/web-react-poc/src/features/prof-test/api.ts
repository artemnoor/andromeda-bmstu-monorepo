import {
  AcademicApiContractError,
  AcademicApiError,
  AcademicReleaseMismatchError,
  assertSingleRelease,
  getCampaigns,
  getActiveRelease,
  getRequirements,
  getTaxonomy,
  listStudyPlans,
  loadCatalog,
} from "@/shared/api/client";
import type { RequirementDto, SubjectTaxonomyDto } from "@/shared/api/client";
import { normalizeCatalogProgram, type CatalogProgram } from "@/features/catalog/model";
import { selectLatestVerifiedPlans } from "@/features/comparison/model";
import {
  buildProgramProfilesFromSnapshot,
  type CareerTestProfileSnapshotRecord,
  type CareerTestProfile,
  type SubjectCategory,
} from "./model";
import { profTestLog } from "./logger";

interface ProfTestProfileSnapshot {
  readonly schema_version: 2;
  readonly release: { readonly release_key: string; readonly source_bundle_sha256: string };
  readonly taxonomy: { readonly taxonomy_key: string; readonly taxonomy_version: string };
  readonly source_curriculum_sha256: string;
  readonly program_count: number;
  readonly selected_plan_count: number;
  readonly unavailable_program_count: number;
  readonly total_curriculum_rows: number;
  readonly classified_rows: number;
  readonly assigned_rows: number;
  readonly review_rows: number;
  readonly profiles: readonly CareerTestProfileSnapshotRecord[];
}

export interface ProfTestLoadProgress {
  readonly label: string;
  readonly completed: number;
  readonly total: number;
}

export interface ProfTestData {
  readonly releaseKey: string;
  readonly programs: readonly CatalogProgram[];
  readonly categories: readonly SubjectCategory[];
  readonly profiles: readonly CareerTestProfile[];
  readonly totalCurriculumRows: number;
  readonly classifiedRows: number;
  readonly assignedRows: number;
  readonly reviewRows: number;
  readonly unavailableProgramCount: number;
}

async function loadProfileSnapshot(signal?: AbortSignal): Promise<ProfTestProfileSnapshot> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 15_000);
  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    signal?.throwIfAborted();
    const response = await fetch("/data/prof-test-profile-snapshot.json", {
      signal: controller.signal,
      cache: "no-cache",
    });
    if (!response.ok) {
      throw new AcademicApiError({
        message: "The academic profile snapshot is unavailable.",
        status: response.status,
        code: "profile_snapshot_unavailable",
      });
    }
    let value: unknown;
    try {
      value = await response.json() as unknown;
    } catch (error) {
      if (controller.signal.aborted) throw error;
      throw new AcademicApiContractError("The academic profile snapshot is not valid JSON.");
    }
    signal?.throwIfAborted();
    controller.signal.throwIfAborted();
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new AcademicApiContractError("The academic profile snapshot has an invalid shape.");
    }
    return value as ProfTestProfileSnapshot;
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    if (timedOut) {
      throw new AcademicApiError({
        message: "The academic profile snapshot request timed out. Please try again.",
        status: 0,
        code: "request_timeout",
      });
    }
    if (error instanceof AcademicApiError || error instanceof AcademicApiContractError) throw error;
    throw new AcademicApiError({ message: "Could not load the academic profile snapshot.", status: 0, code: "profile_snapshot_network_error" });
  } finally {
    globalThis.clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

function mapCategories(taxonomy: SubjectTaxonomyDto): SubjectCategory[] {
  const categories = taxonomy.categories
    .map((category) => ({
      code: category.category_code.trim(),
      name: category.name.trim(),
      definition: category.definition.trim(),
      ordinal: category.ordinal,
    }))
    .filter((category) => category.code && category.name)
    .sort((left, right) => left.ordinal - right.ordinal || left.code.localeCompare(right.code, "ru"));
  if (categories.length < 2) throw new AcademicApiContractError("The subject taxonomy has fewer than two usable categories.");
  return categories;
}

export async function loadProfTestData(
  signal?: AbortSignal,
  onProgress?: (progress: ProfTestLoadProgress) => void,
): Promise<ProfTestData> {
  const startedAt = performance.now();
  profTestLog.info("data-load.start");
  try {
  onProgress?.({ label: "Сверяем каталог и классификации активного выпуска", completed: 0, total: 0 });
  const catalog = await loadCatalog(signal);
  const directions = new Map(catalog.directions.items.map((direction) => [direction.external_key, direction]));
  const departments = new Map(catalog.departments.items.map((department) => [department.external_key, department]));
  const programs = catalog.programs.items.map((program) => normalizeCatalogProgram(program, directions, departments));
  profTestLog.info("catalog.loaded", { releaseKey: catalog.release.release_key, programCount: programs.length, durationMs: Math.round(performance.now() - startedAt) });

  onProgress?.({ label: "Проверяем снимок профилей для этого выпуска", completed: 0, total: 0 });
  const [plansCollection, snapshot] = await Promise.all([
    listStudyPlans(signal),
    loadProfileSnapshot(signal),
  ]);
  assertSingleRelease(catalog.release.release_key, plansCollection);
  if (snapshot.schema_version !== 2) {
    throw new AcademicApiContractError("The academic profile snapshot uses an unsupported schema version.");
  }
  if (snapshot.release?.release_key !== catalog.release.release_key) {
    throw new AcademicReleaseMismatchError(catalog.release.release_key, snapshot.release?.release_key ?? "missing-profile-snapshot-release");
  }
  if (
    !/^[0-9a-f]{64}$/.test(snapshot.source_curriculum_sha256)
    || snapshot.taxonomy?.taxonomy_key !== "bmstu-subject-domain-16"
    || snapshot.taxonomy?.taxonomy_version !== "v1"
    || !Array.isArray(snapshot.profiles)
  ) {
    throw new AcademicApiContractError("The academic profile snapshot has invalid provenance or taxonomy metadata.");
  }
  const planSelections = selectLatestVerifiedPlans(
    programs.map((program) => program.external_key),
    plansCollection.items,
  );
  const selectedPlans = planSelections.flatMap((selection) => selection.selectedPlan ? [selection.selectedPlan] : []);
  profTestLog.info("study-plans.selected", { releaseKey: plansCollection.releaseKey, candidateCount: plansCollection.items.length, selectedCount: selectedPlans.length, unavailableProgramCount: planSelections.filter((selection) => selection.status !== "ready").length });
  if (selectedPlans.length === 0) {
    throw new AcademicApiContractError("The active release has no unique, verified, parsed study plans for this catalog.");
  }
  const selectedItemCount = selectedPlans.reduce((sum, plan) => {
    if (plan.item_count === null || plan.item_count === undefined) {
      throw new AcademicApiContractError(`The verified plan ${plan.external_key} has no published item count.`);
    }
    return sum + plan.item_count;
  }, 0);
  if (
    snapshot.program_count !== programs.length
    || snapshot.profiles.length !== selectedPlans.length
    || snapshot.selected_plan_count !== selectedPlans.length
    || snapshot.unavailable_program_count !== planSelections.filter((selection) => selection.status !== "ready").length
    || snapshot.total_curriculum_rows !== selectedItemCount
  ) {
    throw new AcademicApiContractError("The academic profile snapshot counts do not match the active catalog and verified plans.");
  }
  const taxonomy = await getTaxonomy(snapshot.taxonomy.taxonomy_key, snapshot.taxonomy.taxonomy_version, signal);
  if (taxonomy.taxonomy_key !== snapshot.taxonomy.taxonomy_key || taxonomy.taxonomy_version !== snapshot.taxonomy.taxonomy_version) {
    throw new AcademicApiContractError("The subject taxonomy response does not match the profile snapshot.");
  }
  const categories = mapCategories(taxonomy);
  const built = buildProgramProfilesFromSnapshot({
    programs,
    plans: plansCollection.items,
    taxonomy,
    snapshots: snapshot.profiles,
  });
  if (built.profiles.length === 0) {
    throw new AcademicApiContractError("The active release has no verified programs with assigned subject categories to rank.");
  }
  if (built.totalCurriculumRows !== selectedItemCount || built.profiles.length !== selectedPlans.length) {
    throw new AcademicApiContractError("The academic profile snapshot does not cover every selected verified plan.");
  }
  const assignedRows = snapshot.profiles.reduce((sum, profile) => sum + profile.assigned_rows, 0);
  const reviewRows = snapshot.profiles.reduce((sum, profile) => sum + profile.review_rows, 0);
  if (
    snapshot.classified_rows !== built.classifiedRows
    || snapshot.assigned_rows !== assignedRows
    || snapshot.review_rows !== reviewRows
    || snapshot.assigned_rows !== built.assignedRows
    || snapshot.review_rows !== built.reviewRows
    || assignedRows > snapshot.total_curriculum_rows
  ) {
    throw new AcademicApiContractError("The academic profile snapshot category counts do not add up.");
  }

  const activeAfterRead = await getActiveRelease(signal);
  assertSingleRelease(catalog.release.release_key, plansCollection, {
    releaseKey: activeAfterRead.release_key,
    label: "active release after career test data load",
  });

  const result = {
    releaseKey: catalog.release.release_key,
    programs,
    categories,
    profiles: built.profiles,
    totalCurriculumRows: built.totalCurriculumRows,
    classifiedRows: built.classifiedRows,
    assignedRows,
    reviewRows,
    unavailableProgramCount: built.unavailableProgramCount,
  };
  profTestLog.info("data-load.complete", { releaseKey: result.releaseKey, rankedProgramCount: result.profiles.length, curriculumRows: result.totalCurriculumRows, assignedRows: result.assignedRows, classifiedRows: result.classifiedRows, reviewRows: result.reviewRows, unavailableProgramCount: result.unavailableProgramCount, snapshotSha256: snapshot.source_curriculum_sha256, durationMs: Math.round(performance.now() - startedAt) });
  return result;
  } catch (error) {
    profTestLog.error("data-load.failed", { durationMs: Math.round(performance.now() - startedAt), error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

export interface ProfTestAdmissionStatus {
  readonly status: "ready" | "unavailable";
  readonly requirementsByDirection: ReadonlyMap<string, readonly RequirementDto[]>;
}

/** Load published admission minima separately so optional admission data never delays ranking. */
export async function loadProfTestAdmissionStatus(
  releaseKey: string,
  signal?: AbortSignal,
): Promise<ProfTestAdmissionStatus> {
  const startedAt = performance.now();
  profTestLog.debug("admission-load.start", { releaseKey });
  try {
    const campaigns = await getCampaigns(undefined, signal);
    assertSingleRelease(releaseKey, campaigns);
    const campaign = campaigns.items.find((item) => item.campaign_kind === "admission" && item.year === 2026)
      ?? campaigns.items.filter((item) => item.campaign_kind === "admission").sort((left, right) => right.year - left.year)[0];
    if (!campaign) {
      profTestLog.warn("admission-load.no-campaign", { releaseKey, durationMs: Math.round(performance.now() - startedAt) });
      return { status: "ready", requirementsByDirection: new Map() };
    }
    const requirements = await getRequirements(campaign.external_key, undefined, signal);
    assertSingleRelease(releaseKey, campaigns, requirements);
    const requirementsByDirection = new Map<string, RequirementDto[]>();
    for (const requirement of requirements.items) {
      if (!requirement.direction_key) continue;
      const records = requirementsByDirection.get(requirement.direction_key) ?? [];
      records.push(requirement);
      requirementsByDirection.set(requirement.direction_key, records);
    }
    profTestLog.info("admission-load.complete", { releaseKey, campaignKey: campaign.external_key, requirementCount: requirements.items.length, directionCount: requirementsByDirection.size, durationMs: Math.round(performance.now() - startedAt) });
    return { status: "ready", requirementsByDirection };
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    if (error instanceof AcademicReleaseMismatchError || error instanceof AcademicApiContractError) throw error;
    profTestLog.warn("admission-load.unavailable", { releaseKey, error: error instanceof Error ? error.message : String(error), durationMs: Math.round(performance.now() - startedAt) });
    return { status: "unavailable", requirementsByDirection: new Map() };
  }
}
