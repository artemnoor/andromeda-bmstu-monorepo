import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogProgram } from "@/features/catalog/model";

const RELEASE_KEY = "release:active";

type RecordedRequest = {
  readonly url: URL;
  readonly method: string;
};

let requests: RecordedRequest[];
let fetchMock: ReturnType<typeof vi.fn>;
let getProgramAdmission: typeof import("@/features/catalog/admission-api")["getProgramAdmission"];

function requestUrl(input: RequestInfo | URL): URL {
  const value = input instanceof Request
    ? input.url
    : input instanceof URL
      ? input.href
      : String(input);
  return new URL(value, "http://andromeda.test");
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function page(items: readonly unknown[]): unknown {
  return {
    items,
    page: {
      limit: 100,
      next_cursor: null,
      total_count: items.length,
      release_key: RELEASE_KEY,
    },
  };
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  // The newest campaign in this active release is deliberately older than the
  // browser's current year, so a wall-clock-year filter would return no rows.
  vi.setSystemTime(new Date("2032-01-15T12:00:00Z"));
  vi.stubEnv("VITE_API_BASE_URL", "http://andromeda.test");
  requests = [];
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const method = input instanceof Request ? input.method : init?.method ?? "GET";
    requests.push({ url, method });

    if (url.pathname === "/api/v1/release") {
      return jsonResponse({ release_key: RELEASE_KEY });
    }
    if (url.pathname === "/api/v1/campaigns") {
      const campaigns = [
        { external_key: "campaign:2024", campaign_kind: "admission", year: 2024 },
        { external_key: "campaign:2026", campaign_kind: "admission", year: 2026 },
      ];
      const requestedYear = url.searchParams.get("year");
      const matching = requestedYear === null
        ? campaigns
        : campaigns.filter((campaign) => campaign.year === Number(requestedYear));
      return jsonResponse(page(matching));
    }
    return jsonResponse(page([]));
  });
  vi.stubGlobal("fetch", fetchMock);
  ({ getProgramAdmission } = await import("@/features/catalog/admission-api"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("admission campaign selection", () => {
  it("uses the latest admission campaign in the active release regardless of calendar year", async () => {
    const program = {
      external_key: "program:09.03.01-01",
      direction_key: "direction:09.03.01",
      directionCode: "09.03.01",
    } as CatalogProgram;

    const admission = await getProgramAdmission(program);

    expect(admission.releaseKey).toBe(RELEASE_KEY);
    expect(admission.campaigns.map((campaign) => campaign.year)).toEqual([2024, 2026]);

    const campaignListRequest = requests.find(({ url }) => url.pathname === "/api/v1/campaigns");
    expect(campaignListRequest?.url.searchParams.has("year")).toBe(false);

    const campaignDetailRequests = requests.filter(({ url }) => (
      url.pathname.startsWith("/api/v1/campaigns/")
      && (url.pathname.endsWith("/offerings") || url.pathname.endsWith("/calendar"))
    ));
    expect(campaignDetailRequests).toHaveLength(2);
    expect(campaignDetailRequests.every(({ url }) => decodeURIComponent(url.pathname).includes("campaign:2026"))).toBe(true);
    expect(campaignDetailRequests.some(({ url }) => decodeURIComponent(url.pathname).includes("campaign:2024"))).toBe(false);

    const admissionStatisticsRequest = requests.find(({ url }) => (
      url.pathname === "/api/v1/statistics" && url.searchParams.get("kind") === "admission"
    ));
    expect(admissionStatisticsRequest?.url.searchParams.get("year")).toBe("2026");
    expect(requests.every(({ method }) => method === "GET")).toBe(true);
  });
});
