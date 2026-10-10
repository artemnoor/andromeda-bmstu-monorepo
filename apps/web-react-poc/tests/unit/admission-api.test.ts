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

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function requestSignal(input: RequestInfo | URL, init?: RequestInit): AbortSignal | null {
  return init?.signal ?? (input instanceof Request ? input.signal : null);
}

function admissionProgram(externalKey = "program:09.03.01-01"): CatalogProgram {
  return {
    external_key: externalKey,
    direction_key: "direction:09.03.01",
    directionCode: "09.03.01",
  } as CatalogProgram;
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

    const admission = await getProgramAdmission(program, { expectedReleaseKey: RELEASE_KEY });

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

  it("loads requirements by exact direction identity and reuses them for programs in that direction", async () => {
    const firstProgram = admissionProgram("program:09.03.01-01");
    const secondProgram = admissionProgram("program:09.03.01-02");

    await Promise.all([
      getProgramAdmission(firstProgram, { expectedReleaseKey: RELEASE_KEY }),
      getProgramAdmission(secondProgram, { expectedReleaseKey: RELEASE_KEY }),
    ]);

    const requirementRequests = requests.filter(({ url }) => url.pathname === "/api/v1/requirements");
    expect(requirementRequests).toHaveLength(1);
    expect(requirementRequests[0]?.url.searchParams.get("campaign_key")).toBe("campaign:2026");
    expect(requirementRequests[0]?.url.searchParams.get("direction_key")).toBe("direction:09.03.01");
  });

  it("keeps requirement reads separate across academic directions", async () => {
    const firstProgram = admissionProgram("program:09.03.01-01");
    const secondProgram = {
      ...admissionProgram("program:09.03.02-01"),
      direction_key: "direction:09.03.02",
      directionCode: "09.03.02",
    } as CatalogProgram;

    await Promise.all([
      getProgramAdmission(firstProgram, { expectedReleaseKey: RELEASE_KEY }),
      getProgramAdmission(secondProgram, { expectedReleaseKey: RELEASE_KEY }),
    ]);

    const directionKeys = requests
      .filter(({ url }) => url.pathname === "/api/v1/requirements")
      .map(({ url }) => url.searchParams.get("direction_key"))
      .sort();
    expect(directionKeys).toEqual(["direction:09.03.01", "direction:09.03.02"]);
  });
});

