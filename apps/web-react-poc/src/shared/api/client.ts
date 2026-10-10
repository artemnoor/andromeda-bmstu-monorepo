import createClient from "openapi-fetch";
import type { components, paths } from "./schema";

const PAGE_SIZE = 100;
const MAX_PAGES = 500;
const REQUEST_TIMEOUT_MS = 15_000;

const client = createClient<paths>({
  // Empty means same-origin `/api/v1`, which the local Vite proxy forwards to FastAPI.
  // Set VITE_API_BASE_URL to an API origin (without `/api/v1`) for a separate origin.
  baseUrl: (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, ""),
});

export type ApiSchemas = components["schemas"];
export type ProgramDto = components["schemas"]["EducationalProgramRecord"];
export type DirectionDto = components["schemas"]["DirectionRecord"];
export type DepartmentDto = components["schemas"]["DepartmentRecord"];
export type StudyPlanDto = components["schemas"]["StudyPlanRecord"];
export type CurriculumItemDto = components["schemas"]["CurriculumItemRecord"];
export type AdmissionCampaignDto = components["schemas"]["AdmissionCampaignRecord"];
export type AdmissionOfferingDto = components["schemas"]["AdmissionOfferingRecord"];
export type CampaignCalendarEventDto = components["schemas"]["CampaignCalendarEventRecord"];
export type RequirementDto = components["schemas"]["RequirementTreeRecord"];
export type CompetitionPoolDto = components["schemas"]["CompetitionPoolRecord"];
export type PlaceQuotaDto = components["schemas"]["PlaceQuotaRecord"];
export type TuitionDto = components["schemas"]["TuitionRecord"];
export type AdmissionStatisticDto = components["schemas"]["OfficialAdmissionStatisticRecord"];
export type SubjectTaxonomyDto = components["schemas"]["SubjectTaxonomyRecord"];
export type ActiveReleaseDto = components["schemas"]["ReleaseMetadataRecord"];
export interface ApiFieldIssue {
  readonly path: readonly (string | number)[];
  readonly code: string;
  readonly message: string;
}

export interface AcademicCollection<T> {
  readonly items: readonly T[];
  readonly releaseKey: string;
  readonly totalCount: number | null;
}

export interface CatalogSnapshot {
  readonly release: ActiveReleaseDto;
  readonly programs: AcademicCollection<ProgramDto>;
  readonly directions: AcademicCollection<DirectionDto>;
  readonly departments: AcademicCollection<DepartmentDto>;
}

export class AcademicApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly fieldIssues: readonly ApiFieldIssue[];

  constructor(options: {
    message: string;
    status: number;
    code: string;
    requestId?: string | null;
    fieldIssues?: readonly ApiFieldIssue[];
  }) {
    super(options.message);
    this.name = "AcademicApiError";
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId ?? null;
    this.fieldIssues = options.fieldIssues ?? [];
  }
}

export class AcademicReleaseMismatchError extends Error {
  readonly expectedReleaseKey: string;
  readonly actualReleaseKey: string;

  constructor(expectedReleaseKey: string, actualReleaseKey: string) {
    super(
      `Academic data came from different releases (expected ${expectedReleaseKey}, received ${actualReleaseKey}). Reload to use one consistent release.`,
    );
    this.name = "AcademicReleaseMismatchError";
    this.expectedReleaseKey = expectedReleaseKey;
    this.actualReleaseKey = actualReleaseKey;
  }
}

export class AcademicApiContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcademicApiContractError";
  }
}

type ClientResult<T> = {
  data?: T;
  error?: unknown;
  response: Response;
};

type Page<T> = {
  items: T[];
  page: components["schemas"]["PaginationMetadata"];
};

type NormalizedPage<T> = {
  items: T[];
  page: {
    limit: number;
    next_cursor: string | null;
    total_count: number | null;
    release_key: string;
  };
};

type ReleaseBound = {
  readonly releaseKey: string;
  readonly label?: string;
};

let pinnedReleaseKey: string | null = null;
let verifiedCatalogSnapshot: CatalogSnapshot | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFieldIssue(value: unknown): value is ApiFieldIssue {
  return isRecord(value)
    && Array.isArray(value.path)
    && value.path.every((part) => typeof part === "string" || typeof part === "number")
    && typeof value.code === "string"
    && typeof value.message === "string";
}

