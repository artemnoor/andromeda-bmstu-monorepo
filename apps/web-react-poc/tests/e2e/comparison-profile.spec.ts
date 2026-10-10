import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { discoverLiveCurriculumPrograms } from "./fixtures";

test("production profiling build records comparison React commits and Chromium trace", async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/programs");

  const programs = await discoverLiveCurriculumPrograms(page, 2);
  const [first, second] = programs;
  if (!first || !second) throw new Error("The isolated academic release must provide two verified curriculum programs.");
  expect(first.releaseKey).toBe(second.releaseKey);

  await page.evaluate((keys) => {
    localStorage.setItem("andromeda.compare.v1", JSON.stringify(keys));
  }, [first.externalKey, second.externalKey]);

  const tracePath = testInfo.outputPath("comparison-chromium-trace.json");
  let traceStarted = false;
  try {
    await browser.startTracing(page, {
      path: tracePath,
      screenshots: false,
      categories: ["devtools.timeline", "blink.user_timing", "loading", "v8"],
    });
    traceStarted = true;

    const response = await page.goto("/compare", { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await expect(page.locator("[data-qa=active-release-key]")).toHaveText(first.releaseKey);
    await expect(page.getByRole("button", { name: `Убрать программу ${first.code} из сравнения` })).toBeVisible();
    await expect(page.getByRole("button", { name: `Убрать программу ${second.code} из сравнения` })).toBeVisible();

    const samples = await page.evaluate(() => window.__andromedaReactProfileSamples ?? []);
    const profile = JSON.stringify({ releaseKey: first.releaseKey, samples }, null, 2);
    const profilePath = testInfo.outputPath("comparison-react-profiler-samples.json");
    await writeFile(profilePath, profile, "utf8");
    await testInfo.attach("comparison-react-profiler-samples", {
      path: profilePath,
      contentType: "application/json",
    });
    expect(samples.length, "the profiling renderer should report at least one React commit").toBeGreaterThan(0);
    expect(samples.every((sample) => sample.id === "comparison")).toBe(true);
    expect(samples.some((sample) => sample.phase === "mount")).toBe(true);
    expect(samples.some((sample) => sample.phase === "update"), "the loaded comparison should commit an update").toBe(true);
    for (const sample of samples) {
      const metrics = {
        actualDuration: sample.actualDuration,
        baseDuration: sample.baseDuration,
        startTime: sample.startTime,
        commitTime: sample.commitTime,
      };
      for (const [metric, value] of Object.entries(metrics)) {
        expect(Number.isFinite(value), `${metric} should be finite`).toBe(true);
        expect(value, `${metric} should be nonnegative`).toBeGreaterThanOrEqual(0);
      }
    }
  } finally {
    if (traceStarted) {
      const trace = await browser.stopTracing();
      await testInfo.attach("comparison-chromium-performance-trace", {
        body: trace,
        contentType: "application/json",
      });
    }
  }
});
