import { expect, expectNoHorizontalOverflow, openDemoPage, test, waitForPageData } from "./support.js";

test("favorite cards wrap without horizontal clipping on narrow phones", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("andromeda.favorites.v1", JSON.stringify(["01.03.02-01", "01.03.03-02"]));
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await openDemoPage(page, "favorites.html");
  await waitForPageData(page, "favorites.html");
  await expect(page.locator("#favoriteGrid .favorite-card")).toHaveCount(2);

  for (const width of [390, 375, 320]) {
    await page.setViewportSize({ width, height: width === 375 ? 667 : 844 });
    await expectNoHorizontalOverflow(page, width);
    const cards = page.locator("#favoriteGrid .favorite-card");
    await expect(cards).toHaveCount(2);
    const rightEdges = await cards.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().right));
    expect(Math.max(...rightEdges)).toBeLessThanOrEqual(width);
  }
});
