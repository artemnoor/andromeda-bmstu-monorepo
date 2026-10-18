import { clearPocStorage, expect, expectHealthyBrowser, test } from "./fixtures";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const RELEASE_KEY = "release-prof-test-2026";
const CAMPAIGN_KEY = "campaign:admission:2026";
const categories = [
  { category_code: "03", name: "Математика", definition: "Основы математики", ordinal: 3 },
  { category_code: "04", name: "Физика", definition: "Физические модели", ordinal: 4 },
  { category_code: "05", name: "Информатика", definition: "Алгоритмы и вычисления", ordinal: 5 },
  { category_code: "06", name: "Механика", definition: "Механика систем", ordinal: 6 },
  { category_code: "07", name: "Экономика", definition: "Экономические процессы", ordinal: 7 },
  { category_code: "08", name: "Проектирование", definition: "Создание и проверка систем", ordinal: 8 },
];

const programs = categories.map((_, index) => ({
  external_key: `program:${index + 1}`,
  code: `01.01.0${index + 1}`,
  name: `Образовательная программа ${index + 1}`,
  direction_key: `direction:${index + 1}`,
  campus_status: "not_stated",
  department_relations: [],
  sources: [],
}));

const plans = programs.map((program, index) => ({
  external_key: `plan:${index + 1}`,
  program_key: program.external_key,
  academic_year: "2025-2026",
  status: "parsed",
  profile_link_status: "verified",
  item_count: categories.length,
  document_url: `https://example.test/plan-${index + 1}.pdf`,
}));

const curriculumItems = plans.flatMap((plan, planIndex) => categories.map((category, categoryIndex) => {
  const hours = categoryIndex === planIndex ? 50 : 10;
  return {
    external_key: `${plan.external_key}:item:${category.category_code}`,
    study_plan_key: plan.external_key,
    ordinal: categoryIndex + 1,
    discipline_name: category.name,
    total_hours: hours,
    lecture_hours: hours * 0.4,
    practice_hours: hours * 0.3,
    lab_hours: hours * 0.2,
    self_study_hours: hours * 0.1,
  subject_classification: {
      category_code: category.category_code,
      category_name: category.name,
      confidence: 1,
      model: "Jev",
      probabilities: Object.fromEntries(categories.map((entry) => [entry.category_code, entry.category_code === category.category_code ? 1 : 0])),
      review_status: categoryIndex === 0 ? "needs_review" : "classified",
      run_key: "classification:prof-test-fixture",
      taxonomy_key: "bmstu-subject-domain-16",
      taxonomy_version: "v1",
    },
  };
}));

const profileSnapshot = {
  schema_version: 2,
  release: { release_key: RELEASE_KEY, source_bundle_sha256: "a".repeat(64) },
  taxonomy: { taxonomy_key: "bmstu-subject-domain-16", taxonomy_version: "v1" },
  source_curriculum_sha256: "b".repeat(64),
  program_count: programs.length,
  selected_plan_count: plans.length,
  unavailable_program_count: 0,
  total_curriculum_rows: plans.reduce((sum, plan) => sum + (plan.item_count ?? 0), 0),
  classified_rows: plans.length * (categories.length - 1),
  assigned_rows: plans.length * categories.length,
  review_rows: plans.length,
  profiles: plans.map((plan, planIndex) => ({
    program_key: plan.program_key,
    plan_key: plan.external_key,
    plan_item_count: plan.item_count,
    total_hours: 100,
    assigned_hours: 100,
    classified_rows: categories.length - 1,
    assigned_rows: categories.length,
    review_rows: 1,
    category_hours: Object.fromEntries(categories.map((category, categoryIndex) => [
      category.category_code,
      categoryIndex === planIndex ? 50 : 10,
    ])),
    activity_shares: { lecture_hours: 0.4, practice_hours: 0.3, lab_hours: 0.2, self_study_hours: 0.1 },
  })),
};

function page(items: readonly unknown[], releaseKey = RELEASE_KEY) {
  return {
    items,
    page: { limit: 100, next_cursor: null, total_count: items.length, release_key: releaseKey },
  };
}

