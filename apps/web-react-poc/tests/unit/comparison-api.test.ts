import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogSnapshot, AcademicCollection } from "@/shared/api/client";
import { AcademicReleaseMismatchError } from "@/shared/api/client";
import type { ProgramDto } from "@/features/catalog/model";
import type { StudyPlanDto, CurriculumItemDto, SubjectTaxonomyDto } from "@/features/comparison/model";
import type { ProgramAdmissionData } from "@/features/catalog/admission-model";
import { clearComparisonReadCache, loadProgramComparison } from "@/features/comparison/api";

const { api } = vi.hoisted(() => {
  class AcademicReleaseMismatchError extends Error {
    readonly expectedReleaseKey: string;
    readonly actualReleaseKey: string;

    constructor(expectedReleaseKey: string, actualReleaseKey: string) {
      super(`Academic data came from different releases (expected ${expectedReleaseKey}, received ${actualReleaseKey}).`);
      this.name = "AcademicReleaseMismatchError";
      this.expectedReleaseKey = expectedReleaseKey;
      this.actualReleaseKey = actualReleaseKey;
    }
  }

  const assertSingleRelease = vi.fn((expectedReleaseKey: string, ...collections: readonly { releaseKey: string }[]) => {
    const mismatch = collections.find((collection) => collection.releaseKey !== expectedReleaseKey);
    if (mismatch) throw new AcademicReleaseMismatchError(expectedReleaseKey, mismatch.releaseKey);
    return expectedReleaseKey;
  });

  return {
    api: {
      AcademicReleaseMismatchError,
      assertSingleRelease,
      getActiveRelease: vi.fn(),
      getStudyPlanItems: vi.fn(),
      getStudyPlans: vi.fn(),
      getTaxonomy: vi.fn(),
      loadCatalog: vi.fn(),
      getProgramAdmission: vi.fn(),
    },
  };
});

vi.mock("@/shared/api/client", () => ({
  AcademicReleaseMismatchError: api.AcademicReleaseMismatchError,
  assertSingleRelease: api.assertSingleRelease,
  getActiveRelease: api.getActiveRelease,
  getStudyPlanItems: api.getStudyPlanItems,
  getStudyPlans: api.getStudyPlans,
  getTaxonomy: api.getTaxonomy,
  loadCatalog: api.loadCatalog,
}));

vi.mock("@/features/catalog/admission-api", () => ({
  getProgramAdmission: api.getProgramAdmission,
}));

const RELEASE_A = "release:2026-a";
const RELEASE_B = "release:2026-b";
const PROGRAM_KEY = "program:09.03.01-01";
const PLAN_KEY = "plan:09.03.01-01:2025";
const ITEM_KEY = "item:09.03.01-01:math";

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function collection<T>(items: readonly T[], releaseKey = RELEASE_A): AcademicCollection<T> {
  return { items, releaseKey, totalCount: items.length };
}

const programDto = {
  external_key: PROGRAM_KEY,
  code: "09.03.01",
  name: "Информатика и вычислительная техника",
  description: "Программа для проверки orchestration.",
  direction_key: "direction:09.03.01",
  department_relations: [],
  sources: [],
} as unknown as ProgramDto;

const catalogSnapshot = {
  release: { release_key: RELEASE_A },
  programs: collection([programDto]),
  directions: collection([]),
  departments: collection([]),
} as unknown as CatalogSnapshot;

const verifiedPlan = {
  external_key: PLAN_KEY,
  program_key: PROGRAM_KEY,
  academic_year: "2025-2026",
  status: "parsed",
  profile_link_status: "verified",
  item_count: 1,
} as unknown as StudyPlanDto;

const curriculumItem = {
  external_key: ITEM_KEY,
  study_plan_key: PLAN_KEY,
  ordinal: 1,
  discipline_name: "Математический анализ",
  semester: 1,
  credits: 4,
  total_hours: 72,
  hours: 72,
  control_form: "Экзамен",
  subject_classification: null,
} as unknown as CurriculumItemDto;

const taxonomy = {
  taxonomy_key: "bmstu-subject-domain-16",
  taxonomy_version: "v1",
  categories: [],
} as unknown as SubjectTaxonomyDto;

const admissionData = {
  releaseKey: RELEASE_A,
  campaigns: [],
  offerings: [],
  calendar: [],
  pools: [],
  quotas: [],
  requirements: [],
  history: [],
  campaignStatistics: [],
  tuition: [],
} as ProgramAdmissionData;

function installSuccessfulReads(): void {
  api.loadCatalog.mockImplementation(() => Promise.resolve(catalogSnapshot));
  api.getStudyPlans.mockImplementation(() => Promise.resolve(collection([verifiedPlan])));
  api.getStudyPlanItems.mockImplementation(() => Promise.resolve(collection([curriculumItem])));
  api.getTaxonomy.mockImplementation(() => Promise.resolve(taxonomy));
  api.getProgramAdmission.mockImplementation(() => Promise.resolve(admissionData));
  api.getActiveRelease.mockImplementation(() => Promise.resolve({ release_key: RELEASE_A }));
}

