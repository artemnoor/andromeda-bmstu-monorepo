import {
  AcademicApiContractError,
  assertSingleRelease,
  getCampaignCalendar,
  getCampaignOfferings,
  getCampaigns,
  getCompetitionPools,
  getPlaceQuotas,
  getRequirements,
  getStatistics,
  getTuition,
  type AcademicCollection,
  type AdmissionCampaignDto,
  type AdmissionOfferingDto,
  type AdmissionStatisticDto,
  type CampaignCalendarEventDto,
  type CompetitionPoolDto,
  type PlaceQuotaDto,
  type RequirementDto,
  type TuitionDto,
} from "@/shared/api/client";
import type { CatalogProgram } from "./model";
import type { ProgramAdmissionData } from "./admission-model";

interface CampaignData {
  readonly offerings: AcademicCollection<AdmissionOfferingDto>;
  readonly calendar: AcademicCollection<CampaignCalendarEventDto>;
  readonly quotas: AcademicCollection<PlaceQuotaDto>;
}

interface DirectionData {
  readonly pools: AcademicCollection<CompetitionPoolDto>;
  readonly history: AcademicCollection<AdmissionStatisticDto>;
  readonly campaignStatistics: AcademicCollection<AdmissionStatisticDto>;
  readonly tuition: AcademicCollection<TuitionDto>;
}

interface PendingCacheEntry<T> {
  readonly status: "pending";
  readonly controller: AbortController;
  readonly consumers: Set<symbol>;
  readonly promise: Promise<T>;
}

interface FulfilledCacheEntry<T> {
  readonly status: "fulfilled";
  readonly value: T;
}

type CacheEntry<T> = PendingCacheEntry<T> | FulfilledCacheEntry<T>;

const campaignCache = new Map<string, CacheEntry<AcademicCollection<AdmissionCampaignDto>>>();
const campaignDataCache = new Map<string, CacheEntry<CampaignData>>();
const campaignRequirementsCache = new Map<string, CacheEntry<AcademicCollection<RequirementDto>>>();
const directionDataCache = new Map<string, CacheEntry<{
  readonly pools: AcademicCollection<CompetitionPoolDto>;
  readonly history: AcademicCollection<AdmissionStatisticDto>;
  readonly campaignStatistics: AcademicCollection<AdmissionStatisticDto>;
  readonly tuition: AcademicCollection<TuitionDto>;
}>>();
const programCache = new Map<string, CacheEntry<ProgramAdmissionData>>();

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

function subscribeToCacheEntry<T>(
  store: Map<string, CacheEntry<T>>,
  key: string,
  entry: PendingCacheEntry<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));

  const consumer = Symbol(key);
  entry.consumers.add(consumer);

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const detach = () => {
      if (settled) return false;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      entry.consumers.delete(consumer);
      return true;
    };
    const onAbort = () => {
      if (!detach()) return;
      const reason = signal ? abortReason(signal) : new DOMException("The operation was aborted.", "AbortError");
      reject(reason);
      if (entry.consumers.size === 0 && store.get(key) === entry) {
        // Remove immediately so a retry can start even if the transport takes
        // time to observe its abort signal.
        store.delete(key);
        entry.controller.abort(reason);
      }
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }

    entry.promise.then(
      (value) => {
        if (detach()) resolve(value);
      },
      (error: unknown) => {
        if (detach()) reject(error);
      },
    );
  });
}

function cached<T>(
  store: Map<string, CacheEntry<T>>,
  key: string,
  signal: AbortSignal | undefined,
  load: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));

  const existing = store.get(key);
  if (existing?.status === "fulfilled") return Promise.resolve(existing.value);
  if (existing?.status === "pending") return subscribeToCacheEntry(store, key, existing, signal);

  const controller = new AbortController();
  const entry: PendingCacheEntry<T> = {
    status: "pending",
    controller,
    consumers: new Set(),
    promise: Promise.resolve().then(() => {
      if (controller.signal.aborted) throw abortReason(controller.signal);
      return load(controller.signal);
    }).then((value) => {
      if (store.get(key) === entry) store.set(key, { status: "fulfilled", value });
      return value;
    }, (error: unknown) => {
      if (store.get(key) === entry) store.delete(key);
      throw error;
    }),
  };
  store.set(key, entry);
  return subscribeToCacheEntry(store, key, entry, signal);
}

function releaseCacheKey(releaseKey: string, ...parts: readonly string[]): string {
  return [releaseKey, ...parts].join("\u0000");
}

function campaignsFor(releaseKey: string, signal?: AbortSignal): Promise<AcademicCollection<AdmissionCampaignDto>> {
  return cached(campaignCache, releaseKey, signal, async (requestSignal) => {
    const campaigns = await getCampaigns(undefined, requestSignal);
    assertSingleRelease(releaseKey, campaigns);
    return campaigns;
  });
}

