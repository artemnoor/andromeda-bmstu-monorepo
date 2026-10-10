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
  readonly requirements: AcademicCollection<RequirementDto>;
}

interface DirectionData {
  readonly pools: AcademicCollection<CompetitionPoolDto>;
  readonly history: AcademicCollection<AdmissionStatisticDto>;
  readonly campaignStatistics: AcademicCollection<AdmissionStatisticDto>;
  readonly tuition: AcademicCollection<TuitionDto>;
}

const campaignCache = new Map<string, Promise<AcademicCollection<AdmissionCampaignDto>>>();
const campaignDataCache = new Map<string, Promise<{
  readonly offerings: AcademicCollection<AdmissionOfferingDto>;
  readonly calendar: AcademicCollection<CampaignCalendarEventDto>;
  readonly quotas: AcademicCollection<PlaceQuotaDto>;
  readonly requirements: AcademicCollection<RequirementDto>;
}>>();
const directionDataCache = new Map<string, Promise<{
  readonly pools: AcademicCollection<CompetitionPoolDto>;
  readonly history: AcademicCollection<AdmissionStatisticDto>;
  readonly campaignStatistics: AcademicCollection<AdmissionStatisticDto>;
  readonly tuition: AcademicCollection<TuitionDto>;
}>>();
const programCache = new Map<string, Promise<ProgramAdmissionData>>();

function cached<T>(store: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  const existing = store.get(key);
  if (existing) return existing;
  const pending = load().catch((error: unknown) => {
    if (store.get(key) === pending) store.delete(key);
    throw error;
  });
  store.set(key, pending);
  return pending;
}

function campaignsFor(): Promise<AcademicCollection<AdmissionCampaignDto>> {
  const cacheKey = "active-release-campaigns";
  const existing = campaignCache.get(cacheKey);
  if (existing) return existing;
  const pending = getCampaigns().catch((error: unknown) => {
    if (campaignCache.get(cacheKey) === pending) campaignCache.delete(cacheKey);
    throw error;
  });
  campaignCache.set(cacheKey, pending);
  return pending;
}

function campaignData(campaignKey: string): Promise<CampaignData> {
  return cached(campaignDataCache, campaignKey, async () => {
    const [offerings, calendar, quotas, requirements] = await Promise.all([
      getCampaignOfferings(campaignKey),
      getCampaignCalendar(campaignKey),
      getPlaceQuotas(campaignKey),
      getRequirements(campaignKey),
    ]);
    assertSingleRelease(offerings.releaseKey, calendar, quotas, requirements);
    return { offerings, calendar, quotas, requirements };
  });
}

function directionData(
  campaignKey: string,
  directionCode: string,
  campaignYear: number,
): Promise<DirectionData> {
  const key = `${campaignKey}\u0000${directionCode}\u0000${campaignYear}`;
  return cached(directionDataCache, key, async () => {
    const [pools, history, campaignStatistics, tuition] = await Promise.all([
      getCompetitionPools(campaignKey, directionCode),
      getStatistics({ kind: "historical", directionCode }),
      getStatistics({ kind: "admission", year: campaignYear, directionCode }),
      getTuition(directionCode),
    ]);
    assertSingleRelease(pools.releaseKey, history, campaignStatistics, tuition);
    return { pools, history, campaignStatistics, tuition };
  });
}

export function getProgramAdmission(program: CatalogProgram): Promise<ProgramAdmissionData> {
  const key = program.external_key;
  return cached(programCache, key, async () => {
    const campaigns = await campaignsFor();
    const campaign = campaigns.items
      .filter((item) => item.campaign_kind === "admission")
      .sort((left, right) => right.year - left.year)[0];
    if (!campaign) {
      return {
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
    }

    const [shared, byDirection] = await Promise.all([
      campaignData(campaign.external_key),
      program.directionCode
        ? directionData(campaign.external_key, program.directionCode, campaign.year)
        : Promise.resolve(null),
    ]);
    const direction = byDirection;
    const releaseKey = campaigns.releaseKey;
    const requirements = shared.requirements.items.filter((item) => item.direction_key === program.direction_key);
    assertSingleRelease(releaseKey, shared.offerings, shared.calendar, shared.quotas, shared.requirements);
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
}
