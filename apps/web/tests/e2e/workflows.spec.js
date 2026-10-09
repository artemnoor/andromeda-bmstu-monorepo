import { expect, openDemoPage, test } from "./support.js";

const firstProgramCode = "01.03.02-01";
const secondProgramCode = "01.03.03-02";

test("profile imports legacy data and saves scores, interests, direction and achievement across reload", async ({ page, browserDiagnostics }) => {
  await page.addInitScript(() => {
    localStorage.setItem("andromeda-applicant-profile-v1", JSON.stringify({
      scores: { mathematics: 82 },
      interests: ["robotics"],
      achievementKeys: [],
      directionCode: "01.03.02",
    }));
  });
  await openDemoPage(page, "profile.html");
  await expect(page.locator("#achievementList .loading-state")).toHaveCount(0);
  await expect(page.locator("#score-mathematics")).toHaveValue("82");
  await expect(page.locator("#interestTags")).toContainText("robotics");

  const profile = await page.evaluate(() => JSON.parse(localStorage.getItem("andromeda.applicant.v1")));
  expect(profile.targetDirection).toBe("01.03.02");
  expect(await page.evaluate(() => localStorage.getItem("andromeda-applicant-profile-v1"))).toBeNull();

  await page.locator("#score-mathematics").fill("91");
  await page.locator("#interestInput").fill("робототехника");
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  await expect.poll(() => page.locator("#targetDirection option").count()).toBeGreaterThan(1);
  await page.locator("#targetDirection").selectOption({ index: 1 });
  const achievement = page.locator("#achievementList input[type=checkbox]").first();
  await expect(achievement).toBeVisible();
  const achievementKey = await achievement.inputValue();
  await achievement.check();
  await page.getByRole("button", { name: "Сохранить профиль" }).click();
  await expect(page.locator("#saveStatus")).toContainText("Сохранено в этом браузере");
  const savedDirection = await page.locator("#targetDirection").inputValue();
  await page.reload();

  await expect(page.locator("#score-mathematics")).toHaveValue("91");
  await expect(page.locator("#interestTags")).toContainText("робототехника");
  await expect(page.locator("#targetDirection")).toHaveValue(savedDirection);
  await expect(page.locator("#achievementList input[type=checkbox][value='" + achievementKey + "']")).toBeChecked();
  await expect(page.locator("body")).toContainText("Без аккаунта");
});

test("catalog search, direction and department filters, comparison and favorites persist between pages", async ({ page, browserDiagnostics }) => {
  await openDemoPage(page, "programs.html");
  await expect(page.locator("#programGrid")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#programGrid .program-card")).toHaveCount(152);
  const search = page.getByRole("searchbox", { name: "Поиск по каталогу" });
  await search.fill("01.03.02-01");
  await expect(page.locator("#programGrid .program-card")).toHaveCount(1);
  await expect(page.locator("#programGrid")).toContainText("Математические методы генерации");
  await search.fill("такого профиля нет");
  await expect(page.locator("#programGrid .empty-state")).toContainText("Ничего не нашлось");
  await page.getByRole("button", { name: /Сбросить/ }).click();
  await expect(page.locator("#programGrid .program-card")).toHaveCount(152);
  await page.getByRole("combobox", { name: "Фильтр по направлению" }).selectOption("01.03.02");
  await expect(page.locator("#programGrid .program-card")).toHaveCount(1);
  await expect(page.locator("#programGrid")).toContainText(firstProgramCode);
  await page.getByRole("combobox", { name: "Фильтр по кафедре" }).selectOption("ИУ9");
  await expect(page.locator("#programGrid .program-card")).toHaveCount(1);
  await page.getByRole("combobox", { name: "Фильтр по кафедре" }).selectOption("ФН3");
  await expect(page.locator("#programGrid .empty-state")).toContainText("Ничего не нашлось");
  await page.getByRole("button", { name: /Сбросить/ }).click();
  await expect(page.locator("#programGrid .program-card")).toHaveCount(152);

  const firstCard = page.locator("#programGrid .program-card").filter({ hasText: firstProgramCode });
  const secondCard = page.locator("#programGrid .program-card").filter({ hasText: secondProgramCode });
  await expect(firstCard).toBeVisible();
  await expect(secondCard).toBeVisible();
  const firstName = await firstCard.locator(".program-title").innerText();
  await firstCard.getByRole("button", { name: "+ Сравнить" }).click();
  await expect(firstCard.getByRole("button", { name: "✓ В сравнении" })).toBeVisible();
  await secondCard.getByRole("button", { name: "+ Сравнить" }).click();
  await expect(secondCard.getByRole("button", { name: "✓ В сравнении" })).toBeVisible();

  await page.goto("compare.html?data=demo");
  await expect(page.locator("#selectedCount")).toHaveText("2 / 3");
  await expect(page.locator("#compareContent .compare-selection-card")).toHaveCount(2);
  await expect(page.locator("#compareContent")).toContainText(firstName);
  await page.reload();
  await expect(page.locator("#selectedCount")).toHaveText("2 / 3");
  await page.getByRole("button", { name: "Убрать программу " + firstProgramCode + " из сравнения" }).click();
  await expect(page.locator("#selectedCount")).toHaveText("1 / 3");

  await page.goto("workspace.html?data=demo#catalog");
  await expect(page.locator("#workspaceView .catalog-card").first()).toBeVisible();
  const favoriteCard = page.locator("#workspaceView .catalog-card").filter({ hasText: firstProgramCode });
  await favoriteCard.getByRole("button", { name: "Сохранить в избранное" }).click();
  await expect(favoriteCard.getByRole("button", { name: "Убрать из избранного" })).toHaveAttribute("aria-pressed", "true");
  await page.goto("favorites.html?data=demo");
  await expect(page.locator("#favoriteGrid .favorite-card")).toHaveCount(1);
  await expect(page.locator("#favoriteGrid")).toContainText(firstName);
  await page.getByRole("button", { name: "Убрать из избранного" }).click();
  await expect(page.locator("#favoriteGrid")).toContainText("Пока ничего не сохранено");
  await page.reload();
  await expect(page.locator("#favoriteGrid")).toContainText("Пока ничего не сохранено");
});

test("comparison stays capped at three until the user explicitly clears it", async ({ page, browserDiagnostics }) => {
  await openDemoPage(page, "programs.html");
  const cards = page.locator("#programGrid .program-card");
  await expect(cards).toHaveCount(152);
  for (let index = 0; index < 3; index += 1) {
    await cards.nth(index).getByRole("button", { name: "+ Сравнить" }).click();
  }
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("andromeda.compare.v1"))?.length ?? 0)).toBe(3);
  await cards.nth(3).getByRole("button", { name: "+ Сравнить" }).click();
  const dialog = page.locator(".comparison-limit-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("3 из 3");
  await dialog.getByRole("button", { name: "Оставить" }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("andromeda.compare.v1"))?.length ?? 0)).toBe(3);

  await cards.nth(3).getByRole("button", { name: "+ Сравнить" }).click();
  await page.locator(".comparison-limit-dialog").getByRole("button", { name: "Очистить" }).click();
  await expect(page.locator(".comparison-limit-dialog")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("andromeda.compare.v1")))).toEqual([]);
  await expect(page.locator("#catalogFeedback")).toContainText("Список очищен");
});