async function installProfTestApi(pageObject: Page, options: {
  readonly changedPlanRelease?: boolean;
  readonly changedSnapshotRelease?: boolean;
  readonly changedActiveReleaseAfterLoad?: boolean;
  readonly invalidSnapshotSchema?: boolean;
  readonly failFirstCatalogRequest?: boolean;
  readonly programRequestDelayMs?: number;
} = {}) {
  let shouldFailFirstCatalogRequest = options.failFirstCatalogRequest ?? false;
  let releaseRequestCount = 0;
  await pageObject.route("**/data/prof-test-profile-snapshot.json", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(options.changedSnapshotRelease
      ? { ...profileSnapshot, release: { ...profileSnapshot.release, release_key: "older-profile-snapshot" } }
      : options.invalidSnapshotSchema
        ? { ...profileSnapshot, schema_version: 1 }
        : profileSnapshot),
  }));
  await pageObject.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const pathname = decodeURIComponent(url.pathname);
    let body: unknown;
    if (pathname === "/api/v1/programs" && options.programRequestDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.programRequestDelayMs));
    }
    if (pathname === "/api/v1/programs" && shouldFailFirstCatalogRequest) {
      shouldFailFirstCatalogRequest = false;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "temporary outage" }) });
      return;
    }
    if (pathname === "/api/v1/release") {
      releaseRequestCount += 1;
      body = {
        release_key: options.changedActiveReleaseAfterLoad && releaseRequestCount >= 3
          ? "release-switched-after-load"
          : RELEASE_KEY,
      };
    }
    else if (pathname === "/api/v1/programs") body = page(programs);
    else if (pathname === "/api/v1/directions") body = page(programs.map((program, index) => ({ external_key: program.direction_key, code: program.code, name: `Направление ${index + 1}` })));
    else if (pathname === "/api/v1/departments") body = page([]);
    else if (pathname === "/api/v1/study-plans") body = page(plans, options.changedPlanRelease ? "release-switched-during-load" : RELEASE_KEY);
    else if (pathname === "/api/v1/subject-taxonomies/bmstu-subject-domain-16/v1") {
      body = { taxonomy_key: "bmstu-subject-domain-16", taxonomy_version: "v1", name: "Subject taxonomy", description: "Fixture", categories };
    } else if (pathname === "/api/v1/campaigns") body = page([{
      external_key: CAMPAIGN_KEY,
      university_key: "bmstu",
      year: 2026,
      campaign_kind: "admission",
      title: "Приём 2026",
      campus_status: "not_stated",
    }]);
    else if (pathname === "/api/v1/requirements") body = page([{
      external_key: "requirement:direction:1",
      campaign_key: CAMPAIGN_KEY,
      direction_key: "direction:1",
      direction_code: "01.01.01",
      ingested_at: "2026-01-01T00:00:00Z",
      root: {
        kind: "operator",
        node_key: "root:direction:1",
        operator: "AND",
        children: [
          { kind: "leaf", node_key: "exam:math", subject_code: "mathematics", minimum_score: "70" },
          { kind: "leaf", node_key: "exam:physics", subject_code: "physics", minimum_score: "60" },
        ],
      },
    }]);
    else if (pathname.startsWith("/api/v1/study-plans/") && pathname.endsWith("/items")) {
      const planKey = pathname.split("/").at(-2);
      body = page(curriculumItems.filter((item) => item.study_plan_key === planKey));
    } else {
      body = { error: { code: "not_found", message: `Unexpected test request: ${pathname}` } };
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify(body) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }).catch(() => undefined);
  });
}

async function answerCoreQuestions(pageObject: Page) {
  await pageObject.getByRole("button", { name: /Математика/ }).click();
  await pageObject.getByRole("button", { name: "Продолжить" }).click();
  await pageObject.getByRole("button", { name: /Слушать и разбираться/ }).click();
  await pageObject.getByRole("button", { name: "Продолжить" }).click();
  // The avoid list is optional.
  await pageObject.getByRole("button", { name: "Продолжить" }).click();
}

async function answerComparisonsUntilResults(pageObject: Page) {
  const results = pageObject.getByRole("heading", {
    level: 2,
    name: /Твои подходящие программы|Пока не получилось выделить совпадение/,
  });
  for (let index = 0; index < 4; index += 1) {
    if (await results.isVisible().catch(() => false)) return;
    const tieChoice = pageObject.getByRole("button", { name: "Одинаково" });
    if (await tieChoice.count() === 0) return;
    await tieChoice.click();
    await pageObject.getByRole("button", { name: /Продолжить|Показать результат/ }).click();
  }
}

