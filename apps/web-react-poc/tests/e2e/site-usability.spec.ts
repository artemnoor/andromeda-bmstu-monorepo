import type { Page } from "@playwright/test";
import { clearPocStorage, expect, expectNoPageErrors, test } from "./fixtures";

const RELEASE_KEY = "release:site-usability";
const program = {
  external_key: "program:site-usability",
  code: "09.03.01-01",
  name: "Информатика и вычислительная техника",
  direction_key: "direction:site-usability",
  campus_status: "not_stated",
  department_relations: [],
  sources: [],
};

async function installCatalog(page: Page, options: {
  readonly beforePrograms?: () => Promise<void>;
  readonly failFirstPrograms?: boolean;
} = {}) {
  let failNext = options.failFirstPrograms ?? false;
  await page.route("**/api/v1/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/v1/release") {
      await route.fulfill({ json: { release_key: RELEASE_KEY } });
      return;
    }
    if (pathname === "/api/v1/programs") {
      await options.beforePrograms?.();
      if (failNext) {
        failNext = false;
        await route.fulfill({ status: 503, json: { detail: "Temporary catalog outage" } });
        return;
      }
    }
    const items = pathname === "/api/v1/programs" ? [program]
      : pathname === "/api/v1/directions" ? [{ external_key: program.direction_key, code: "09.03.01", name: program.name }]
        : [];
    await route.fulfill({ json: {
      items,
      page: { release_key: RELEASE_KEY, next_cursor: null, total_count: items.length, limit: 100 },
    } });
  });
}

test.beforeEach(async ({ page }) => clearPocStorage(page));

test("decorative grain stays bounded and cannot intercept navigation", async ({ page }) => {
  await page.goto("/");
  const grain = page.locator('body > div[aria-hidden="true"]');
  await expect(grain).toHaveCount(1);
  const layer = await grain.evaluate((element) => {
    const style = getComputedStyle(element, "::after");
    return { width: parseFloat(style.width), height: parseFloat(style.height),
      viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      pointerEvents: getComputedStyle(element).pointerEvents,
      texture: style.backgroundImage };
  });
  expect(layer.width / layer.viewportWidth).toBeLessThanOrEqual(1.25);
  expect(layer.height / layer.viewportHeight).toBeLessThanOrEqual(1.25);
  expect(layer.pointerEvents).toBe("none");
  expect(layer.texture).toContain("paper-noise.svg");
  const textureSize = await page.evaluate(async () => {
    const image = new Image();
    image.src = "/assets/paper-noise.svg";
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  });
  expect(textureSize).toEqual({ width: 180, height: 180 });
  await page.getByRole("button", { name: "Открыть меню" }).click();
  await expect(page.getByRole("dialog", { name: "Основная навигация" })).toBeVisible();
});

test("keyboard skip link and route focus work without taking focus away from catalog search", async ({ page, diagnostics }) => {
  await installCatalog(page);
  await page.goto("/");
  const skip = page.getByRole("link", { name: "К содержимому", exact: true });
  await expect(skip).toHaveAttribute("href", "#main-content");
  await skip.focus();
  await skip.press("Enter");
  await expect(page.locator("main")).toBeFocused();

  await page.getByRole("link", { name: "Открыть каталог программ" }).first().click();
  await expect(page.getByRole("heading", { name: "Каталог программ", exact: true })).toBeVisible();
  await expect(page.locator("main")).toBeFocused();
  const search = page.getByRole("combobox", { name: /Поиск по каталогу/ });
  await search.fill("Информатика");
  await expect(page).toHaveURL(/q=/);
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("Информатика");
  await expect(page.getByRole("article")).toHaveCount(1);
  expectNoPageErrors(diagnostics);
});

test("pending route navigation is announced and completes with the destination focused", async ({ page, diagnostics }) => {
  let releasePrograms!: () => void;
  let announcePrograms!: () => void;
  const gate = new Promise<void>((resolve) => { releasePrograms = resolve; });
  const started = new Promise<void>((resolve) => { announcePrograms = resolve; });
  await installCatalog(page, { beforePrograms: async () => { announcePrograms(); await gate; } });
  await page.goto("/");
  const navigation = page.getByRole("link", { name: "Открыть каталог программ" }).first().click();
  try {
    await started;
    await expect(page.getByRole("status").filter({ hasText: "Открываем страницу…" })).toBeVisible();
  } finally {
    releasePrograms();
  }
  await navigation;
  await expect(page.getByRole("heading", { name: "Каталог программ", exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Открываем страницу…" })).toHaveCount(0);
  await expect(page.locator("main")).toBeFocused();
  expectNoPageErrors(diagnostics);
});

test("catalog errors preserve navigation and a real retry restores the program list", async ({ page }) => {
  await installCatalog(page, { failFirstPrograms: true });
  await page.goto("/programs");
  await expect(page.getByRole("heading", { name: "Каталог временно недоступен" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Открыть меню" })).toBeVisible();
  await expect(page.getByRole("link", { name: "На главную", exact: true })).toHaveAttribute("href", "/");
  await page.getByRole("button", { name: "Повторить загрузку", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Каталог программ", exact: true })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Каталог временно недоступен" })).toHaveCount(0);
});

test("unknown routes provide a working route back to the catalog", async ({ page }) => {
  await installCatalog(page);
  await page.goto("/this-route-does-not-exist");
  await expect(page.getByRole("heading", { name: "Страница не найдена" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Открыть меню" })).toBeVisible();
  await page.getByRole("link", { name: "Каталог программ", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Каталог программ", exact: true })).toBeVisible();
});

test("home no longer contains the removed admission section", async ({ page }) => {
  await installCatalog(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Смотри на условия вместе с их контекстом" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Открыть каталог программ" })).toHaveAttribute("href", "/programs");
});

test("home, catalog, and comparison keep their content and navigation within six viewport widths", async ({ page, diagnostics }) => {
  test.setTimeout(60_000);
  await installCatalog(page);
  for (const width of [320, 390, 768, 1024, 1440, 1864]) {
    await page.setViewportSize({ width, height: 900 });
    for (const pathname of ["/", "/programs", "/compare"]) {
      await page.goto(pathname);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const dimensions = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
      }));
      expect(dimensions.document, `${pathname} overflows at ${width}px`).toBeLessThanOrEqual(dimensions.viewport);
      await page.getByRole("button", { name: "Открыть меню" }).click();
      const menu = page.getByRole("dialog", { name: "Основная навигация" });
      const lastLink = menu.getByRole("link", { name: "Каталог программ", exact: true });
      await expect(lastLink).toBeVisible();
      await lastLink.focus();
      await expect(lastLink).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Открыть меню" })).toBeFocused();
      await expect(page.locator("main")).not.toHaveAttribute("inert", "");
    }
  }
  expectNoPageErrors(diagnostics);
});
