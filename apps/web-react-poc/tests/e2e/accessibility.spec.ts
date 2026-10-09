import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import {
  clearPocStorage,
  discoverLiveCurriculumProgram,
  expect,
  test,
} from "./fixtures";

test.beforeEach(async ({ page }) => clearPocStorage(page));

async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test("home page meets WCAG 2.1 AA automated checks", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectAccessible(page);
});

test("live program catalog meets WCAG 2.1 AA automated checks", async ({ page }) => {
  await page.goto("/programs");
  await expect(page.getByRole("heading", { level: 1, name: "Каталог программ" })).toBeVisible();
  await expect(page.getByRole("article").first()).toBeVisible();
  await expectAccessible(page);
});

test("empty comparison page meets WCAG 2.1 AA automated checks", async ({ page }) => {
  await page.goto("/compare");
  await expect(page.getByRole("heading", { name: "Добавь программы для сравнения" })).toBeVisible();
  await expectAccessible(page);
});

test("open navigation menu meets WCAG 2.1 AA automated checks", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Открыть меню" }).click();
  await expect(page.getByRole("dialog", { name: "Основная навигация" })).toBeVisible();
  await expectAccessible(page);
});

test("expanded live admission details and favorite action meet WCAG 2.1 AA checks", async ({ page }) => {
  await page.goto("/programs");
  const card = page.getByRole("article").first();
  await card.locator("summary").click();
  await expect(card.getByRole("heading", { name: /Места и условия поступления/ })).toBeVisible();
  await expect(card.getByRole("button", { name: /Добавить в избранное/ })).toBeVisible();
  await expectAccessible(page);
});

test("populated comparison meets WCAG 2.1 AA automated checks", async ({ page }) => {
  await page.goto("/programs");
  const program = await discoverLiveCurriculumProgram(page);
  const card = page.getByRole("article").filter({ hasText: program.code }).first();
  await card.getByRole("button", { name: /Сравнить/ }).click();
  await page.getByRole("link", { name: /Открыть сравнение/ }).click();
  await expect(page.getByRole("heading", { name: "Куда уходит учебное время" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Места и проходные баллы" })).toBeVisible();
  await expectAccessible(page);
});