function campaignData(releaseKey: string, campaignKey: string, signal?: AbortSignal): Promise<CampaignData> {
  return cached(campaignDataCache, releaseCacheKey(releaseKey, campaignKey), signal, async (requestSignal) => {
    const [offerings, calendar, quotas] = await Promise.all([
      getCampaignOfferings(campaignKey, requestSignal),
      getCampaignCalendar(campaignKey, requestSignal),
      getPlaceQuotas(campaignKey, requestSignal),
    ]);
    assertSingleRelease(releaseKey, offerings, calendar, quotas);
    return { offerings, calendar, quotas };
  });
}

function campaignRequirements(
  releaseKey: string,
  campaignKey: string,
  directionKey: string | null,
  signal?: AbortSignal,
): Promise<AcademicCollection<RequirementDto>> {
  const directionCacheKey = directionKey === null ? "unresolved" : `direction:${directionKey}`;
  const key = releaseCacheKey(releaseKey, campaignKey, directionCacheKey);
  return cached(campaignRequirementsCache, key, signal, async (requestSignal) => {
    const requirements = await getRequirements(campaignKey, directionKey ?? undefined, requestSignal);
    assertSingleRelease(releaseKey, requirements);
    return requirements;
  });
}

function directionData(
  releaseKey: string,
  campaignKey: string,
  directionCode: string,
  campaignYear: number,
  signal?: AbortSignal,
): Promise<DirectionData> {
  const key = releaseCacheKey(releaseKey, campaignKey, directionCode, String(campaignYear));
  return cached(directionDataCache, key, signal, async (requestSignal) => {
    const [pools, history, campaignStatistics, tuition] = await Promise.all([
      getCompetitionPools(campaignKey, directionCode, requestSignal),
      getStatistics({ kind: "historical", directionCode }, requestSignal),
      getStatistics({ kind: "admission", year: campaignYear, directionCode }, requestSignal),
      getTuition(directionCode, requestSignal),
    ]);
    assertSingleRelease(releaseKey, pools, history, campaignStatistics, tuition);
    return { pools, history, campaignStatistics, tuition };
  });
}

export interface ProgramAdmissionRequestOptions {
  readonly expectedReleaseKey: string;
  readonly signal?: AbortSignal;
}

export async function getProgramAdmission(
  program: CatalogProgram,
  { expectedReleaseKey, signal }: ProgramAdmissionRequestOptions,
): Promise<ProgramAdmissionData> {
  if (!expectedReleaseKey) throw new AcademicApiContractError("An expected release key is required for admission data.");
  const key = releaseCacheKey(expectedReleaseKey, program.external_key);
  const result = await cached(programCache, key, signal, async (requestSignal) => {
    const campaigns = await campaignsFor(expectedReleaseKey, requestSignal);
    const campaign = campaigns.items
      .filter((item) => item.campaign_kind === "admission")
      .sort((left, right) => right.year - left.year)[0];
    if (!campaign) {
      const noCampaignData = {
        releaseKey: campaigns.releaseKey,
        campaigns: campaigns.items,
        offerings: [],
        calendar: [],
        pools: [],
        quotas: [],
        requirements: [],
        history: [],
        campaignStatistics: [],
        tuition: [],
      };
      assertSingleRelease(expectedReleaseKey, {
        releaseKey: noCampaignData.releaseKey,
        label: `admission data for ${program.external_key}`,
      });
      return noCampaignData;
    }

    const [shared, requirementsByDirection, byDirection] = await Promise.all([
      campaignData(expectedReleaseKey, campaign.external_key, requestSignal),
      campaignRequirements(expectedReleaseKey, campaign.external_key, program.direction_key || null, requestSignal),
      program.directionCode
        ? directionData(expectedReleaseKey, campaign.external_key, program.directionCode, campaign.year, requestSignal)
        : Promise.resolve(null),
    ]);
    const direction = byDirection;
    const releaseKey = campaigns.releaseKey;
    const requirements = requirementsByDirection.items
      .filter((item) => item.direction_key === program.direction_key);
    assertSingleRelease(releaseKey, shared.offerings, shared.calendar, shared.quotas, requirementsByDirection);
    if (direction) assertSingleRelease(releaseKey, direction.pools, direction.history, direction.campaignStatistics, direction.tuition);

    const result: ProgramAdmissionData = {
      releaseKey,
      campaigns: campaigns.items,
      offerings: shared.offerings.items,
      calendar: shared.calendar.items,
      pools: direction?.pools.items ?? [],
      quotas: shared.quotas.items,
      requirements,
      history: direction?.history.items ?? [],
      campaignStatistics: direction?.campaignStatistics.items ?? [],
      tuition: direction?.tuition.items ?? [],
    };
    if (!releaseKey) throw new AcademicApiContractError("Admission data is missing its academic release identity.");
    return result;
  });
  assertSingleRelease(expectedReleaseKey, {
    releaseKey: result.releaseKey,
    label: `admission data for ${program.external_key}`,
  });
  return result;
}