test("career test requires answers, advances, supports back and restart", async ({ page, browserDiagnostics }) => {
  test.setTimeout(90_000);
  await openDemoPage(page, "discover.html");
  await expect(page.locator("#testPanel")).toBeVisible({ timeout: 30_000 });
  const next = page.getByRole("button", { name: "Продолжить" });
  await expect(next).toBeDisabled();
  await page.locator("#testQuestion [data-choice]").first().click();
  await expect(next).toBeEnabled();
  await next.click();
  await expect(page.locator("#testQuestion")).toContainText("Какой формат учебной работы тебе ближе?");
  await page.getByRole("button", { name: "Назад" }).click();
  await expect(page.locator("#testQuestion")).toContainText("Что тебе интересно изучать?");
  await expect(page.locator("#testQuestion [data-choice]").first()).toHaveAttribute("aria-pressed", "true");
  await next.click();
  await expect(page.locator("#testQuestion")).toContainText("Какой формат учебной работы тебе ближе?");
  await page.locator("#testQuestion [data-choice]").first().click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(page.locator("#testQuestion")).toContainText("Каких областей хотелось бы поменьше?");
  await page.getByRole("button", { name: /Нет выраженного стоп-листа/ }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();

  for (let attempt = 0; attempt < 5 && await page.locator("#testResults").isHidden(); attempt += 1) {
    const preference = page.locator("#testQuestion [data-value]").first();
    if (await preference.count()) await preference.click();
    const continueButton = page.locator("#nextQuestion");
    if (await continueButton.isDisabled()) break;
    await continueButton.click();
  }
  await expect(page.locator("#testResults")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#resultsCount")).not.toHaveText("—");
  await page.getByRole("button", { name: "Изменить ответы" }).click();
  await expect(page.locator("#testPanel")).toBeVisible();
  await page.getByRole("button", { name: "Начать заново" }).click();
  await expect(page.locator("#testQuestion")).toContainText("Что тебе интересно изучать?");
});

test("workspace deep links, browser history and program dialog work", async ({ page, browserDiagnostics }) => {
  await openDemoPage(page, "workspace.html#catalog");
  await expect(page.locator("#viewTitle")).toContainText("Каталог программ");
  await expect(page.locator("#workspaceView .catalog-card").first()).toBeVisible();
  await page.getByRole("link", { name: "Сравнить программы" }).click();
  await expect(page).toHaveURL(/#compare$/);
  await expect(page.locator("#viewTitle")).toContainText("Сравнить программы");
  await page.goBack();
  await expect(page).toHaveURL(/#catalog$/);
  const openProgramButton = page.locator("#workspaceView .catalog-card").first().getByRole("button", { name: "Карточка программы" });
  await openProgramButton.click();
  await expect(page.locator("#programDialog")).toBeVisible();
  await expect(page.locator("#dialogBody")).toContainText("Учебный план и дисциплины");
  await expect(page.locator("#dialogClose")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#programDialog")).toBeHidden();
  await expect(openProgramButton).toBeFocused();
  await openProgramButton.click();
  await expect(page.locator("#programDialog")).toBeVisible();
  await page.getByRole("button", { name: "Закрыть" }).click();
  await expect(page.locator("#programDialog")).toBeHidden();
});