async function expectResultsBelowNavigation(pageObject: Page) {
  const resultsHeading = pageObject.getByRole("heading", { level: 2, name: /Твои подходящие программы|Пока не получилось выделить совпадение/ });
  const pageHeading = pageObject.getByRole("heading", { level: 1, name: "Проф-тест" });
  const navigation = pageObject.locator("header").first();
  const resultsIntro = pageObject.locator("header").filter({ has: resultsHeading }).first();
  await expect.poll(async () => {
    const headingBox = await resultsHeading.boundingBox();
    const pageHeadingBox = await pageHeading.boundingBox();
    const navigationBox = await navigation.boundingBox();
    const introBox = await resultsIntro.boundingBox();
    if (!headingBox || !pageHeadingBox || !navigationBox || !introBox) return -1;
    const resultGap = headingBox.y - navigationBox.y - navigationBox.height;
    const introGap = introBox.y - navigationBox.y - navigationBox.height;
    const pageTitleClearsHeader = pageHeadingBox.y + pageHeadingBox.height <= navigationBox.y
      || pageHeadingBox.y >= navigationBox.y + navigationBox.height;
    return pageTitleClearsHeader && resultGap >= 8 ? introGap : -1;
  }).toBeGreaterThanOrEqual(8);
  await expect.poll(async () => {
    const introBox = await resultsIntro.boundingBox();
    const navigationBox = await navigation.boundingBox();
    return introBox && navigationBox ? introBox.y - navigationBox.y - navigationBox.height : Number.POSITIVE_INFINITY;
  }).toBeLessThanOrEqual(112);
}

test.beforeEach(async ({ page }) => {
  await clearPocStorage(page);
  await installProfTestApi(page);
});

