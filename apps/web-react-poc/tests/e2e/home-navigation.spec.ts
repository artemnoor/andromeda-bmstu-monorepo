import { clearPocStorage, expect, expectNoPageErrors, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await clearPocStorage(page);
});

test("footer navigation retains the current page while loading and transitions without a top banner", async ({ page, diagnostics }) => {
  await page.addInitScript(() => {
    const original = document.startViewTransition?.bind(document);
    if (!original) return;
    document.startViewTransition = ((...args: Parameters<typeof document.startViewTransition>) => {
      document.documentElement.dataset.transitionObserved = "true";
      return original(...args);
    }) as typeof document.startViewTransition;
  });
  await page.goto("/");
  const footer = page.getByRole("contentinfo", { name: "Подвал сайта" });
  await expect(footer.getByRole("navigation", { name: "Разделы сайта" })).toBeVisible();
  await page.route("**/api/v1/programs?**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.continue();
  });
  await footer.getByRole("link", { name: "Каталог программ" }).click();
  await expect(footer).toBeVisible();
  await expect(page.getByText("Открываем страницу…", { exact: true })).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Каталог программ" })).toBeVisible();
  const supported = await page.evaluate(() => typeof document.startViewTransition === "function");
  if (supported) await expect(page.locator("html")).toHaveAttribute("data-transition-observed", "true");
  await expect(page.locator("html")).toHaveAttribute("data-navigation-motion", "full");
  await expect(page.locator("main")).toBeFocused();
  expectNoPageErrors(diagnostics);
});

test("footer fits mobile and reduced motion disables page transition animations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const footer = page.getByRole("contentinfo", { name: "Подвал сайта" });
  await footer.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const animation = await page.evaluate(() => getComputedStyle(document.documentElement, "::view-transition-new(root)").animationName);
  expect(animation).toBe("none");
  await footer.getByRole("link", { name: "Профориентационный тест" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/discover$/);
  await expect(page.locator("html")).toHaveAttribute("data-navigation-motion", "none");
});

test("home navigation opens the catalog from the original menu", async ({ page, diagnostics }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: /Выбери.*Спроектируй своё будущее/ })).toBeVisible();
  const menuButton = page.getByRole("button", { name: "Открыть меню" });
  await menuButton.click();
  await expect(page.getByRole("button", { name: "Закрыть меню" })).toHaveAttribute("aria-expanded", "true");

  const catalogLink = page.getByRole("dialog", { name: "Основная навигация" })
    .getByRole("link", { name: "Каталог программ", exact: true });
  // The original menu intentionally animates each link for over a second.
  // Keyboard activation tests the same navigation without racing its transform.
  await catalogLink.focus();
  await catalogLink.press("Enter");
  await expect(page).toHaveURL(/\/programs$/);
  await expect(page.getByRole("heading", { level: 1, name: "Каталог программ" })).toBeVisible();
  await expect(page.getByRole("article").first()).toBeVisible();
  expectNoPageErrors(diagnostics);
});

test("navigation menu traps keyboard focus and restores it after Escape", async ({ page }) => {
  await page.goto("/");
  const menuButton = page.getByRole("button", { name: "Открыть меню" });
  await menuButton.click();

  const menu = page.getByRole("dialog", { name: "Основная навигация" });
  const closeButton = menu.getByRole("button", { name: "Закрыть меню" });
  const firstLink = menu.getByRole("link", { name: "Главная" });
  const lastLink = menu.getByRole("link", { name: "Каталог программ" });
  await expect(lastLink).toBeVisible();
  await expect(closeButton).toBeVisible();
  await expect(firstLink).toBeFocused();
  await lastLink.focus();
  await page.keyboard.press("Tab");
  await expect(closeButton).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(lastLink).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Открыть меню" })).toBeFocused();
  await expect(page.getByRole("button", { name: "Открыть меню" })).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("main")).not.toHaveAttribute("inert", "");
});

test("shared catalog navigation keeps its close control inside the modal and restores focus", async ({ page }) => {
  await page.goto("/programs");
  await expect(page.getByRole("heading", { level: 1, name: "Каталог программ" })).toBeVisible();
  await page.getByRole("button", { name: "Открыть меню" }).click();

  const menu = page.getByRole("dialog", { name: "Основная навигация" });
  const closeButton = menu.getByRole("button", { name: "Закрыть меню" });
  const firstLink = menu.getByRole("link", { name: "Главная" });
  const lastLink = menu.getByRole("link", { name: "Каталог программ" });
  await expect(firstLink).toBeFocused();

  await page.keyboard.press("Shift+Tab");
  await expect(closeButton).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(lastLink).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closeButton).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Открыть меню" })).toBeFocused();
  await expect(page.locator("main")).not.toHaveAttribute("inert", "");
});

test("home catalog call to action opens the React catalog directly", async ({ page, diagnostics }) => {
  await page.goto("/");

  const catalogLink = page.getByRole("link", { name: "Открыть каталог программ" }).first();
  await catalogLink.scrollIntoViewIfNeeded();
  await catalogLink.click();

  await expect(page).toHaveURL(/\/programs$/);
  await expect(page.getByRole("heading", { level: 1, name: "Каталог программ" })).toBeVisible();
  await expect(page.getByRole("article").first()).toBeVisible();
  expectNoPageErrors(diagnostics);
});