function serverErrorDetails(value: unknown): {
  message: string;
  code: string;
  requestId: string | null;
  fieldIssues: readonly ApiFieldIssue[];
} {
  const envelope = isRecord(value) && isRecord(value.error) ? value.error : value;
  if (!isRecord(envelope)) {
    return {
      message: "The academic data request could not be completed.",
      code: "http_error",
      requestId: null,
      fieldIssues: [],
    };
  }

  return {
    message: typeof envelope.message === "string"
      ? envelope.message
      : typeof envelope.detail === "string"
        ? envelope.detail
        : "The academic data request could not be completed.",
    code: typeof envelope.code === "string" ? envelope.code : "http_error",
    requestId: typeof envelope.request_id === "string" ? envelope.request_id : null,
    fieldIssues: Array.isArray(envelope.field_issues)
      ? envelope.field_issues.filter(isFieldIssue)
      : [],
  };
}

function apiError(response: Response, payload: unknown): AcademicApiError {
  const details = serverErrorDetails(payload);
  return new AcademicApiError({
    message: details.message,
    status: response.status,
    code: details.code,
    requestId: details.requestId ?? response.headers.get("x-request-id"),
    fieldIssues: details.fieldIssues,
  });
}

async function request<T>(
  path: string,
  execute: (signal: AbortSignal) => Promise<ClientResult<T>>,
  externalSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort(externalSignal?.reason);

  if (externalSignal?.aborted) abortFromCaller();
  else externalSignal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    const result = await execute(controller.signal);
    if (!result.response.ok) throw apiError(result.response, result.error);
    if (result.data === undefined) {
      throw new AcademicApiContractError(`The API returned no response body for ${path}.`);
    }
    return result.data;
  } catch (error) {
    if (error instanceof AcademicApiError || error instanceof AcademicApiContractError) throw error;
    if (externalSignal?.aborted) {
      throw externalSignal.reason ?? error;
    }
    if (timedOut) {
      throw new AcademicApiError({
        message: "The academic data request timed out. Please try again.",
        status: 0,
        code: "request_timeout",
      });
    }
    throw new AcademicApiError({
      message: "Could not connect to the academic data service. Please try again.",
      status: 0,
      code: "network_error",
    });
  } finally {
    globalThis.clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  }
}

function validatePage<T>(value: Page<T>, path: string): NormalizedPage<T> {
  const payload: unknown = value;
  if (!isRecord(payload) || !Array.isArray(payload.items) || !isRecord(payload.page)) {
    throw new AcademicApiContractError(`Unexpected paginated response for ${path}.`);
  }

  const metadata = payload.page;
  if (
    typeof metadata.limit !== "number"
    || !Number.isInteger(metadata.limit)
    || metadata.limit < 1
    || metadata.limit > PAGE_SIZE
    || typeof metadata.release_key !== "string"
    || metadata.release_key.length === 0
  ) {
    throw new AcademicApiContractError(`Invalid pagination metadata for ${path}.`);
  }
  const nextCursor = metadata.next_cursor;
  if (nextCursor !== undefined && nextCursor !== null && typeof nextCursor !== "string") {
    throw new AcademicApiContractError(`Invalid pagination cursor for ${path}.`);
  }
  const totalCount = metadata.total_count;
  if (
    totalCount !== undefined
    && totalCount !== null
    && (typeof totalCount !== "number" || !Number.isInteger(totalCount) || totalCount < 0)
  ) {
    throw new AcademicApiContractError(`Invalid total count for ${path}.`);
  }

  return {
    // The OpenAPI-generated client supplies T for records; runtime validation here
    // verifies the transport envelope without duplicating the generated DTO schemas.
    items: payload.items as T[],
    page: {
      limit: metadata.limit,
      next_cursor: typeof nextCursor === "string" ? nextCursor : null,
      total_count: typeof totalCount === "number" ? totalCount : null,
      release_key: metadata.release_key,
    },
  };
}

function pinRelease(releaseKey: string): string {
  if (!releaseKey) throw new AcademicApiContractError("The API returned an empty release key.");
  if (pinnedReleaseKey !== null && pinnedReleaseKey !== releaseKey) {
    throw new AcademicReleaseMismatchError(pinnedReleaseKey, releaseKey);
  }
  pinnedReleaseKey ??= releaseKey;
  return releaseKey;
}