test("career test completes its React flow, preserves answers on back, and adds a recommendation to comparison", async ({ page, diagnostics }) => {
  await page.addInitScript(() => {
    localStorage.setItem("andromeda.applicant.v1", JSON.stringify({ scores: { mathematics: 75, physics: 60 } }));
  });
  await page.goto("/discover");
  await expect(page.getByRole("heading", { level: 1, name: "Проф-тест" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Математика/ })).toBeVisible();
  await answerCoreQuestions(page);

  await answerComparisonsUntilResults(page);

  await expect(page.getByRole("heading", { level: 2, name: "Твои подходящие программы" })).toBeVisible();
  await expectResultsBelowNavigation(page);
  await expect(page.getByText("Относительный индекс по программам каталога, не шанс поступления").first()).toBeVisible();
  await expect(page.getByText(/показанные минимумы пройдены/i).first()).toBeVisible();
  await page.getByText("Учебный план и источники", { exact: true }).first().click();
  await expect(page.getByText(/Jev пометил для проверки/).first()).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(5);
  await page.getByRole("button", { name: "В сравнение" }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "Программа добавлена" })).toBeVisible();

  await page.getByRole("button", { name: "Изменить ответы" }).click();
  await expect(page.getByRole("heading", { name: "Что из двух хочется изучать чаще?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Одинаково" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Начать заново" }).click();
  await expect(page.getByRole("heading", { name: "Что тебе интересно изучать?" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Математика/ })).toHaveAttribute("aria-pressed", "false");
  expectHealthyBrowser(diagnostics);
});

test("preserves format and stop-list answers while moving backward and forward", async ({ page }) => {
  await page.goto("/discover");
  await page.getByRole("button", { name: /Математика/ }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  const practice = page.getByRole("button", { name: /Решать задачи/ });
  await practice.click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  const physics = page.getByRole("button", { name: /Физика/ });
  await physics.click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(page.getByRole("heading", { name: "Что из двух хочется изучать чаще?" })).toBeVisible();

  await page.getByRole("button", { name: "Назад" }).click();
  await expect(physics).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.getByRole("button", { name: "Назад" }).click();
  await expect(page.getByRole("heading", { name: "Какие области хотелось бы изучать меньше?" })).toBeVisible();
  await page.getByRole("button", { name: "Назад" }).click();
  await expect(practice).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(physics).toHaveAttribute("aria-pressed", "true");
});

test("lets unsure users skip activity and enforces interest and stop-list limits", async ({ page }) => {
  await page.goto("/discover");
  const math = page.getByRole("button", { name: /Математика/ });
  await math.click();
  await page.getByRole("button", { name: /Физика/ }).click();
  await page.getByRole("button", { name: /Информатика/ }).click();
  await page.getByRole("button", { name: /Механика/ }).click();
  await page.getByRole("button", { name: /Экономика/ }).click();
  await expect(page.getByRole("button", { name: /Проектирование/ })).toBeDisabled();
  const unknown = page.getByRole("button", { name: /Пока трудно выбрать/ });
  await unknown.click();
  await expect(unknown).toHaveAttribute("aria-pressed", "true");
  await expect(math).toHaveAttribute("aria-pressed", "false");
  await math.click();
  await expect(unknown).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Продолжить" }).click();
  const skip = page.getByRole("button", { name: /Не уверен — пропустить/ });
  await skip.click();
  await expect(skip).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Продолжить" })).toBeEnabled();
  await page.getByRole("button", { name: "Продолжить" }).click();
  const avoidPhysics = page.getByRole("button", { name: /Физика/ });
  const avoidInformatics = page.getByRole("button", { name: /Информатика/ });
  const avoidMechanics = page.getByRole("button", { name: /Механика/ });
  await avoidPhysics.click();
  await avoidInformatics.click();
  await avoidMechanics.click();
  await expect(page.getByRole("button", { name: /Экономика/ })).toBeDisabled();
  const noAvoid = page.getByRole("button", { name: /Готов попробовать всё/ });
  await noAvoid.click();
  await expect(noAvoid).toHaveAttribute("aria-pressed", "true");
  await expect(avoidPhysics).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("heading", { name: "Какие области хотелось бы изучать меньше?" })).toBeVisible();
});

test("allows retry after an academic API failure", async ({ page }) => {
  await page.unrouteAll();
  await installProfTestApi(page, { failFirstCatalogRequest: true });
  await page.goto("/discover");
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Повторить загрузку" }).click();
  await expect(page.getByRole("button", { name: /Математика/ })).toBeVisible();
});

test("aborts the academic data load when leaving the route", async ({ page }) => {
  await page.unrouteAll();
  await installProfTestApi(page, { programRequestDelayMs: 1_500 });
  const pendingPrograms = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/v1/programs");
  await page.goto("/discover");
  await pendingPrograms;
  await page.getByRole("link", { name: "Andromeda × МГТУ имени Баумана — главная" }).click();
  await expect(page.getByRole("button", { name: "Открыть меню" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("does not present arbitrary code-order ties as personalized recommendations", async ({ page }) => {
  await page.goto("/discover");
  await page.getByRole("button", { name: /Пока трудно выбрать/ }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.getByRole("button", { name: /Не уверен — пропустить/ }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.getByRole("button", { name: /Готов попробовать всё/ }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await answerComparisonsUntilResults(page);
  await expect(page.getByRole("heading", { name: "Пока не получилось выделить совпадение" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "без персональной оценки" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
});

test("treats malformed saved exam scores as unknown instead of a pass", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("andromeda.applicant.v1", JSON.stringify({ scores: { mathematics: 999, physics: 60 } }));
  });
  await page.goto("/discover");
  await answerCoreQuestions(page);
  await answerComparisonsUntilResults(page);
  await expect(page.getByText("недостаточно баллов для сверки").first()).toBeVisible();
  await expect(page.getByText("показанные минимумы пройдены")).toHaveCount(0);
});

test("navigation menu opens the React career test route", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Открыть меню" }).click();
  const careerTestLink = page.getByRole("link", { name: "Проф-тест", exact: true });
  await careerTestLink.focus();
  await careerTestLink.press("Enter");
  await expect(page).toHaveURL(/\/discover$/);
  await expect(page.getByRole("heading", { level: 1, name: "Проф-тест" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Математика/ })).toBeVisible();
});

test("career test stays usable on a phone viewport without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/discover");
  await expect(page.getByRole("button", { name: /Математика/ })).toBeVisible();
  await answerCoreQuestions(page);
  await answerComparisonsUntilResults(page);
  await expect(page.getByRole("heading", { level: 2, name: "Твои подходящие программы" })).toBeVisible();
  await expectResultsBelowNavigation(page);
  const dimensions = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
});

test("fails closed if the academic release changes during study plan loading", async ({ page }) => {
  await page.unrouteAll();
  await installProfTestApi(page, { changedPlanRelease: true });
  await page.goto("/discover");
  await expect(page.getByRole("alert")).toContainText("сменился активный академический выпуск");
  await expect(page.getByRole("heading", { name: "Твои подходящие программы" })).toHaveCount(0);
});

test("fails closed if the profile snapshot belongs to another academic release", async ({ page }) => {
  await page.unrouteAll();
  await installProfTestApi(page, { changedSnapshotRelease: true });
  await page.goto("/discover");
  await expect(page.getByRole("alert")).toContainText("сменился активный академический выпуск");
  await expect(page.getByRole("heading", { name: "Твои подходящие программы" })).toHaveCount(0);
});

test("fails closed if the active release changes after all snapshot data is read", async ({ page }) => {
  await page.unrouteAll();
  await installProfTestApi(page, { changedActiveReleaseAfterLoad: true });
  await page.goto("/discover");
  await expect(page.getByRole("alert")).toContainText("сменился активный академический выпуск");
  await expect(page.getByRole("heading", { name: "Твои подходящие программы" })).toHaveCount(0);
});

test("reports an unsupported profile snapshot schema as a data-contract error", async ({ page }) => {
  await page.unrouteAll();
  await installProfTestApi(page, { invalidSnapshotSchema: true });
  await page.goto("/discover");
  await expect(page.getByRole("alert")).toContainText("безопасно собрать данные");
  await expect(page.getByRole("alert")).not.toContainText("сменился активный академический выпуск");
});

test("career questions and results meet automated WCAG AA checks and focus follows each step", async ({ page }) => {
  const expectAccessible = async () => {
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  };
  await page.goto("/discover");
  await expect(page.getByRole("button", { name: /Математика/ })).toBeVisible();
  await expectAccessible();
  await page.getByRole("button", { name: /Математика/ }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  const question = page.locator('section[aria-labelledby="prof-question-title"]');
  await expect(question).toBeFocused();
  await page.getByRole("button", { name: /Слушать и разбираться/ }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(question).toBeFocused();
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await expect(question).toBeFocused();
  await expect(page.getByRole("button", { name: /Слушать и разбираться/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(question).toBeFocused();
  await expectAccessible();
  for (let index = 0; index < 4; index += 1) {
    if (await page.getByRole("heading", { name: "Твои подходящие программы" }).isVisible()) break;
    await page.getByRole("button", { name: "Одинаково" }).click();
    await page.getByRole("button", { name: /Продолжить|Показать результат/ }).click();
    if (await page.getByRole("button", { name: "Одинаково" }).count()) await expect(question).toBeFocused();
  }
  const resultsHeading = page.getByRole("heading", { level: 2, name: "Твои подходящие программы" });
  await expect(resultsHeading).toBeVisible();
  await expect(page.locator("header").filter({ has: resultsHeading })).toBeFocused();
  await expectAccessible();
});

test("career-test error stays accessible and retry restores its questions", async ({ page }) => {
  await page.unrouteAll();
  await installProfTestApi(page, { failFirstCatalogRequest: true });
  await page.goto("/discover");
  await expect(page.getByRole("alert")).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  await page.getByRole("button", { name: "Повторить загрузку" }).click();
  await expect(page.getByRole("button", { name: /Математика/ })).toBeVisible();
});

test("recommendation comparison reports rejected storage writes without claiming success", async ({ page }) => {
  await page.goto("/discover");
  await answerCoreQuestions(page);
  await answerComparisonsUntilResults(page);
  const add = page.getByRole("button", { name: "В сравнение", exact: true }).first();
  await expect(add).toBeVisible();
  await page.evaluate(() => {
    const nativeSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === "andromeda.compare.v1") throw new DOMException("Storage quota exceeded", "QuotaExceededError");
      nativeSetItem.call(this, key, value);
    };
  });
  await add.click();
  await expect(page.getByRole("status").filter({ hasText: /Не удалось сохранить/ })).toBeVisible();
  await expect(add).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText("Программа добавлена в список сравнения.", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("andromeda.compare.v1") ?? "[]"))).toEqual([]);
});

test("recommendation details and admission links stay within the deployed catalog", async ({ page }) => {
  await page.goto("/discover");
  await answerCoreQuestions(page);
  await answerComparisonsUntilResults(page);
  await expect(page.getByRole("link", { name: "Подробнее о программе", exact: true }).first()).toHaveAttribute("href", /\/programs\?/);
  const admissionLinks = page.getByRole("link", { name: /Все условия направления/ });
  expect(await admissionLinks.count()).toBeGreaterThan(0);
  for (const link of await admissionLinks.all()) {
    const href = await link.getAttribute("href");
    expect(href).toMatch(/^\/programs\?/);
    expect(href).not.toMatch(/localhost|127\.0\.0\.1/);
  }
});

test("career questions and results fit six viewport widths without horizontal clipping", async ({ page }) => {
  await page.goto("/discover");
  await expect(page.getByRole("button", { name: /Математика/ })).toBeVisible();
  const assertWidths = async (phase: string) => {
    for (const width of [320, 390, 768, 1024, 1440, 1864]) {
      await page.setViewportSize({ width, height: 900 });
      const dimensions = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
      }));
      expect(dimensions.document, `${phase} overflows at ${width}px`).toBeLessThanOrEqual(dimensions.viewport);
    }
  };
  await assertWidths("questions");
  await answerCoreQuestions(page);
  await assertWidths("paired question");
  await answerComparisonsUntilResults(page);
  await expect(page.getByRole("heading", { name: "Твои подходящие программы" })).toBeVisible();
  await assertWidths("results");
});

test("career answers survive refresh and route return while restart clears the saved draft", async ({ page, diagnostics }) => {
  await page.goto("/discover");
  await page.getByRole("button", { name: /Математика/ }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.getByRole("button", { name: /Решать задачи/ }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.getByRole("button", { name: /Физика/ }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Какие области хотелось бы изучать меньше?" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Физика/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await expect(page.getByRole("button", { name: /Решать задачи/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await expect(page.getByRole("button", { name: /Математика/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await answerComparisonsUntilResults(page);
  await expect(page.getByRole("heading", { name: "Твои подходящие программы" })).toBeVisible();
  const firstRecommendation = await page.getByRole("article").first().getByRole("heading", { level: 3 }).innerText();

  await page.getByRole("link", { name: "Andromeda × МГТУ имени Баумана — главная" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("group", { name: "Основные действия" }).getByRole("link", { name: "Пройти профтест", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Твои подходящие программы" })).toBeVisible();
  await expect(page.getByRole("article").first().getByRole("heading", { level: 3 })).toHaveText(firstRecommendation);
  await page.getByRole("button", { name: "Пройти заново", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Что тебе интересно изучать?" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Что тебе интересно изучать?" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Математика/ })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("heading", { name: "Твои подходящие программы" })).toHaveCount(0);
  expectHealthyBrowser(diagnostics);
});

test("all programs remain searchable beyond the five highlighted results", async ({ page, diagnostics }) => {
  await page.goto("/discover");
  await answerCoreQuestions(page);
  await answerComparisonsUntilResults(page);
  await page.getByRole("link", { name: "Все программы и поиск ↓" }).click();
  await expect(page.getByRole("searchbox", { name: "Найти программу в результатах" })).toBeFocused();
  const list = page.getByRole("list", { name: "Все программы с учебными планами" });
  await expect(list.getByRole("listitem")).toHaveCount(programs.length);
  for (const program of programs) {
    await page.getByRole("searchbox", { name: "Найти программу в результатах" }).fill(program.code);
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(list.getByRole("link", { name: program.name, exact: true })).toHaveAttribute("href", `/programs?code=${program.code}`);
  }
  await list.getByRole("button", { name: /В сравнение/ }).click();
  await expect(list.getByRole("button", { name: /Убрать из сравнения/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("searchbox").fill("совсем несуществующее направление");
  await expect(page.getByText(/Ничего не нашли/)).toBeVisible();
  expectHealthyBrowser(diagnostics);
});

test("neutral answers allow catalog browsing without a fabricated personal score", async ({ page }) => {
  await page.goto("/discover");
  await page.getByRole("button", { name: /Пока трудно выбрать/ }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.getByRole("button", { name: /Не уверен — пропустить/ }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await answerComparisonsUntilResults(page);
  const list = page.getByRole("list", { name: "Все программы с учебными планами" });
  await expect(list.getByRole("listitem")).toHaveCount(programs.length);
  await expect(list.getByText("Без оценки", { exact: true })).toHaveCount(programs.length);
  await expect(page.getByRole("article")).toHaveCount(0);
});

test("long canonical interest names fit narrow phones without clipping", async ({ page }) => {
  await page.route("**/api/v1/subject-taxonomies/bmstu-subject-domain-16/v1", (route) => route.fulfill({ json: {
    taxonomy_key: "bmstu-subject-domain-16", taxonomy_version: "v1", name: "Subject taxonomy", description: "Fixture",
    categories: categories.map((category) => category.category_code === "08"
      ? { ...category, name: "Конструирование, проектирование и CAD/CAE" }
      : category),
  } }));
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/discover");
  const design = page.getByRole("button", { name: /Проектировать и конструировать/ });
  await expect(design).toBeVisible();
  const dimensions = await design.evaluate((button) => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    cardRight: button.getBoundingClientRect().right,
    contentRight: Math.max(...Array.from(button.querySelectorAll("strong, span")).map((child) => child.getBoundingClientRect().right)),
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.contentRight).toBeLessThanOrEqual(dimensions.cardRight);
  await design.click();
  await expect(design).toHaveAttribute("aria-pressed", "true");
});
