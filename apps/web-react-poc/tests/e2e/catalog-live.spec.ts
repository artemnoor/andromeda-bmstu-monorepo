import {
  clearPocStorage,
  discoverLiveProgram,
  expect,
  expectHealthyBrowser,
  expectLiveApiCalls,
  test,
} from "./fixtures";

const catalogEndpoints = [
  "/api/v1/release",
  "/api/v1/programs",
  "/api/v1/directions",
  "/api/v1/departments",
] as const;

test.beforeEach(async ({ page }) => clearPocStorage(page));

test("catalog loads one consistent release snapshot and searches a discovered program by code", async ({ page, diagnostics }) => {
  await page.goto("/programs");

  await expect(page.getByRole("heading", { level: 1, name: "Каталог программ" })).toBeVisible();
  const program = await discoverLiveProgram(page);
  expectLiveApiCalls(diagnostics, catalogEndpoints);
  const baselineCounts = new Map(catalogEndpoints.map((path) => (
    [path, diagnostics.apiResponses.filter((response) => response.path === path).length] as const
  )));

  const search = page.getByRole("searchbox", { name: /Поиск по каталогу/ });
  await search.fill(program.code);
  await expect(page).toHaveURL(new RegExp(`[?&]q=${encodeURIComponent(program.code)}(?:&|$)`));
  for (const path of catalogEndpoints) {
    expect(diagnostics.apiResponses.filter((response) => response.path === path), `${path} must not reload for local search`)
      .toHaveLength(baselineCounts.get(path) ?? 0);
  }
  const matchingCard = page.getByRole("article").filter({ hasText: program.code });
  await expect(matchingCard.first()).toBeVisible();
  await expect(matchingCard.first().getByRole("heading", { level: 2, name: program.name, exact: true })).toBeVisible();

  await page.reload();
  await expect(search).toHaveValue(program.code);
  await expect(page.getByRole("article").filter({ hasText: program.code }).first()).toBeVisible();

  await search.fill("__andromeda_no_such_program__");
  await expect(page.getByRole("heading", { name: "Ничего не нашлось" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);

  await page.getByRole("button", { name: /Сбросить/ }).click();
  await expect(page.getByRole("article").first()).toBeVisible();
  expectHealthyBrowser(diagnostics);
});

test("catalog direction filter narrows live results and can be reset", async ({ page, diagnostics }) => {
  await page.goto("/programs");
  await expect(page.getByRole("heading", { level: 1, name: "Каталог программ" })).toBeVisible();

  const direction = page.getByLabel("Направление");
  const options = await direction.locator("option").evaluateAll((elements) => (
    elements.map((option) => (option as HTMLOptionElement).value).filter(Boolean)
  ));
  expect(options.length, "the seeded release should expose a direction filter").toBeGreaterThan(0);
  const selectedDirection = options[0];
  if (!selectedDirection) throw new Error("The active release contained no selectable direction.");
  const baselineCounts = new Map(catalogEndpoints.map((path) => (
    [path, diagnostics.apiResponses.filter((response) => response.path === path).length] as const
  )));

  await direction.selectOption(selectedDirection);
  await expect(page).toHaveURL(new RegExp(`[?&]direction=${encodeURIComponent(selectedDirection)}(?:&|$)`));
  const filteredCards = page.getByRole("article");
  await expect.poll(async () => {
    const cardTexts = await filteredCards.allInnerTexts();
    return cardTexts.length > 0 && cardTexts.every((text) => text.includes(selectedDirection));
  }, { message: "every rendered program should match the selected direction" }).toBe(true);
  const count = await filteredCards.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    await expect(filteredCards.nth(index)).toContainText(selectedDirection);
  }
  for (const path of catalogEndpoints) {
    expect(diagnostics.apiResponses.filter((response) => response.path === path), `${path} must not reload for a local filter`)
      .toHaveLength(baselineCounts.get(path) ?? 0);
  }

  await page.reload();
  await expect(direction).toHaveValue(selectedDirection);
  await expect(page.getByRole("article").first()).toContainText(selectedDirection);

  await page.getByRole("button", { name: /Сбросить/ }).click();
  await expect(direction).toHaveValue("");
  expectLiveApiCalls(diagnostics, catalogEndpoints);
  expectHealthyBrowser(diagnostics);
});