async function ensureRelease(signal?: AbortSignal): Promise<string> {
  if (pinnedReleaseKey !== null) return pinnedReleaseKey;
  return (await getActiveRelease(signal)).release_key;
}

async function collectPages<T>(
  path: string,
  expectedReleaseKey: string,
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
): Promise<AcademicCollection<T>> {
  const items: T[] = [];
  const seenCursors = new Set<string>();
  const seenExternalKeys = new Set<string>();
  let cursor: string | undefined;
  let totalCount: number | null = null;
  let totalCountObserved = false;

  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
    const page = validatePage(await fetchPage(cursor), path);
    const pageReleaseKey = pinRelease(page.page.release_key);
    if (pageReleaseKey !== expectedReleaseKey) {
      throw new AcademicReleaseMismatchError(expectedReleaseKey, pageReleaseKey);
    }
    if (!totalCountObserved) {
      totalCount = page.page.total_count;
      totalCountObserved = true;
    } else if (page.page.total_count !== totalCount) {
      throw new AcademicApiContractError(`The total count changed while paging ${path}.`);
    }

    for (const item of page.items) {
      const record: unknown = item;
      if (!isRecord(record) || typeof record.external_key !== "string" || !record.external_key) {
        throw new AcademicApiContractError(`A record from ${path} has no external identity.`);
      }
      if (seenExternalKeys.has(record.external_key)) {
        throw new AcademicApiContractError(`Pagination for ${path} repeated ${record.external_key}.`);
      }
      seenExternalKeys.add(record.external_key);
      items.push(item);
    }
    const nextCursor = page.page.next_cursor;
    if (nextCursor === null) {
      if (totalCount !== null && items.length !== totalCount) {
        throw new AcademicApiContractError(`Pagination for ${path} returned ${items.length} of ${totalCount} records.`);
      }
      return { items, releaseKey: expectedReleaseKey, totalCount };
    }
    if (nextCursor.length === 0 || nextCursor === cursor || seenCursors.has(nextCursor)) {
      throw new AcademicApiContractError(`The API returned a repeated cursor for ${path}.`);
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  throw new AcademicApiContractError(`The API exceeded ${MAX_PAGES} pages for ${path}.`);
}

export async function getActiveRelease(signal?: AbortSignal): Promise<ActiveReleaseDto> {
  const release = await request("/api/v1/release", (requestSignal) => (
    client.GET("/api/v1/release", { signal: requestSignal })
  ), signal);
  pinRelease(release.release_key);
  return release;
}

export async function listPrograms(
  options: { signal?: AbortSignal | undefined } = {},
): Promise<AcademicCollection<ProgramDto>> {
  const expectedReleaseKey = await ensureRelease(options.signal);
  return collectPages("/api/v1/programs", expectedReleaseKey, async (cursor) => {
    const response = await request("/api/v1/programs", (signal) => client.GET("/api/v1/programs", {
      params: { query: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) } },
      signal,
    }), options.signal);
    return response;
  });
}

export async function listDirections(signal?: AbortSignal): Promise<AcademicCollection<DirectionDto>> {
  const expectedReleaseKey = await ensureRelease(signal);
  return collectPages("/api/v1/directions", expectedReleaseKey, async (cursor) => {
    const response = await request("/api/v1/directions", (requestSignal) => client.GET("/api/v1/directions", {
      params: { query: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) } },
      signal: requestSignal,
    }), signal);
    return response;
  });
}

export async function listDepartments(signal?: AbortSignal): Promise<AcademicCollection<DepartmentDto>> {
  const expectedReleaseKey = await ensureRelease(signal);
  return collectPages("/api/v1/departments", expectedReleaseKey, async (cursor) => {
    const response = await request("/api/v1/departments", (requestSignal) => client.GET("/api/v1/departments", {
      params: { query: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) } },
      signal: requestSignal,
    }), signal);
    return response;
  });
}

export async function getStudyPlans(programKey: string, signal?: AbortSignal): Promise<AcademicCollection<StudyPlanDto>> {
  const expectedReleaseKey = await ensureRelease(signal);
  return collectPages("/api/v1/study-plans", expectedReleaseKey, async (cursor) => {
    const response = await request("/api/v1/study-plans", (requestSignal) => client.GET("/api/v1/study-plans", {
      params: { query: { program_key: programKey, limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) } },
      signal: requestSignal,
    }), signal);
    return response;
  });
}

