import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RELEASE_KEY = "release-2026-01";

type FetchHandler = (url: URL, init?: RequestInit) => Response | Promise<Response>;
type ClientModule = typeof import("../../src/shared/api/client");

let api: ClientModule;
let fetchMock: ReturnType<typeof vi.fn>;

function requestUrl(input: RequestInfo | URL): URL {
  const value = input instanceof Request
    ? input.url
    : input instanceof URL
      ? input.href
      : String(input);
  return new URL(value, "http://andromeda.test");
}

function installFetch(handler: FetchHandler): void {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => (
    handler(requestUrl(input), init)
  ));
}

function jsonResponse(payload: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...Object.fromEntries(new Headers(headers)) },
  });
}

function page<T>(
  items: T[],
  options: { cursor?: string | null; releaseKey?: string; totalCount?: number | null } = {},
): unknown {
  return {
    items,
    page: {
      limit: 100,
      next_cursor: options.cursor ?? null,
      total_count: options.totalCount ?? items.length,
      release_key: options.releaseKey ?? RELEASE_KEY,
    },
  };
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("VITE_API_BASE_URL", "http://andromeda.test");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  installFetch(() => jsonResponse({ error: { code: "unexpected_test_request" } }, 500));
  api = await import("../../src/shared/api/client");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("typed OpenAPI client contract", () => {
  it("loads all campaigns from the pinned active release when no calendar year is supplied", async () => {
    installFetch((url) => {
      if (url.pathname === "/api/v1/release") return jsonResponse({ release_key: RELEASE_KEY });
      return jsonResponse(page([
        { external_key: "campaign:2025", campaign_kind: "admission", year: 2025 },
        { external_key: "campaign:2026", campaign_kind: "admission", year: 2026 },
      ]));
    });

    const campaigns = await api.getCampaigns();
    expect(campaigns.items.map((campaign) => campaign.year)).toEqual([2025, 2026]);
    expect(campaigns.releaseKey).toBe(RELEASE_KEY);
    const request = fetchMock.mock.calls
      .map(([input]) => requestUrl(input as RequestInfo | URL))
      .find((url) => url.pathname === "/api/v1/campaigns");
    expect(request).toBeDefined();
    expect(Object.fromEntries(request?.searchParams ?? [])).toEqual({ limit: "100" });
  });

  it("uses the declared GET paths and query parameters for its API operations", async () => {
    installFetch((url) => {
      if (url.pathname === "/api/v1/release") return jsonResponse({ release_key: RELEASE_KEY });
      if (url.pathname === "/api/v1/subject-taxonomies/subjects/v1") {
        return jsonResponse({ taxonomy_key: "subjects", version: "v1" });
      }
      if (url.pathname === "/api/v1/requirements") {
        return jsonResponse(page([
          { external_key: "requirement-1", direction_key: "direction-1" },
          { external_key: "requirement-2", direction_key: "direction-2" },
        ]));
      }
      return jsonResponse(page([]));
    });

    await api.getActiveRelease();
    await api.listPrograms();
    await api.listDirections();
    await api.listDepartments();
    await api.getStudyPlans("program-1");
    await api.getStudyPlanItems("plan 01");
    await api.getCampaigns(2026);
    await api.getCampaignOfferings("campaign 01");
    await api.getCampaignCalendar("campaign 01");
    const requirements = await api.getRequirements("campaign 01", "direction-1");
    await api.getCompetitionPools("campaign 01", "09.03.01");
    await api.getPlaceQuotas("campaign 01");
    await api.getTuition("09.03.01");
    await api.getStatistics({ kind: "historical", year: 2024, directionCode: "09.03.01" });
    await api.getTaxonomy("subjects", "v1");

    expect(requirements.items).toEqual([
      { external_key: "requirement-1", direction_key: "direction-1" },
    ]);

    const requests = fetchMock.mock.calls.map(([input, init]) => ({
      url: requestUrl(input as RequestInfo | URL),
      method: input instanceof Request ? input.method : init?.method ?? "GET",
    }));
    const expected = [
      ["/api/v1/release", {}],
      ["/api/v1/programs", { limit: "100" }],
      ["/api/v1/directions", { limit: "100" }],
      ["/api/v1/departments", { limit: "100" }],
      ["/api/v1/study-plans", { program_key: "program-1", limit: "100" }],
      ["/api/v1/study-plans/plan%2001/items", { limit: "100" }],
      ["/api/v1/campaigns", { year: "2026", limit: "100" }],
      ["/api/v1/campaigns/campaign%2001/offerings", { limit: "100" }],
      ["/api/v1/campaigns/campaign%2001/calendar", { limit: "100" }],
      ["/api/v1/requirements", { campaign_key: "campaign 01", limit: "100" }],
      ["/api/v1/competition-pools", {
        campaign_key: "campaign 01",
        direction_code: "09.03.01",
        limit: "100",
      }],
      ["/api/v1/place-quotas", { campaign_key: "campaign 01", limit: "100" }],
      ["/api/v1/tuition", { direction_code: "09.03.01", limit: "100" }],
      ["/api/v1/statistics", {
        kind: "historical",
        year: "2024",
        direction_code: "09.03.01",
        limit: "100",
      }],
      ["/api/v1/subject-taxonomies/subjects/v1", {}],
    ] as const;

    expect(requests).toHaveLength(expected.length);
    for (const [index, [pathname, expectedQuery]] of expected.entries()) {
      const actual = requests[index];
      expect(actual, `request ${index + 1}`).toBeDefined();
      expect(actual?.method).toBe("GET");
      expect(actual?.url.pathname).toBe(pathname);
      expect(Object.fromEntries(actual?.url.searchParams ?? [])).toEqual(expectedQuery);
    }
  });

  it("traverses pagination with the requested cursor and returns one collection", async () => {
    installFetch((url) => {
      if (url.pathname === "/api/v1/release") return jsonResponse({ release_key: RELEASE_KEY });
      const cursor = url.searchParams.get("cursor");
      return cursor === null
        ? jsonResponse(page([{ external_key: "program-1" }], { cursor: "cursor-2", totalCount: 2 }))
        : jsonResponse(page([{ external_key: "program-2" }], { totalCount: 2 }));
    });

    const collection = await api.listPrograms();

    expect(collection).toEqual({
      items: [{ external_key: "program-1" }, { external_key: "program-2" }],
      releaseKey: RELEASE_KEY,
      totalCount: 2,
    });
    const programRequests = fetchMock.mock.calls
      .map(([input]) => requestUrl(input as RequestInfo | URL))
      .filter((url) => url.pathname === "/api/v1/programs");
    expect(programRequests).toHaveLength(2);
    expect(programRequests[0]?.searchParams.get("limit")).toBe("100");
    expect(programRequests[0]?.searchParams.has("cursor")).toBe(false);
    expect(programRequests[1]?.searchParams.get("cursor")).toBe("cursor-2");
  });

  it("fails closed when the API repeats a pagination cursor", async () => {
    let programPage = 0;
    installFetch((url) => {
      if (url.pathname === "/api/v1/release") return jsonResponse({ release_key: RELEASE_KEY });
      programPage += 1;
      const programKey = programPage === 1 ? "program-1" : "program-2";
      return jsonResponse(page(
        [{ external_key: programKey }],
        { cursor: "cursor-1", totalCount: 2 },
      ));
    });

    await expect(api.listPrograms()).rejects.toMatchObject({
      name: "AcademicApiContractError",
      message: expect.stringContaining("repeated cursor"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("surfaces the API error envelope and ignores malformed field issues", async () => {
    installFetch((url) => {
      if (url.pathname === "/api/v1/release") return jsonResponse({ release_key: RELEASE_KEY });
      return jsonResponse({
        error: {
          code: "invalid_filter",
          message: "The filter is invalid.",
          request_id: "request-123",
          field_issues: [
            { path: ["direction_code"], code: "invalid", message: "Unknown direction." },
            { path: "not-an-array", code: 4, message: null },
          ],
        },
      }, 422);
    });

    await expect(api.listPrograms()).rejects.toMatchObject({
      name: "AcademicApiError",
      message: "The filter is invalid.",
      status: 422,
      code: "invalid_filter",
      requestId: "request-123",
      fieldIssues: [
        { path: ["direction_code"], code: "invalid", message: "Unknown direction." },
      ],
    });
  });

  it("rejects a collection whose page belongs to another release", async () => {
    installFetch((url) => {
      if (url.pathname === "/api/v1/release") return jsonResponse({ release_key: RELEASE_KEY });
      return jsonResponse(page([], { releaseKey: "release-2025-02" }));
    });

    await expect(api.listPrograms()).rejects.toMatchObject({
      name: "AcademicReleaseMismatchError",
      expectedReleaseKey: RELEASE_KEY,
      actualReleaseKey: "release-2025-02",
    });
  });

  it("rejects a catalog snapshot if active release changes during the read", async () => {
    let releaseReadCount = 0;
    installFetch((url) => {
      if (url.pathname === "/api/v1/release") {
        releaseReadCount += 1;
        const releaseKey = releaseReadCount === 1 ? RELEASE_KEY : "release-2026-02";
        return jsonResponse({ release_key: releaseKey });
      }
      return jsonResponse(page([]));
    });

    await expect(api.loadCatalog()).rejects.toMatchObject({
      name: "AcademicReleaseMismatchError",
      expectedReleaseKey: RELEASE_KEY,
      actualReleaseKey: "release-2026-02",
    });
    expect(releaseReadCount).toBe(2);
  });
});
