import { analyticsEnabled, cleanAnalyticsUrl, trackClientError, trackEvent, trackOutbound, trackPerformance } from "./analytics";

let vitalsStarted = false;

export function observeClientQuality(): () => void {
  if (!analyticsEnabled()) return () => {};
  const seenErrors = new Set<string>();
  const report = (name: string, file = "", line = 0, column = 0) => {
    const signature = `${name}:${cleanAnalyticsUrl(file)}:${line}`;
    if (seenErrors.has(signature) || seenErrors.size >= 15) return;
    seenErrors.add(signature);
    trackClientError(name, file, line, column);
  };
  const onError = (event: ErrorEvent) => report(event.error instanceof Error ? event.error.name : "Error", event.filename, event.lineno, event.colno);
  const onRejection = (event: PromiseRejectionEvent) => report(event.reason instanceof Error ? event.reason.name : "UnhandledRejection");
  const onClick = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>("a[href]");
    if (!link) return;
    try {
      const url = new URL(link.href);
      if (!/^https?:$/.test(url.protocol)) return;
      if (url.origin !== location.origin) trackOutbound(url.href);
      else if (url.pathname !== location.pathname) trackEvent(url.pathname.startsWith("/programs/") ? "program_card_opened" : "navigation_clicked", { destination: url.pathname });
    } catch { /* Invalid links are ignored. */ }
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  document.addEventListener("click", onClick, { capture: true });

  if (!vitalsStarted) {
    vitalsStarted = true;
    const pathname = location.pathname;
    const metrics: Record<string, number> = {};
    void import("web-vitals").then(({ onCLS, onFCP, onINP, onLCP, onTTFB }) => {
      let sent = false;
      const reportMetric = (metric: { name: string; value: number }) => {
        if (!Number.isFinite(metric.value) || metric.value < 0) return;
        const key = metric.name.toLowerCase();
        // Native Rybbit performance events use milliseconds and unitless CLS.
        metrics[key] = metric.value;
      };
      onCLS(reportMetric);
      onFCP(reportMetric);
      onINP(reportMetric);
      onLCP(reportMetric);
      onTTFB(reportMetric);
      const flush = () => {
        if (sent || !Object.keys(metrics).length) return;
        sent = true;
        trackPerformance({ ...metrics }, pathname);
        clearTimeout(timer);
        document.removeEventListener("visibilitychange", onHidden);
        window.removeEventListener("pagehide", onPageHide);
      };
      const onHidden = () => { if (document.visibilityState === "hidden") queueMicrotask(flush); };
      const onPageHide = () => queueMicrotask(flush);
      const timer = setTimeout(flush, 20000);
      document.addEventListener("visibilitychange", onHidden);
      window.addEventListener("pagehide", onPageHide);
    }).catch(() => { /* Performance collection must not affect navigation. */ });
  }
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    document.removeEventListener("click", onClick, { capture: true });
  };
}

/** Visible time and scroll are measured once per page, without a heartbeat stream. */
export function observePageEngagement(pathname: string): () => void {
  if (!analyticsEnabled()) return () => {};
  let visibleSince: number | null = document.visibilityState === "visible" ? performance.now() : null;
  let visibleMs = 0;
  let reportedMs = 0;
  let deepest = 0;
  let engaged = false;
  const thresholds = new Set<number>();
  let scrollFrame = 0;
  const elapsed = () => visibleMs + (visibleSince === null ? 0 : performance.now() - visibleSince);
  const flush = () => {
    const total = elapsed();
    if (total - reportedMs < 1000) return;
    trackEvent("page_engagement", { visible_seconds: Math.round((total - reportedMs) / 1000), scroll_percent: deepest }, pathname);
    reportedMs = total;
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      visibleMs = elapsed();
      visibleSince = null;
      flush();
    } else if (visibleSince === null) visibleSince = performance.now();
  };
  const onScroll = () => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      const distance = document.documentElement.scrollHeight - innerHeight;
      const depth = distance > 0 ? Math.min(100, Math.round(scrollY / distance * 100)) : 0;
      deepest = Math.max(deepest, depth);
      for (const percent of [25, 50, 75, 90]) {
        if (depth >= percent && !thresholds.has(percent)) {
          thresholds.add(percent);
          trackEvent("scroll_depth", { percent }, pathname);
        }
      }
    });
  };
  const timer = window.setInterval(() => {
    if (!engaged && document.visibilityState === "visible" && elapsed() >= 15000) {
      engaged = true;
      trackEvent("page_engaged", { threshold_seconds: 15 }, pathname);
    }
  }, 5000);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", flush);
  window.addEventListener("scroll", onScroll, { passive: true });
  return () => {
    flush();
    clearInterval(timer);
    cancelAnimationFrame(scrollFrame);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", flush);
    window.removeEventListener("scroll", onScroll);
  };
}