export async function getStudyPlanItems(planKey: string, signal?: AbortSignal): Promise<AcademicCollection<CurriculumItemDto>> {
  const expectedReleaseKey = await ensureRelease(signal);
  return collectPages("/api/v1/study-plans/{key}/items", expectedReleaseKey, async (cursor) => {
    const response = await request("/api/v1/study-plans/{key}/items", (requestSignal) => client.GET(
      "/api/v1/study-plans/{key}/items",
      {
        params: {
          path: { key: planKey },
          query: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) },
        },
        signal: requestSignal,
      },
    ), signal);
    return response;
  });
}

export async function getCampaigns(year?: number, signal?: AbortSignal): Promise<AcademicCollection<AdmissionCampaignDto>> {
  const expectedReleaseKey = await ensureRelease(signal);
  return collectPages("/api/v1/campaigns", expectedReleaseKey, async (cursor) => {
    const response = await request("/api/v1/campaigns", (requestSignal) => client.GET("/api/v1/campaigns", {
      params: { query: { ...(year === undefined ? {} : { year }), limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) } },
      signal: requestSignal,
    }), signal);
    return response;
  });
}

export async function getCampaignOfferings(
  campaignKey: string,
  signal?: AbortSignal,
): Promise<AcademicCollection<AdmissionOfferingDto>> {
  const expectedReleaseKey = await ensureRelease(signal);
  return collectPages("/api/v1/campaigns/{key}/offerings", expectedReleaseKey, async (cursor) => {
    const response = await request("/api/v1/campaigns/{key}/offerings", (requestSignal) => client.GET(
      "/api/v1/campaigns/{key}/offerings",
      {
        params: {
          path: { key: campaignKey },
          query: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) },
        },
        signal: requestSignal,
      },
    ), signal);
    return response;
  });
}

export async function getCampaignCalendar(
  campaignKey: string,
  signal?: AbortSignal,
): Promise<AcademicCollection<CampaignCalendarEventDto>> {
  const expectedReleaseKey = await ensureRelease(signal);
  return collectPages("/api/v1/campaigns/{key}/calendar", expectedReleaseKey, async (cursor) => {
    const response = await request("/api/v1/campaigns/{key}/calendar", (requestSignal) => client.GET(
      "/api/v1/campaigns/{key}/calendar",
      {
        params: {
          path: { key: campaignKey },
          query: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) },
        },
        signal: requestSignal,
      },
    ), signal);
    return response;
  });
}

export async function getRequirements(
  campaignKey?: string,
  directionKey?: string,
  signal?: AbortSignal,
): Promise<AcademicCollection<RequirementDto>> {
  const expectedReleaseKey = await ensureRelease(signal);
  const collection = await collectPages("/api/v1/requirements", expectedReleaseKey, async (cursor) => {
    const response = await request("/api/v1/requirements", (requestSignal) => client.GET("/api/v1/requirements", {
      params: {
        query: {
          ...(campaignKey ? { campaign_key: campaignKey } : {}),
          ...(directionKey ? { direction_key: directionKey } : {}),
          limit: PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
        },
      },
      signal: requestSignal,
    }), signal);
    return response;
  });
  if (!directionKey) return collection;
  const items = collection.items.filter((requirement) => requirement.direction_key === directionKey);
  return { ...collection, items, totalCount: items.length };
}

export async function getCompetitionPools(
  campaignKey?: string,
  directionCode?: string,
  signal?: AbortSignal,
): Promise<AcademicCollection<CompetitionPoolDto>> {
  const expectedReleaseKey = await ensureRelease(signal);
  return collectPages("/api/v1/competition-pools", expectedReleaseKey, async (cursor) => {
    const response = await request("/api/v1/competition-pools", (requestSignal) => client.GET("/api/v1/competition-pools", {
      params: {
        query: {
          ...(campaignKey ? { campaign_key: campaignKey } : {}),
          ...(directionCode ? { direction_code: directionCode } : {}),
          limit: PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
        },
      },
      signal: requestSignal,
    }), signal);
    return response;
  });
}

