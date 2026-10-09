import { expect, openDemoPage, test } from "./support.js";

const programCode = "01.03.02-01";
const programKey = "program:bmstu:01.03.02:ИУ9:01.03.02-01:source:1-1";

async function seedOnce(page, values) {
  await page.addInitScript((entries) => {
    if (sessionStorage.getItem("qa-workflow-seeded")) return;
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, JSON.stringify(value));
    sessionStorage.setItem("qa-workflow-seeded", "true");
  }, values);
}

test("favorites ignore missing identities and repeated add/remove cycles do not duplicate a program", async ({ page, browserDiagnostics }) => {
  const removedKey = "program:no-longer-in-release";
  await seedOnce(page, { "andromeda.favorites.v1": [programKey, programKey, removedKey] });
  await openDemoPage(page, "favorites.html");
  await expect(page.locator("#favoriteGrid")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#favoriteGrid .favorite-card")).toHaveCount(1);
  await expect(page.locator("#favoriteCount")).toHaveText("1 программа сохранена");
  await expect(page.locator("#favoriteGrid")).not.toContainText(removedKey);
  await page.getByRole("button", { name: "Убрать из избранного" }).click();
  await expect(page.locator("#favoriteGrid .empty-state")).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("andromeda.favorites.v1")))).toEqual([removedKey]);

  await page.goto("workspace.html?data=demo#catalog");
  const card = page.locator("#workspaceView .catalog-card").filter({ hasText: programCode });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Сохранить в избранное" }).click();
  await expect(card.getByRole("button", { name: "Убрать из избранного" })).toHaveAttribute("aria-pressed", "true");
  await card.getByRole("button", { name: "Убрать из избранного" }).click();
  await card.getByRole("button", { name: "Сохранить в избранное" }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("andromeda.favorites.v1")))).toEqual([removedKey, programKey]);
  await page.goto("favorites.html?data=demo");
  await expect(page.locator("#favoriteGrid .favorite-card")).toHaveCount(1);
  await page.reload();
  await expect(page.locator("#favoriteGrid .favorite-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Убрать из избранного" }).click();
  await expect(page.locator("#favoriteGrid .empty-state")).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("andromeda.favorites.v1")))).toEqual([removedKey]);
});

test("profile rejects invalid score boundaries, saves zero and 100, and persists clearing", async ({ page, browserDiagnostics }) => {
  await seedOnce(page, { "andromeda.applicant.v1": { scores: { mathematics: 82 }, interests: ["existing interest"] } });
  await openDemoPage(page, "profile.html");
  await expect(page.locator("#achievementList .loading-state")).toHaveCount(0);
  const mathematics = page.locator("#score-mathematics");
  const save = page.getByRole("button", { name: "Сохранить профиль" });
  for (const [value, validityFlag] of [["-1", "rangeUnderflow"], ["101", "rangeOverflow"], ["50.5", "stepMismatch"]]) {
    await mathematics.fill(value);
    await save.click();
    expect(await mathematics.evaluate((input, flag) => input.validity[flag], validityFlag)).toBe(true);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("andromeda.applicant.v1")).scores.mathematics)).toBe(82);
    await expect(page.locator("#saveStatus")).not.toContainText("Сохранено");
  }
  await mathematics.fill("0");
  await page.locator("#score-physics").fill("100");
  await save.click();
  await expect(page.locator("#saveStatus")).toContainText("Сохранено в этом браузере");
  await page.reload();
  await expect(mathematics).toHaveValue("0");
  await expect(page.locator("#score-physics")).toHaveValue("100");
  await expect(page.locator("#interestTags")).toContainText("existing interest");
  await expect(page.locator("#achievementList .loading-state")).toHaveCount(0);
  await page.getByRole("button", { name: "Очистить профиль" }).click();
  await expect(page.locator("#saveStatus")).toContainText("Профиль очищен");
  await expect(mathematics).toHaveValue("");
  await expect(page.locator("#interestTags .interest-chip")).toHaveCount(0);
  await page.reload();
  await expect(mathematics).toHaveValue("");
  await expect(page.locator("#score-physics")).toHaveValue("");
  await expect(page.locator("#interestTags .interest-chip")).toHaveCount(0);
  await expect(page.locator("#achievementList .loading-state")).toHaveCount(0);
  await save.click();
  await expect(page.locator("#saveStatus")).toContainText("Сохранено в этом браузере");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("andromeda.applicant.v1")).scores)).toEqual({});
  await page.reload();
  await expect(mathematics).toHaveValue("");
});

test("workspace forward navigation and reload restore the comparison route and shared state", async ({ page, browserDiagnostics }) => {
  await seedOnce(page, { "andromeda.compare.v1": [programKey], "andromeda.favorites.v1": [programKey] });
  await openDemoPage(page, "workspace.html#catalog");
  const card = page.locator("#workspaceView .catalog-card").filter({ hasText: programCode });
  await expect(card.getByRole("button", { name: "Убрать из избранного" })).toHaveAttribute("aria-pressed", "true");
  await page.locator(".workspace-nav").getByRole("link", { name: "Сравнить программы" }).click();
  await expect(page).toHaveURL(/#compare$/);
  await expect(page.locator("#compare-program-1")).toHaveValue(programKey);
  await page.goBack();
  await expect(page).toHaveURL(/#catalog$/);
  await expect(card.getByRole("button", { name: "Убрать из избранного" })).toHaveAttribute("aria-pressed", "true");
  await page.goForward();
  await expect(page).toHaveURL(/#compare$/);
  await expect(page.locator("#viewTitle")).toContainText("Сравнить программы");
  await expect(page.locator("#compare-program-1")).toHaveValue(programKey);
  await page.reload();
  await expect(page).toHaveURL(/#compare$/);
  await expect(page.locator("#viewTitle")).toContainText("Сравнить программы");
  await expect(page.locator("#compare-program-1")).toHaveValue(programKey);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("andromeda.favorites.v1")))).toEqual([programKey]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("andromeda.compare.v1")))).toEqual([programKey]);
});

test("first-screen logo and menu lead to the original home and catalog destinations", async ({ page, browserDiagnostics }) => {
  await openDemoPage(page, "first-screen.html");
  await page.getByRole("link", { name: "Andromeda × BMSTU — главная" }).click();
  await expect(page).toHaveURL(/\/index\.html(?:\?|$)/);
  await expect(page.locator("#home-actions")).toBeVisible();
  await openDemoPage(page, "first-screen.html");
  await page.locator("#menuButton").click();
  await expect(page.locator("#menuButton")).toHaveAttribute("aria-expanded", "true");
  await page.locator("#menuPanel").getByRole("link", { name: /Каталог программ/ }).click();
  await expect(page).toHaveURL(/\/programs\.html(?:\?|$)/);
  await expect(page.locator("#programGrid .program-card")).toHaveCount(152);
});
