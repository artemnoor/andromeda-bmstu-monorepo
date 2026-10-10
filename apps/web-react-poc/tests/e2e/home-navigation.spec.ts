import { clearPocStorage, expect, expectNoPageErrors, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await clearPocStorage(page);
});

test("home navigation opens the catalog from the original menu", async ({ page, diagnostics }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "МГТУ имени Баумана × Андромеда" })).toBeVisible();
  const menuButton = page.getByRole("button", { name: "Открыть меню" });
  await menuButton.click();
  await expect(page.getByRole("button", { name: "Закрыть меню" })).toHaveAttribute("aria-expanded", "true");

  const catalogLink = page.getByRole("link", { name: "Каталог программ" });
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

  const catalogLink = page.getByRole("link", { name: "Открыть каталог образовательных программ" });
  await catalogLink.scrollIntoViewIfNeeded();
  await catalogLink.click();

  await expect(page).toHaveURL(/\/programs$/);
  await expect(page.getByRole("heading", { level: 1, name: "Каталог программ" })).toBeVisible();
  await expect(page.getByRole("article").first()).toBeVisible();
  expectNoPageErrors(diagnostics);
});