export async function getPlaceQuotas(
  campaignKey?: string,
  signal?: AbortSignal,
): Promise<AcademicCollection<PlaceQuotaDto>> {
  const expectedReleaseKey = await ensureRelease(signal);
  return collectPages("/api/v1/place-quotas", expectedReleaseKey, async (cursor) => {
    const response = await request("/api/v1/place-quotas", (requestSignal) => client.GET("/api/v1/place-quotas", {
      params: {
        query: {
          ...(campaignKey ? { campaign_key: campaignKey } : {}),
          limit: PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
        },
      },
      signal: requestSignal,
    }), signal);
    return response;
  });
}

export async function getTuition(
  directionCode?: string,
  signal?: AbortSignal,
): Promise<AcademicCollection<TuitionDto>> {
  const expectedReleaseKey = await ensureRelease(signal);
  return collectPages("/api/v1/tuition", expectedReleaseKey, async (cursor) => {
    const response = await request("/api/v1/tuition", (requestSignal) => client.GET("/api/v1/tuition", {
      params: {
        query: {
          ...(directionCode ? { direction_code: directionCode } : {}),
          limit: PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
        },
      },
      signal: requestSignal,
    }), signal);
    return response;
  });
}

export interface StatisticsQuery {
  readonly kind?: "historical" | "admission";
  readonly year?: number;
  readonly directionCode?: string;
}

export async function getStatistics(
  filters: StatisticsQuery = {},
  signal?: AbortSignal,
): Promise<AcademicCollection<AdmissionStatisticDto>> {
  const expectedReleaseKey = await ensureRelease(signal);
  return collectPages("/api/v1/statistics", expectedReleaseKey, async (cursor) => {
    const response = await request("/api/v1/statistics", (requestSignal) => client.GET("/api/v1/statistics", {
      params: {
        query: {
          ...(filters.kind ? { kind: filters.kind } : {}),
          ...(filters.year !== undefined ? { year: filters.year } : {}),
          ...(filters.directionCode ? { direction_code: filters.directionCode } : {}),
          limit: PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
        },
      },
      signal: requestSignal,
    }), signal);
    return response;
  });
}

export async function getTaxonomy(
  taxonomyKey: string,
  taxonomyVersion: string,
  signal?: AbortSignal,
): Promise<SubjectTaxonomyDto> {
  return request("/api/v1/subject-taxonomies/{taxonomy_key}/{taxonomy_version}", (requestSignal) => client.GET(
    "/api/v1/subject-taxonomies/{taxonomy_key}/{taxonomy_version}",
    {
      params: { path: { taxonomy_key: taxonomyKey, taxonomy_version: taxonomyVersion } },
      signal: requestSignal,
    },
  ), signal);
}

export function assertSingleRelease(
  expectedReleaseKey: string,
  ...collections: readonly ReleaseBound[]
): string {
  if (!expectedReleaseKey) throw new AcademicApiContractError("An expected release key is required.");
  pinRelease(expectedReleaseKey);
  for (const collection of collections) {
    if (collection.releaseKey !== expectedReleaseKey) {
      throw new AcademicReleaseMismatchError(expectedReleaseKey, collection.releaseKey);
    }
  }
  return expectedReleaseKey;
}

export async function loadCatalog(signal?: AbortSignal): Promise<CatalogSnapshot> {
  const release = await getActiveRelease(signal);
  const cached = verifiedCatalogSnapshot;
  if (cached?.release.release_key === release.release_key) {
    assertSingleRelease(release.release_key, cached.programs, cached.directions, cached.departments);
    // A cached snapshot is still bracketed by active-release reads. The source
    // rows are immutable, but activation can change while this route loads.
    const activeAfterRead = await getActiveRelease(signal);
    assertSingleRelease(release.release_key, cached.programs, cached.directions, cached.departments, {
      releaseKey: activeAfterRead.release_key,
      label: "active release after cached catalog read",
    });
    return { ...cached, release };
  }

  const [programs, directions, departments] = await Promise.all([
    listPrograms({ signal }),
    listDirections(signal),
    listDepartments(signal),
  ]);

  assertSingleRelease(release.release_key, programs, directions, departments);
  // The API exposes the active immutable release, not a historical-release selector.
  // Bracket the independent collection requests to fail closed if activation changed.
  const activeAfterRead = await getActiveRelease(signal);
  assertSingleRelease(release.release_key, programs, directions, departments, {
    releaseKey: activeAfterRead.release_key,
    label: "active release after catalog load",
  });

  const snapshot = { release, programs, directions, departments };
  verifiedCatalogSnapshot = snapshot;
  return snapshot;
}
