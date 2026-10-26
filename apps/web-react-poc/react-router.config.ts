import type { Config } from "@react-router/dev/config";
import { programPath } from "./src/features/catalog/program-path";

export default {
  appDirectory: "app",
  buildDirectory: process.env.ANDROMEDA_REACT_PROFILE_BUILD === "1" ? "build-profile" : "build",
  ssr: false,
  async prerender() {
    const origin = process.env.SEO_API_ORIGIN ?? "https://andromedabmstu.ru";
    const paths = ["/", "/programs", "/discover", "/compare", "/feedback", "/404"];
    let cursor: string | null = null;
    let release: string | null = null;
    const cursors = new Set<string>();
    do {
      const url = new URL("/api/v1/programs", origin);
      url.searchParams.set("limit", "100");
      if (cursor) url.searchParams.set("cursor", cursor);
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`Cannot enumerate program pages: HTTP ${response.status}`);
      const data = await response.json() as { items: { code: string; external_key: string }[]; page: { next_cursor: string | null; release_key: string } };
      if (release && release !== data.page.release_key) throw new Error("Academic release changed during page enumeration");
      release = data.page.release_key;
      paths.push(...data.items.map(programPath));
      cursor = data.page.next_cursor;
      if (cursor && cursors.has(cursor)) throw new Error("Repeated program cursor");
      if (cursor) cursors.add(cursor);
    } while (cursor);
    if (new Set(paths).size !== paths.length) throw new Error("Program page URL collision");
    return paths;
  },
} satisfies Config;
