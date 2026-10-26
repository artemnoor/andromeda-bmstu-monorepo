type AnalyticsProperties = Record<string, string | number | boolean | readonly string[]>;

const VISITOR_KEY = "andromeda.analytics.visitor.v1";
const campaignKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
let memoryVisitor: string | undefined;

export function analyticsEnabled(): boolean {
  if (typeof window === "undefined" || !import.meta.env.VITE_ANALYTICS_SITE_ID?.trim()) return false;
  if (import.meta.env.DEV && import.meta.env.VITE_ANALYTICS_DEBUG !== "true") return false;
  try { if (localStorage.getItem("andromeda.analytics.disabled") === "true") return false; } catch { /* Storage can be disabled. */ }
  return true;
}

function visitorId(): string {
  try {
    const stored = localStorage.getItem(VISITOR_KEY);
    if (stored && /^[a-zA-Z0-9_-]{16,80}$/.test(stored)) return stored;
  } catch { /* Use an in-memory identity when storage is blocked. */ }
  memoryVisitor ??= window.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  try { localStorage.setItem(VISITOR_KEY, memoryVisitor); } catch { /* The page remains usable. */ }
  return memoryVisitor;
}

/** Preserve campaign attribution without sending shared reports, searches, or answers. */
export function analyticsQuery(search: string): string {
  const source = new URLSearchParams(search);
  const safe = new URLSearchParams();
  for (const key of campaignKeys) {
    const value = source.get(key)?.trim().slice(0, 120);
    if (value) safe.set(key, value);
  }
  return safe.toString();
}

export function analyticsPageType(pathname: string): string {
  if (pathname === "/") return "home";
  if (pathname === "/programs") return "catalog";
  if (pathname.startsWith("/programs/")) return "program";
  if (pathname === "/compare") return "comparison";
  if (pathname === "/discover") return "prof_test";
  if (pathname === "/feedback") return "feedback";
  return "other";
}

export function cleanAnalyticsUrl(value: string): string {
  try { const url = new URL(value); return url.origin + url.pathname; }
  catch { return ""; }
}

type EventType = "pageview" | "custom_event" | "outbound" | "error" | "performance";

function send(type: EventType, event: string, properties: AnalyticsProperties, pathname = window.location.pathname, metrics: Record<string, number> = {}): void {
  if (!analyticsEnabled()) return;
  try {
    const payload = {
      site_id: import.meta.env.VITE_ANALYTICS_SITE_ID!.trim(),
      anonymous_id: visitorId(),
      hostname: window.location.hostname,
      pathname,
      querystring: analyticsQuery(window.location.search),
      referrer: cleanAnalyticsUrl(document.referrer),
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      language: window.navigator.language,
      page_title: document.title,
      type,
      event_name: event,
      properties: JSON.stringify({ ...properties, app: "andromeda", path: pathname, page_type: analyticsPageType(pathname) }),
      ...metrics,
    };
    void fetch("/insights/track", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload), keepalive: true, credentials: "omit",
    }).catch(() => { /* Analytics failure must not interrupt the application. */ });
  } catch { /* Blocked browser APIs do not affect the site. */ }
}

/** Explicit product events, sent only to the collector on our VM. */
export function trackEvent(event: string, properties: AnalyticsProperties = {}, pathname?: string): void {
  if (!analyticsEnabled()) return;
  send(event === "$pageview" ? "pageview" : "custom_event", event === "$pageview" ? "" : event, properties, pathname);
}

export function trackOutbound(url: string): void {
  if (!analyticsEnabled()) return;
  send("outbound", "", { url: cleanAnalyticsUrl(url) });
}

export function trackClientError(name: string, file = "", line = 0, column = 0): void {
  if (!analyticsEnabled()) return;
  // Arbitrary error messages/stacks can contain input or shared report payloads.
  send("error", name.slice(0, 80), { message: "Unhandled application error", fileName: cleanAnalyticsUrl(file), lineNumber: line, columnNumber: column });
}

export function trackPerformance(metrics: Record<string, number>, pathname: string): void {
  if (!analyticsEnabled()) return;
  send("performance", "", {}, pathname, metrics);
}
