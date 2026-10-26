import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { trackEvent } from "./analytics";
import { observeClientQuality, observePageEngagement } from "./client-observers";

export function RouteAnalytics() {
  const { pathname } = useLocation();
  const previous = useRef<string | null>(null);
  useEffect(() => observeClientQuality(), []);
  useEffect(() => observePageEngagement(pathname), [pathname]);
  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    const params = new URLSearchParams(window.location.search);
    trackEvent("$pageview", { shared_comparison: params.has("shared"), shared_result: params.has("result") });
  }, [pathname]);
  return null;
}
