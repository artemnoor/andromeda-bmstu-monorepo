import { expect, test } from "./support.js";

test("home and first-screen match screenshots captured from the original frontend", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Original pixel baselines were captured in Chromium.");
  await page.emulateMedia({ reducedMotion: "reduce" });

  for (const baseline of [
    { path: "index.html", width: 1440, height: 900, name: "index-1440x900.png", tolerance: 1200 },
    { path: "index.html", width: 390, height: 844, name: "index-390x844.png", tolerance: 1200 },
    { path: "first-screen.html", width: 1440, height: 900, name: "first-screen-1440x900.png", tolerance: 100 },
    { path: "first-screen.html", width: 390, height: 844, name: "first-screen-390x844.png", tolerance: 100 },
  ]) {
    await page.setViewportSize({ width: baseline.width, height: baseline.height });
    const response = await page.goto(baseline.path);
    expect(response?.status()).toBe(200);
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(baseline.name, {
      animations: "disabled",
      caret: "hide",
      maxDiffPixels: baseline.tolerance,
    });
  }
});