beforeEach(() => {
  clearComparisonReadCache();
  vi.clearAllMocks();
  installSuccessfulReads();
});

describe("loadProgramComparison orchestration", () => {
  it("reuses completed curriculum reads while checking the active release on every navigation", async () => {
    const first = await loadProgramComparison([PROGRAM_KEY]);
    const second = await loadProgramComparison([PROGRAM_KEY]);
    expect(second.curriculum).toEqual(first.curriculum);
    expect(api.getStudyPlans).toHaveBeenCalledTimes(1);
    expect(api.getStudyPlanItems).toHaveBeenCalledTimes(1);
    expect(api.getTaxonomy).toHaveBeenCalledTimes(1);
    expect(api.loadCatalog).toHaveBeenCalledTimes(2);
    expect(api.getActiveRelease).toHaveBeenCalledTimes(2);
  });

  it("still rejects release activation changes when curriculum reads are cached", async () => {
    await loadProgramComparison([PROGRAM_KEY]);
    api.getActiveRelease.mockResolvedValue({ release_key: RELEASE_B });
    await expect(loadProgramComparison([PROGRAM_KEY])).rejects.toBeInstanceOf(AcademicReleaseMismatchError);
  });

  it("does not cache incomplete curriculum pages and recovers on retry", async () => {
    api.getStudyPlanItems.mockResolvedValueOnce(collection([]));
    const first = await loadProgramComparison([PROGRAM_KEY]);
    expect(first.curriculum.programs[0]?.itemsStatus).toBe("unavailable");
    const second = await loadProgramComparison([PROGRAM_KEY]);
    expect(api.getStudyPlanItems).toHaveBeenCalledTimes(2);
    expect(second.curriculum.programs[0]?.items).toHaveLength(1);
  });

  it("publishes checked admission data while a slow curriculum is still pending", async () => {
    const planRead = deferred<AcademicCollection<StudyPlanDto>>();
    const overviewRead = deferred<void>();
    api.getStudyPlans.mockReturnValue(planRead.promise);
    const onOverview = vi.fn(() => overviewRead.resolve());
    const comparison = loadProgramComparison([PROGRAM_KEY], undefined, onOverview);
    await overviewRead.promise;
    expect(onOverview).toHaveBeenCalledWith(expect.objectContaining({ releaseKey: RELEASE_A, admission: expect.any(Map) }));
    expect(api.getStudyPlanItems).not.toHaveBeenCalled();
    expect(api.getActiveRelease).toHaveBeenCalledTimes(1);
    planRead.resolve(collection([verifiedPlan]));
    await comparison;
    expect(api.getActiveRelease).toHaveBeenCalledTimes(2);
  });

  it("does not publish admission preview from an activated different release", async () => {
    api.getActiveRelease.mockResolvedValue({ release_key: RELEASE_B });
    const onOverview = vi.fn();
    await expect(loadProgramComparison([PROGRAM_KEY], undefined, onOverview)).rejects.toBeInstanceOf(AcademicReleaseMismatchError);
    expect(onOverview).not.toHaveBeenCalled();
  });

  it("does not publish a preview after the navigation is aborted", async () => {
    const activeRead = deferred<{ release_key: string }>();
    const activeStarted = deferred<void>();
    api.getActiveRelease.mockImplementation(() => { activeStarted.resolve(); return activeRead.promise; });
    const controller = new AbortController();
    const onOverview = vi.fn();
    const comparison = loadProgramComparison([PROGRAM_KEY], controller.signal, onOverview);
    await activeStarted.promise;
    controller.abort();
    activeRead.resolve({ release_key: RELEASE_A });
    await expect(comparison).rejects.toMatchObject({ name: "AbortError" });
    expect(onOverview).not.toHaveBeenCalled();
  });

  it("starts admission reads alongside selected study-plan reads after catalog selection", async () => {
    const catalogRead = deferred<CatalogSnapshot>();
    const planRead = deferred<AcademicCollection<StudyPlanDto>>();
    const planReadStarted = deferred<void>();
    api.loadCatalog.mockImplementation(() => catalogRead.promise);
    api.getStudyPlans.mockImplementation(() => {
      planReadStarted.resolve();
      return planRead.promise;
    });

    const onSelection = vi.fn();
    const comparison = loadProgramComparison([PROGRAM_KEY], undefined, undefined, onSelection);
    expect(api.getStudyPlans).not.toHaveBeenCalled();
    expect(api.getProgramAdmission).not.toHaveBeenCalled();

    catalogRead.resolve(catalogSnapshot);
    await planReadStarted.promise;
    expect(onSelection).toHaveBeenCalledWith(expect.objectContaining({ releaseKey: RELEASE_A, programs: [expect.objectContaining({ external_key: PROGRAM_KEY })] }));
    const admissionStartedWhilePlanReadWasPending = api.getProgramAdmission.mock.calls.length > 0;

    planRead.resolve(collection([verifiedPlan]));
    const result = await comparison;

    expect(admissionStartedWhilePlanReadWasPending).toBe(true);
    expect(api.getStudyPlans).toHaveBeenCalledWith(PROGRAM_KEY, undefined);
    expect(api.getProgramAdmission).toHaveBeenCalledWith(
      expect.objectContaining({ external_key: PROGRAM_KEY }),
      { expectedReleaseKey: RELEASE_A },
    );
    expect(result.programs).toHaveLength(1);
  });

  it("rejects when the active release changes while comparison data is still loading", async () => {
    const planRead = deferred<AcademicCollection<StudyPlanDto>>();
    const planReadStarted = deferred<void>();
    let activeRelease = RELEASE_A;
    api.getStudyPlans.mockImplementation(() => {
      planReadStarted.resolve();
      return planRead.promise;
    });
    api.getActiveRelease.mockImplementation(() => Promise.resolve({ release_key: activeRelease }));

    const comparison = loadProgramComparison([PROGRAM_KEY]);
    await planReadStarted.promise;
    activeRelease = RELEASE_B;
    planRead.resolve(collection([verifiedPlan], RELEASE_A));

    await expect(comparison).rejects.toBeInstanceOf(AcademicReleaseMismatchError);
    await expect(comparison).rejects.toMatchObject({
      expectedReleaseKey: RELEASE_A,
      actualReleaseKey: RELEASE_B,
    });
    expect(api.getActiveRelease).toHaveBeenCalledTimes(1);
  });

  it("rejects when the active release changes while admission data is still loading", async () => {
    const admissionRead = deferred<ProgramAdmissionData>();
    const admissionReadStarted = deferred<void>();
    let activeRelease = RELEASE_A;
    api.getProgramAdmission.mockImplementation(() => {
      admissionReadStarted.resolve();
      return admissionRead.promise;
    });
    api.getActiveRelease.mockImplementation(() => Promise.resolve({ release_key: activeRelease }));

    const comparison = loadProgramComparison([PROGRAM_KEY]);
    await admissionReadStarted.promise;
    activeRelease = RELEASE_B;
    admissionRead.resolve(admissionData);

    await expect(comparison).rejects.toMatchObject({
      name: "AcademicReleaseMismatchError",
      expectedReleaseKey: RELEASE_A,
      actualReleaseKey: RELEASE_B,
    });
    expect(api.getActiveRelease).toHaveBeenCalledTimes(1);
  });

  it("keeps successfully loaded curriculum and marks admission unavailable after a request timeout", async () => {
    api.getProgramAdmission.mockImplementation(() => Promise.reject(
      new DOMException("The admission request timed out.", "TimeoutError"),
    ));

    const result = await loadProgramComparison([PROGRAM_KEY]);

    expect(result.curriculum.programs[0]?.items).toEqual([
      expect.objectContaining({
        externalKey: ITEM_KEY,
        programKey: PROGRAM_KEY,
        planKey: PLAN_KEY,
        hours: 72,
        credits: 4,
      }),
    ]);
    expect(result.admission.has(PROGRAM_KEY)).toBe(false);
    expect(result.admissionUnavailable.has(PROGRAM_KEY)).toBe(true);
    expect(api.getActiveRelease).toHaveBeenCalledTimes(1);
  });

  it("rejects admission data from a different academic release", async () => {
    api.getProgramAdmission.mockImplementation(() => Promise.resolve({
      ...admissionData,
      releaseKey: RELEASE_B,
    }));

    await expect(loadProgramComparison([PROGRAM_KEY])).rejects.toMatchObject({
      name: "AcademicReleaseMismatchError",
      expectedReleaseKey: RELEASE_A,
      actualReleaseKey: RELEASE_B,
    });
  });

  it("retains plan, item, and final active-release checks before returning data", async () => {
    await loadProgramComparison([PROGRAM_KEY]);

    expect(api.assertSingleRelease).toHaveBeenCalledWith(RELEASE_A, collection([verifiedPlan]));
    expect(api.assertSingleRelease).toHaveBeenCalledWith(RELEASE_A, collection([curriculumItem]));
    expect(api.assertSingleRelease).toHaveBeenCalledWith(
      RELEASE_A,
      expect.objectContaining({
        releaseKey: RELEASE_A,
        label: "active release after comparison load",
      }),
    );
    expect(api.getActiveRelease).toHaveBeenCalledTimes(1);
  });
});