describe("admission request cancellation and in-flight sharing", () => {
  it("does not reuse cached admission data for a different expected academic release", async () => {
    await expect(getProgramAdmission(admissionProgram(), { expectedReleaseKey: RELEASE_KEY }))
      .resolves.toMatchObject({ releaseKey: RELEASE_KEY });

    await expect(getProgramAdmission(admissionProgram(), { expectedReleaseKey: "release:stale" }))
      .rejects.toMatchObject({
        name: "AcademicReleaseMismatchError",
      });

    expect(requests.filter(({ url }) => url.pathname === "/api/v1/campaigns")).toHaveLength(2);
  });

  it("keeps a shared request alive when one caller aborts and another remains", async () => {
    const campaignStarted = deferred<AbortSignal | null>();
    const campaignResponse = deferred<Response>();
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      requests.push({
        url,
        method: input instanceof Request ? input.method : init?.method ?? "GET",
      });
      if (url.pathname === "/api/v1/release") return jsonResponse({ release_key: RELEASE_KEY });
      if (url.pathname === "/api/v1/campaigns") {
        campaignStarted.resolve(requestSignal(input, init));
        return campaignResponse.promise;
      }
      return jsonResponse(page([]));
    });

    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = getProgramAdmission(admissionProgram(), { expectedReleaseKey: RELEASE_KEY, signal: firstController.signal });
    const second = getProgramAdmission(admissionProgram(), { expectedReleaseKey: RELEASE_KEY, signal: secondController.signal });
    const firstResult = expect(first).rejects.toBeInstanceOf(DOMException);

    const sharedCampaignSignal = await campaignStarted.promise;
    firstController.abort(new DOMException("First caller left.", "AbortError"));
    await firstResult;
    expect(sharedCampaignSignal?.aborted).toBe(false);

    campaignResponse.resolve(jsonResponse(page([
      { external_key: "campaign:2026", campaign_kind: "admission", year: 2026 },
    ])));
    await expect(second).resolves.toMatchObject({ releaseKey: RELEASE_KEY });
    expect(requests.filter(({ url }) => url.pathname === "/api/v1/campaigns")).toHaveLength(1);
  });

  it("aborts nested API reads only after every consumer leaves and allows a retry", async () => {
    const nestedStarted = deferred<void>();
    const nestedAborted = deferred<void>();
    const nestedSignals: AbortSignal[] = [];
    let nestedRequestCount = 0;
    let abortedCount = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      requests.push({
        url,
        method: input instanceof Request ? input.method : init?.method ?? "GET",
      });
      if (url.pathname === "/api/v1/release") return jsonResponse({ release_key: RELEASE_KEY });
      if (url.pathname === "/api/v1/campaigns") {
        return jsonResponse(page([
          { external_key: "campaign:2026", campaign_kind: "admission", year: 2026 },
        ]));
      }
      if (url.pathname.startsWith("/api/v1/campaigns/") || [
        "/api/v1/place-quotas",
        "/api/v1/requirements",
        "/api/v1/competition-pools",
        "/api/v1/statistics",
        "/api/v1/tuition",
      ].includes(url.pathname)) {
        const signal = requestSignal(input, init);
        if (!signal) throw new Error("The nested admission request did not receive an AbortSignal.");
        nestedSignals.push(signal);
        nestedRequestCount += 1;
        if (nestedRequestCount === 8) nestedStarted.resolve();
        return new Promise<Response>((_resolve, reject) => {
          const abort = () => {
            abortedCount += 1;
            if (abortedCount === 8) nestedAborted.resolve();
            reject(signal.reason ?? new DOMException("Nested request aborted.", "AbortError"));
          };
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        });
      }
      return jsonResponse(page([]));
    });

    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = getProgramAdmission(admissionProgram(), { expectedReleaseKey: RELEASE_KEY, signal: firstController.signal });
    const second = getProgramAdmission(admissionProgram(), { expectedReleaseKey: RELEASE_KEY, signal: secondController.signal });
    await nestedStarted.promise;

    firstController.abort(new DOMException("First caller left.", "AbortError"));
    expect(nestedSignals.every((signal) => !signal.aborted)).toBe(true);
    secondController.abort(new DOMException("Last caller left.", "AbortError"));
    await expect(first).rejects.toBeInstanceOf(DOMException);
    await expect(second).rejects.toBeInstanceOf(DOMException);
    await nestedAborted.promise;
    expect(nestedSignals).toHaveLength(8);
    expect(nestedSignals.every((signal) => signal.aborted)).toBe(true);

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      requests.push({
        url,
        method: input instanceof Request ? input.method : init?.method ?? "GET",
      });
      if (url.pathname === "/api/v1/release") return jsonResponse({ release_key: RELEASE_KEY });
      if (url.pathname === "/api/v1/campaigns") {
        return jsonResponse(page([
          { external_key: "campaign:2026", campaign_kind: "admission", year: 2026 },
        ]));
      }
      return jsonResponse(page([]));
    });

    await expect(getProgramAdmission(admissionProgram(), { expectedReleaseKey: RELEASE_KEY }))
      .resolves.toMatchObject({ releaseKey: RELEASE_KEY });
    expect(requests.filter(({ url }) => url.pathname.endsWith("/offerings"))).toHaveLength(2);
  });

  it("retries after a rejected request instead of caching the failure", async () => {
    let failedCampaignRequest = false;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      requests.push({
        url,
        method: input instanceof Request ? input.method : init?.method ?? "GET",
      });
      if (url.pathname === "/api/v1/release") return jsonResponse({ release_key: RELEASE_KEY });
      if (url.pathname === "/api/v1/campaigns" && !failedCampaignRequest) {
        failedCampaignRequest = true;
        return new Response(JSON.stringify({ error: { code: "temporary_failure", message: "Temporary failure." } }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.pathname === "/api/v1/campaigns") {
        return jsonResponse(page([
          { external_key: "campaign:2026", campaign_kind: "admission", year: 2026 },
        ]));
      }
      return jsonResponse(page([]));
    });

    await expect(getProgramAdmission(admissionProgram(), { expectedReleaseKey: RELEASE_KEY })).rejects.toMatchObject({
      name: "AcademicApiError",
      status: 503,
      code: "temporary_failure",
    });
    await expect(getProgramAdmission(admissionProgram(), { expectedReleaseKey: RELEASE_KEY }))
      .resolves.toMatchObject({ releaseKey: RELEASE_KEY });
    expect(requests.filter(({ url }) => url.pathname === "/api/v1/campaigns")).toHaveLength(2);
  });
});
