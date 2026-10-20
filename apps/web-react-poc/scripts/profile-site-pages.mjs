import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const { values } = parseArgs({ options: {
  "base-url": { type: "string", default: "http://127.0.0.1:4181" },
  repeats: { type: "string", default: "3" },
  paths: { type: "string", default: "/,/programs,/compare,/discover" },
  encodings: { type: "string", default: "gzip" },
  output: { type: "string", default: "test-results/site-performance.json" },
} });
const base = new URL(values["base-url"]);
const repeats = Number(values.repeats);
const encodings = values.encodings.split(",");
const paths = values.paths.split(",");
if (!["http:", "https:"].includes(base.protocol) || !Number.isInteger(repeats) || repeats < 1 || repeats > 10
  || paths.some((path) => !["/", "/programs", "/compare", "/discover"].includes(path))
  || encodings.some((encoding) => !["identity", "gzip"].includes(encoding))) throw new Error("Invalid profiling arguments");
// Exact, stable identities used by the 2026-10-20 investigation; no fuzzy joins.
const programKeys = [
  "program:bmstu:01.03.02:ИУ9:01.03.02-01:source:1-1",
  "program:bmstu:01.03.03:ФН3:01.03.03-02:source:1-1",
  "program:bmstu:01.03.04:ФН1:01.03.04-03:source:1-1",
];
async function json(path) {
  const response = await fetch(new URL(path, base));
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${path}`);
  return response.json();
}
const release = await json("/api/v1/release");
const catalog = await json("/api/v1/programs?limit=1");
if (catalog.page.release_key !== release.release_key || !Number.isInteger(catalog.page.total_count)) throw new Error("Unverified catalog identity/count");
const browser = await chromium.launch({ headless: true });
const results = { capturedAt: new Date().toISOString(), baseURL: base.href, browser: browser.version(),
  viewport: { width: 1440, height: 900 }, cache: "fresh browser context per sample", apiCache: "warm; not flushed",
  releaseKey: release.release_key, programKeys, repeats, complete: false, samples: [] };
try {
  for (let iteration = 0; iteration < repeats; iteration += 1) {
    // Alternate compression order to reduce a fixed-order bias in A/B runs.
    const modes = iteration % 2 ? [...encodings].reverse() : encodings;
    for (const encoding of modes) for (const path of paths) {
      const context = await browser.newContext({ viewport: results.viewport, extraHTTPHeaders: { "Accept-Encoding": encoding } });
      try {
        await context.addInitScript((keys) => {
          localStorage.setItem("andromeda.compare.v1", JSON.stringify(keys));
          window.__andromedaQaComparisonProfiling = true;
          window.__siteProfile = { longTasks: [], cls: 0 };
          new PerformanceObserver((list) => window.__siteProfile.longTasks.push(...list.getEntries().map((e) => ({ start: e.startTime, duration: e.duration })))).observe({ type: "longtask", buffered: true });
          new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__siteProfile.cls += e.value; }).observe({ type: "layout-shift", buffered: true });
        }, programKeys);
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(new URL(path, base).href, { waitUntil: "domcontentloaded" });
        let firstContentMs = null;
        if (path === "/programs") {
          await page.locator("article[data-program-key]").first().waitFor();
          firstContentMs = await page.evaluate(() => performance.now());
          // Keep the old completeness criterion: ALL 152 cards, not the first batch.
          await page.locator("article[data-program-key]").nth(catalog.page.total_count - 1).waitFor({ timeout: 45_000 });
        } else if (path === "/compare") {
          await page.locator("[data-qa=active-release-key]").waitFor({ timeout: 45_000 });
          if (await page.locator("[data-qa=active-release-key]").textContent() !== release.release_key) throw new Error("Comparison changed releases");
          if (await page.locator("[data-qa=admission-summary]").getAttribute("data-unavailable-count") !== "0") throw new Error("Admission data is incomplete");
        } else if (path === "/discover") await page.locator("[class*=stepCount]").first().waitFor({ timeout: 45_000 });
        else { await page.locator("h1").waitFor(); await page.locator("picture img").evaluate((image) => image.decode()); }
        const readyMs = await page.evaluate(() => performance.now());
        await page.waitForLoadState("networkidle", { timeout: 7000 }).catch(() => undefined);
        const metrics = await page.evaluate(() => {
          const resources = performance.getEntriesByType("resource");
          const api = resources.filter((r) => r.name.includes("/api/"));
          const js = resources.filter((r) => /\.js(?:\?|$)/.test(r.name));
          const sum = (items, key) => items.reduce((total, item) => total + item[key], 0);
          return { apiRequests: api.length, apiBytes: sum(api, "encodedBodySize"), jsBytes: sum(js, "encodedBodySize"),
            totalTransfer: sum(resources, "transferSize"), fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime,
            cls: window.__siteProfile.cls, longTasks: window.__siteProfile.longTasks, domNodes: document.querySelectorAll("*").length,
            stages: performance.getEntriesByType("measure").filter((m) => m.name.startsWith("andromeda:")).map((m) => ({ name: m.name, ms: m.duration })),
            navigation: performance.getEntriesByType("navigation").map((r) => r.toJSON()),
            resourceWaterfall: resources.map((r) => ({ path: new URL(r.name).pathname, start: r.startTime, ms: r.duration, dns: r.domainLookupEnd - r.domainLookupStart, connect: r.connectEnd - r.connectStart, ttfb: r.responseStart - r.requestStart, download: r.responseEnd - r.responseStart, bytes: r.encodedBodySize })),
            apiWaterfall: api.map((r) => ({ path: new URL(r.name).pathname, start: r.startTime, ms: r.duration, bytes: r.encodedBodySize })) };
        });
        const sample = { iteration, encoding, path, readyMs, firstContentMs, ...metrics, errors };
        results.samples.push(sample);
        console.log(JSON.stringify({ iteration, encoding, path, readyMs: Math.round(readyMs), firstContentMs, apiBytes: metrics.apiBytes, cls: metrics.cls }));
        if (errors.length) throw new Error(`Page errors: ${errors.join("; ")}`);
      } finally { await context.close(); }
    }
  }
  if ((await json("/api/v1/release")).release_key !== release.release_key) throw new Error("Active release changed during profiling");
  results.complete = true;
} finally {
  await browser.close();
  await mkdir(dirname(values.output), { recursive: true });
  await writeFile(values.output, JSON.stringify(results, null, 2) + "\n");
}
