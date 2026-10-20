import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const output = resolve("output/playwright/prof-test-usability");
const baseURL = process.env.PROF_TEST_BASE_URL ?? "http://127.0.0.1:4180";
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
const page = await context.newPage();
const programs = new Map();
const reads = [];
const errors = [];
const releaseKeys = new Set();
page.on("pageerror", (error) => errors.push(error.message));
page.on("response", (response) => {
  if (new URL(response.url()).pathname !== "/api/v1/programs" || !response.ok()) return;
  reads.push(response.json().then((body) => {
    releaseKeys.add(body.page.release_key);
    for (const program of body.items) programs.set(program.external_key, program);
  }));
});
const widths = [320, 390, 768, 1024, 1440, 1864];
const checks = [];
const accessibility = [];
async function checkWidths(phase) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    if (dimensions.content > dimensions.width) {
      console.log(await page.evaluate(() => [...document.querySelectorAll("main *")].map((element) => ({ tag: element.tagName, className: element.className, right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width, text: element.textContent?.slice(0, 90) })).filter((element) => element.right > innerWidth).slice(-12)));
      await page.screenshot({ path: resolve(output, `overflow-${phase}-${width}.png`), fullPage: true });
    }
    expect(dimensions.content, `${phase}: ${width}px`).toBeLessThanOrEqual(dimensions.width);
    checks.push({ phase, width, ...dimensions });
  }
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(result.violations, JSON.stringify(result.violations, null, 2)).toEqual([]);
  accessibility.push({ phase, violations: result.violations.length });
}
try {
  await page.goto(new URL("/discover", baseURL).href, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Что тебе интересно изучать?" })).toBeVisible({ timeout: 90_000 });
  await Promise.all(reads);
  await page.screenshot({ path: resolve(output, "questions-desktop.png") });
  await checkWidths("interests");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(output, "questions-phone.png") });
  await page.getByRole("button", { name: /^Программировать/ }).click();
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();
  await checkWidths("activity");
  await page.getByRole("button", { name: /Не уверен — пропустить/ }).click();
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();
  await checkWidths("avoid");
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();
  await checkWidths("pair");
  for (let index = 0; index < 4; index += 1) {
    if (await page.getByRole("heading", { name: "Твои подходящие программы" }).isVisible()) break;
    await page.getByRole("button", { name: "Одинаково", exact: true }).click();
    await page.getByRole("button", { name: /^(Продолжить|Показать результат)$/ }).click();
  }
  await expect(page.getByRole("heading", { name: "Твои подходящие программы" })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: resolve(output, "results-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(output, "results-phone.png") });
  await checkWidths("results");
  const all = page.locator('section[aria-labelledby="all-results-title"]');
  const search = all.getByRole("searchbox");
  await page.getByRole("link", { name: "Все программы и поиск ↓" }).click();
  await expect(search).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await search.scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, "all-programs-phone.png") });
  for (const program of programs.values()) {
    await search.fill(program.code);
    await expect(all.locator(`a[href="/programs?code=${encodeURIComponent(program.code)}"]`).first()).toBeVisible();
  }
  await search.fill("");
  while (await all.getByRole("button", { name: /Показать ещё/ }).count()) {
    await all.getByRole("button", { name: /Показать ещё/ }).click();
  }
  const rankedCount = await all.getByRole("list", { name: "Все программы с учебными планами" }).getByRole("listitem").count();
  await all.locator("summary").click();
  const unavailableCount = await all.getByRole("list", { name: "Программы без оценки" }).getByRole("listitem").count();
  expect(rankedCount + unavailableCount).toBe(programs.size);
  expect(releaseKeys.size).toBe(1);
  expect(errors).toEqual([]);
  const result = { date: new Date().toISOString(), liveURL: page.url(), catalogCount: programs.size, rankedCount, unavailableCount, searchedEveryCatalogCode: true, checks, accessibility, releaseKeys: [...releaseKeys], errors };
  await writeFile(resolve(output, "live-validation.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ catalog: programs.size, rankedCount, unavailableCount, checkedViewportPhases: checks.length, errors }));
} finally {
  await browser.close();
}
