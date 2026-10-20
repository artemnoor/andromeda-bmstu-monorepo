import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const [baseURL, output, repeats = "10"] = process.argv.slice(2);
if (!baseURL || !output) throw new Error("Usage: node scripts/benchmark-comparison-refresh.mjs BASE_URL OUTPUT [REPEATS]");
const keys = [
  "program:bmstu:01.03.02:ИУ9:01.03.02-01:source:1-1",
  "program:bmstu:01.03.03:ФН11:01.03.03-03:source:2-1",
  "program:bmstu:01.03.03:ФН3:01.03.03-02:source:1-1",
];
const browser = await chromium.launch();
const samples = [];
try {
  for (let run = -1; run < Number(repeats); run++) {
    // New browser context: cold browser cache, warm server after discarded run.
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.addInitScript((selection) => {
      localStorage.setItem("andromeda.compare.v1", JSON.stringify(selection));
      window.__andromedaQaComparisonProfiling = true;
      window.__comparisonBenchmarkTimes = {};
      new MutationObserver(() => {
        const times = window.__comparisonBenchmarkTimes;
        if (!times.firstUsefulMs && document.querySelector('[data-qa="admission-summary"]')) times.firstUsefulMs = performance.now();
        if (!times.readyMs && document.querySelector('[data-qa="active-release-note"]')) times.readyMs = performance.now();
      }).observe(document, { childList: true, subtree: true });
    }, keys);
    await page.goto(`${baseURL}/compare`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-qa="admission-summary"]').waitFor({ timeout: 60_000 });
    await page.locator('[data-qa="active-release-note"]').waitFor({ timeout: 60_000 });
    const facts = await page.evaluate(() => ({
      releaseKey: document.querySelector('[data-qa="active-release-key"]')?.textContent,
      admissionUnavailable: document.querySelector('[data-qa="admission-summary"]')?.getAttribute("data-unavailable-count"),
      programs: [...document.querySelectorAll('[data-qa="category-chart-card"]')].map((card) => ({
        key: card.getAttribute("data-program-key"), plan: card.getAttribute("data-plan-key"),
        items: Number(card.getAttribute("data-item-count")), hours: Number(card.getAttribute("data-total-hours")),
      })),
    }));
    if (facts.admissionUnavailable !== "0" || facts.programs.length !== keys.length || facts.programs.some((program, index) => program.key !== keys[index] || !program.plan || !program.items)) throw new Error(`Incomplete benchmark sample: ${JSON.stringify(facts)}`);
    if (samples[0] && samples[0].facts.releaseKey !== facts.releaseKey) throw new Error("Academic release changed across benchmark samples.");
    const cold = await page.evaluate(() => {
      const resources = performance.getEntriesByType("resource");
      const api = resources.filter((entry) => new URL(entry.name).pathname.startsWith("/api/"));
      return {
        ...window.__comparisonBenchmarkTimes,
        apiRequests: api.length,
        apiBytes: api.reduce((sum, entry) => sum + entry.encodedBodySize, 0),
        jsBytes: resources.filter((entry) => new URL(entry.name).pathname.endsWith(".js")).reduce((sum, entry) => sum + entry.encodedBodySize, 0),
        stages: performance.getEntriesByType("measure").map((entry) => ({ name: entry.name, duration: entry.duration })),
      };
    });
    await page.getByRole("link", { name: "Изменить выбор", exact: true }).click();
    await page.waitForURL("**/programs");
    await page.getByRole("button", { name: "Открыть меню", exact: true }).click();
    const beforeReturn = await page.evaluate(() => {
      window.__comparisonBenchmarkTimes = {};
      return { start: performance.now(), resources: performance.getEntriesByType("resource").length };
    });
    await page.getByRole("link", { name: /Сравнить программы/ }).click();
    await page.locator('[data-qa="active-release-note"]').waitFor({ timeout: 60_000 });
    const returning = await page.evaluate(({ start, resources }) => {
      const api = performance.getEntriesByType("resource").slice(resources).filter((entry) => new URL(entry.name).pathname.startsWith("/api/"));
      return { readyMs: window.__comparisonBenchmarkTimes.readyMs - start, apiRequests: api.length, apiBytes: api.reduce((sum, entry) => sum + entry.encodedBodySize, 0) };
    }, beforeReturn);
    if (run >= 0) samples.push({ run, facts, cold, returning });
    console.log(JSON.stringify({ run, coldReadyMs: Math.round(cold.readyMs), firstUsefulMs: Math.round(cold.firstUsefulMs), returnReadyMs: Math.round(returning.readyMs) }));
    await context.close();
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ baseURL, chromium: browser.version(), measuredAt: new Date().toISOString(), keys, conditions: "Production SPA; 1440x900; cold browser context per run; discarded server warmup; same-session return via catalog", samples }, null, 2));
} finally {
  await browser.close();
}
