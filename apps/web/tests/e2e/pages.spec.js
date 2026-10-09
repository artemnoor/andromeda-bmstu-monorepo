import { demoPages, expect, expectNoHorizontalOverflow, openDemoPage, test, waitForPageData } from "./support.js";

test.describe("all original pages load in the explicit demo mode", () => {
  for (const entry of demoPages) {
    test(entry.path + " renders without browser errors on desktop and mobile", async ({ page, browserDiagnostics }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      const response = await openDemoPage(page, entry.path);
      await expect(page.locator("main")).toBeVisible();
      await expect(page.locator(entry.selector)).toBeVisible();
      await waitForPageData(page, entry.path);
      expect(await page.title()).not.toBe("");
      expect(await page.locator("link[rel='stylesheet'], style").count()).toBeGreaterThan(0);
      for (const viewport of [
        { width: 1920, height: 1080 },
        { width: 1440, height: 900 },
        { width: 1280, height: 800 },
        { width: 768, height: 1024 },
        { width: 390, height: 844 },
        { width: 375, height: 667 },
      ]) {
        await page.setViewportSize(viewport);
        await expect(page.locator(entry.selector)).toBeVisible();
        await expectNoHorizontalOverflow(page, viewport.width);
      }

      if (entry.path.startsWith("programs.html")) {
        await expect(page.locator("#programGrid .program-card")).toHaveCount(152);
      }
      if (entry.path.startsWith("compare.html")) {
        await expect(page.locator("#compareContent")).toContainText("отметь до трёх");
      }
      if (entry.path.startsWith("favorites.html")) {
        await expect(page.locator("#favoriteGrid")).toContainText("Пока ничего не сохранено");
      }
      if (entry.path.startsWith("profile.html")) {
        await expect(page.locator("#scoreGrid input")).toHaveCount(10);
        await expect(page.locator("body")).toContainText("Без аккаунта");
      }
      if (entry.path.startsWith("admission.html")) {
        await expect(page.locator("#dataStatus")).toContainText("ДЕМО");
      }
      if (entry.path.startsWith("discover.html")) {
        await expect(page.locator("#testSourceNote")).toContainText("Демо-снимок");
      }
      if (entry.path.startsWith("workspace.html")) {
        await expect(page.locator("#viewTitle")).toContainText("Каталог программ");
      }

      expect(browserDiagnostics.pageErrors).toEqual([]);
      expect(response.status()).toBe(200);
    });
  }
});

test("home and shared navigation menus support keyboard open and close", async ({ page, browserDiagnostics }) => {
  await page.goto("index.html?data=demo");
  const homeButton = page.locator("#menuButton");
  await homeButton.focus();
  await page.keyboard.press("Enter");
  await expect(homeButton).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(homeButton).toHaveAttribute("aria-expanded", "false");

  await page.goto("programs.html?data=demo");
  const sharedButton = page.locator(".andromeda-menu-button");
  await expect(sharedButton).toHaveAttribute("aria-expanded", "false");
  await sharedButton.focus();
  await page.keyboard.press("Space");
  await expect(sharedButton).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#andromedaMenuPanel")).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator("#andromedaMenuPanel a").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(sharedButton).toHaveAttribute("aria-expanded", "false");
  await expect(sharedButton).toBeFocused();
});
