import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyticsQuery, cleanAnalyticsUrl, trackEvent, trackPerformance } from "@/shared/analytics/analytics";

const send = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", send);
  vi.stubEnv("DEV", false);
  vi.stubEnv("VITE_ANALYTICS_SITE_ID", "1");
  vi.stubEnv("VITE_ANALYTICS_DEBUG", "false");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("self hosted analytics", () => {
  it("does not send without a site configured", () => {
    vi.stubEnv("VITE_ANALYTICS_SITE_ID", "");
    trackEvent("$pageview");
    expect(send).not.toHaveBeenCalled();
  });
  it("excludes local development unless explicitly enabled", () => {
    vi.stubEnv("DEV", true);
    trackEvent("$pageview");
    expect(send).not.toHaveBeenCalled();
    vi.stubEnv("VITE_ANALYTICS_DEBUG", "true");
    trackEvent("$pageview");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("sends a native pageview to the same origin without query strings", () => {
    history.replaceState(null, "", "/discover?result=private-answers#private");
    trackEvent("$pageview");
    const [url, options] = send.mock.calls[0]!;
    expect(url).toBe("/insights/track");
    expect(options).toMatchObject({ method: "POST", keepalive: true, credentials: "omit" });
    expect(JSON.parse(options.body)).toMatchObject({ type: "pageview", site_id: "1", pathname: "/discover", querystring: "" });
    expect(options.body).not.toContain("private");
  });
  it("sends custom events with explicit properties", () => {
    trackEvent("comparison_program_added", { program_count: 1 });
    const payload = JSON.parse(send.mock.calls[0]![1].body);
    expect(payload.type).toBe("custom_event");
    expect(payload.event_name).toBe("comparison_program_added");
    expect(JSON.parse(payload.properties)).toMatchObject({ program_count: 1, app: "andromeda" });
  });
  it("strips queries and fragments from referrers", () => {
    expect(cleanAnalyticsUrl("https://andromeda.test/discover?result=private#secret")).toBe("https://andromeda.test/discover");
    expect(cleanAnalyticsUrl("")).toBe("");
  });
  it("does not throw when collection is blocked", async () => {
    send.mockRejectedValueOnce(new Error("blocked"));
    expect(() => trackEvent("$pageview")).not.toThrow();
    await Promise.resolve();
    send.mockImplementationOnce(() => { throw new Error("blocked synchronously"); });
    expect(() => trackEvent("$pageview")).not.toThrow();
  });
  it("keeps only campaign attribution and excludes private shared results and searches", () => {
    expect(analyticsQuery("?utm_source=telegram&utm_medium=social&result=private-answers&q=private-search&shared=1"))
      .toBe("utm_source=telegram&utm_medium=social");
  });
  it("uses the same anonymous browser ID across pages without sending an IP or account ID", () => {
    trackEvent("$pageview");
    history.replaceState(null, "", "/compare");
    trackEvent("$pageview");
    const first = JSON.parse(send.mock.calls[0]![1].body);
    const second = JSON.parse(send.mock.calls[1]![1].body);
    expect(first.anonymous_id).toBeTruthy();
    expect(second.anonymous_id).toBe(first.anonymous_id);
    expect(first).not.toHaveProperty("ip_address");
    expect(first).not.toHaveProperty("user_id");
  });
  it("honors the browser opt-out", () => {
    localStorage.setItem("andromeda.analytics.disabled", "true");
    trackEvent("$pageview");
    expect(send).not.toHaveBeenCalled();
  });
  it("uses native performance events and keeps timing values in milliseconds", () => {
    trackPerformance({ lcp: 2500, cls: 0.05 }, "/programs");
    expect(JSON.parse(send.mock.calls[0]![1].body)).toMatchObject({ type: "performance", pathname: "/programs", lcp: 2500, cls: 0.05 });
  });
});
