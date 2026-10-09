import type { Page } from "@playwright/test";
import {
  clearPocStorage,
  discoverLiveCurriculumProgram,
  discoverLiveCurriculumPrograms,
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

const admissionEndpointPrefixes = [
  "/api/v1/campaigns",
  "/api/v1/place-quotas",
  "/api/v1/requirements",
  "/api/v1/competition-pools",
  "/api/v1/statistics",
  "/api/v1/tuition",
] as const;

const requirementSubjectLabels: Readonly<Record<string, string>> = {
  russian_language: "Русский язык",
  mathematics: "Математика",
  physics: "Физика",
};

function expectSuccessfulAdmissionCalls(responses: readonly { readonly path: string; readonly status: number }[]): void {
  for (const prefix of admissionEndpointPrefixes) {
    const matching = responses.filter((response) => response.path === prefix || response.path.startsWith(`${prefix}/`));
    expect(matching, `the live comparison should call ${prefix}`).not.toHaveLength(0);
    expect(matching.map((response) => response.status), `${prefix} response statuses`).toEqual(matching.map(() => 200));
  }
}

function collectRequirementSubjects(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const rawSubject = typeof record.subject_name === "string"
    ? record.subject_name
    : typeof record.subject_code === "string" ? record.subject_code : null;
  const subject = record.kind === "leaf" && rawSubject
    ? requirementSubjectLabels[rawSubject] ?? rawSubject
    : null;
  const own = subject ? [subject] : [];
  const children = Array.isArray(record.children) ? record.children.flatMap(collectRequirementSubjects) : [];
  return [...own, ...children];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function expectSemesterTotal(
  page: Page,
  code: string,
  unit: "ч." | "з.е.",
  expected: number,
): Promise<void> {
  const series = page.getByRole("group", { name: new RegExp("^" + escapeRegExp(code) + ":") });
  const labels = await series.evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label") ?? ""));
  const values = labels
    .map((label) => label.match(new RegExp(": ([\\d\\s,.]+) " + escapeRegExp(unit) + "$"))?.[1])
    .filter((value): value is string => value !== undefined);
  expect(values.length, `${code} should have numeric semester data in ${unit}`).toBeGreaterThan(0);
  const total = values.reduce((sum, value) => sum + Number(value.replace(/\s/g, "").replace(",", ".")), 0);
  expect(Math.abs(total - expected), `${code} ${unit} sum should match independently summed API rows`).toBeLessThan(0.11);
}

async function expectSeededAdmissionFacts(page: Page, program: { readonly directionKey: string; readonly directionCode: string | null; readonly releaseKey: string }, table: ReturnType<Page["getByRole"]>): Promise<void> {
  // `direction_code` is nullable in the FastAPI DTO; validate direction-only
  // statistics and their displayed scope only when the live record provides it.
  const campaignsResponse = await page.request.get("/api/v1/campaigns?year=2026&limit=100");
  expect(campaignsResponse.status(), "campaign response used as the independent admission fixture").toBe(200);
  const campaignBody = await campaignsResponse.json() as {
    readonly items: readonly { readonly campaign_kind: string; readonly external_key: string; readonly year: number }[];
    readonly page: { readonly release_key: string };
  };
  expect(campaignBody.page.release_key).toBe(program.releaseKey);
  const campaign = campaignBody.items.find((item) => item.campaign_kind === "admission" && item.year === 2026);
  expect(campaign, "the isolated 2026 release should contain an admission campaign").toBeDefined();
  if (!campaign) throw new Error("The test release has no 2026 admission campaign.");

  if (program.directionCode) {
    const statisticsQuery = new URLSearchParams({
      kind: "admission",
      year: "2026",
      direction_code: program.directionCode,
      limit: "100",
    });
    const statisticsResponse = await page.request.get("/api/v1/statistics?" + statisticsQuery.toString());
    expect(statisticsResponse.status(), "direction admission statistics response").toBe(200);
    const statisticsBody = await statisticsResponse.json() as {
      readonly items: readonly {
        readonly admission_stage: string | null;
        readonly competition_type: string | null;
        readonly direction_code: string | null;
        readonly funding_type: string | null;
        readonly scope_type: string | null;
        readonly status: string | null;
      }[];
      readonly page: { readonly release_key: string };
    };
    expect(statisticsBody.page.release_key).toBe(program.releaseKey);
    const unscopedBudgetScore = statisticsBody.items.some((item) => (
      item.direction_code === program.directionCode
      && item.admission_stage === "main"
      && item.funding_type === "budget"
      && ["general", "other"].includes(item.competition_type ?? "")
      && item.status === "numeric"
      && item.scope_type === null
    ));
    expect(unscopedBudgetScore, "the release fixture should exercise the real direction-only admission statistic contract").toBe(true);
    const budgetScoreRow = table.locator("tbody tr").filter({ hasText: "Проходной балл · бюджет · основной конкурс" });
    await expect(budgetScoreRow).toContainText(`по направлению ${program.directionCode}; область источника не уточнена`);
    await expect(budgetScoreRow).not.toContainText("по программе");
  }

  const quotaQuery = new URLSearchParams({ campaign_key: campaign.external_key, limit: "100" });
  const quotaResponse = await page.request.get("/api/v1/place-quotas?" + quotaQuery.toString());
  expect(quotaResponse.status(), "empty place quota page is a valid response").toBe(200);
  const quotaBody = await quotaResponse.json() as {
    readonly items: readonly unknown[];
    readonly page: { readonly release_key: string; readonly total_count: number | null };
  };
  expect(quotaBody.items).toEqual([]);
  expect(quotaBody.page.total_count).toBe(0);
  expect(quotaBody.page.release_key).toBe(program.releaseKey);

  const requirementQuery = new URLSearchParams({ campaign_key: campaign.external_key, limit: "100" });
  const requirementResponse = await page.request.get("/api/v1/requirements?" + requirementQuery.toString());
  expect(requirementResponse.status(), "requirements response used as the independent admission fixture").toBe(200);
  const requirementBody = await requirementResponse.json() as {
    readonly items: readonly { readonly direction_key: string; readonly root: unknown }[];
    readonly page: { readonly release_key: string };
  };
  expect(requirementBody.page.release_key).toBe(program.releaseKey);
  const matching = requirementBody.items.filter((item) => item.direction_key === program.directionKey);
  expect(matching, "the selected program direction should have source-backed entrance requirements").not.toHaveLength(0);
  const subjects = matching.flatMap((item) => collectRequirementSubjects(item.root));
  const displayedSubject = subjects.find((subject) => subject.trim().length > 0);
  expect(displayedSubject, "the API requirement tree should contain a named subject").toBeDefined();
  if (!displayedSubject) throw new Error("The selected direction has no named requirement subject.");
  await expect(table).toContainText(displayedSubject);
  if (program.directionCode) {
    await expect(table).toContainText(`Требования указаны для направления ${program.directionCode}.`);
  }
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-09T12:00:00+03:00") });
  await clearPocStorage(page);
});

test("live comparison preserves program-scoped admission and curriculum facts", async ({ page, diagnostics }) => {
  test.setTimeout(45_000);
  await page.goto("/programs");
  await expect(page.getByRole("heading", { name: "Каталог программ" })).toBeVisible();
  const program = await discoverLiveCurriculumProgram(page);

  const card = page.getByRole("article").filter({ hasText: program.code }).first();
  await expect(card.getByRole("heading", { level: 2, name: program.name, exact: true })).toBeVisible();
  const addButton = card.getByRole("button", { name: /Сравнить/ });
  await expect(addButton).toHaveAttribute("aria-pressed", "false");
  await addButton.click();
  await expect(card.getByRole("button", { name: /В сравнении/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("В сравнении 1 из 3 программа")).toBeVisible();
  expectLiveApiCalls(diagnostics, catalogEndpoints);

  await page.getByRole("link", { name: /Открыть сравнение/ }).click();
  await expect(page).toHaveURL(/\/compare$/);
  await expect(page.getByRole("heading", { name: "Сравни программы" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Выбранные программы" })).toBeVisible();
  await expect(page.getByText("1 / 3")).toBeVisible();
  await expect(page.getByRole("button", { name: `Убрать программу ${program.code} из сравнения` })).toBeVisible();

  await expect(page.getByRole("heading", { name: "Куда уходит учебное время" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Матрица предметов" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Места и проходные баллы" })).toBeVisible();
  const admissionTable = page.getByRole("table", { name: "Сравнение мест и условий приёма в выбранные программы." });
  await expect(admissionTable).toBeVisible();
  await expect(admissionTable.locator("tbody tr")).toHaveCount(7);
  await expect(admissionTable).toContainText(/Количество не указано|Не указано|не указаны|не найдено|не найдены|не указана|Сведения о приёме недоступны|мест|баллов|₽/i);
  expectSuccessfulAdmissionCalls(diagnostics.apiResponses);
  await expectSeededAdmissionFacts(page, program, admissionTable);
  // Compute the workload from the FastAPI study-plan items above, independently
  // of the React comparison model, then check that the chart exposes that sum.
  const expectedHours = program.expectedHours;
  const categoryCard = page.locator("section[aria-labelledby='category-title'] article").filter({ hasText: program.code });
  await expect(categoryCard).toHaveAttribute("data-plan-key", program.planKey);
  await expect(categoryCard.getByRole("heading", { name: program.name, exact: true })).toBeVisible();
  const categoryChart = categoryCard.getByRole("group", { name: new RegExp("Распределение программы " + escapeRegExp(program.code)) });
  await expect(categoryChart).toBeVisible();
  if (expectedHours !== null) {
    const expectedText = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(expectedHours) + " ч.";
    await expect(categoryCard.locator("header").first()).toContainText(expectedText);
  }
  const renderedSegments = await categoryChart.locator("circle[role='button'][data-chart-category-code]").evaluateAll((elements) => (
    elements.map((element) => ({
      categoryCode: element.getAttribute("data-chart-category-code") ?? "",
      dashArray: element.getAttribute("stroke-dasharray") ?? "",
    }))
  ));
  if (!program.expectedCategoryHours.length || expectedHours === null || expectedHours <= 0) {
    expect(renderedSegments, "the chart must not invent classified categories when the active plan has none").toHaveLength(0);
  } else {
    expect(renderedSegments.map(({ categoryCode }) => categoryCode).sort())
      .toEqual(program.expectedCategoryHours.map(({ categoryCode }) => categoryCode).sort());
    const circumference = 2 * Math.PI * 75;
    for (const segment of renderedSegments) {
      const expected = program.expectedCategoryHours.find(({ categoryCode }) => categoryCode === segment.categoryCode);
      expect(expected, `${segment.categoryCode} is present in the independent API workload totals`).toBeDefined();
      if (!expected) continue;
      const [actualLength, actualGap] = segment.dashArray.split(/\s+/).map(Number);
      const proportionalLength = circumference * expected.hours / expectedHours;
      const expectedLength = Math.min(circumference, Math.max(.7, proportionalLength - .4));
      expect(actualLength, `${segment.categoryCode} chart segment encodes its independently summed API hours`).toBeCloseTo(expectedLength, 2);
      expect(actualGap, `${segment.categoryCode} chart gap preserves the same workload proportion`).toBeCloseTo(circumference - proportionalLength, 2);
    }
  }

  await page.getByText(/Показать сравнение по \d+ семестрам/).click();
  const workloadControls = page.getByRole("group", { name: "Единица нагрузки" });
  await workloadControls.getByRole("button", { name: "Часы" }).click();
  await expect(workloadControls.getByRole("button", { name: "Часы" })).toHaveAttribute("aria-pressed", "true");
  if (program.expectedHours !== null) await expectSemesterTotal(page, program.code, "ч.", program.expectedHours);
  const creditSwitch = workloadControls.getByRole("button", { name: "Зачётные единицы" });
  await creditSwitch.click();
  await expect(creditSwitch).toHaveAttribute("aria-pressed", "true");
  if (program.expectedCredits !== null) await expectSemesterTotal(page, program.code, "з.е.", program.expectedCredits);

  const detailsButton = page.getByRole("button", { name: /Подробнее о категории/ }).first();
  await detailsButton.click();
  const categoryDialog = page.getByRole("dialog");
  await expect(categoryDialog).toBeVisible();
  await expect(categoryDialog.getByRole("heading").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(categoryDialog).toBeHidden();

  await page.getByText("Открыть таблицу и фильтры", { exact: true }).click();
  const matrix = page.getByRole("table", { name: "Матрица дисциплин по выбранным образовательным программам." });
  await expect(matrix.getByRole("row").filter({ hasText: program.courseName }).first()).toBeVisible();
  const matrixResult = page.getByText(/Показано \d+ из \d+ названий\./);
  const initialMatrixCount = await matrixResult.innerText();
  const matrixSearch = page.getByRole("searchbox", { name: "Найти дисциплину или категорию" });
  await matrixSearch.fill("__andromeda_no_such_course__");
  await expect(matrixResult).toContainText("Показано 0 из");
  await matrixSearch.fill("");
  await expect(matrixResult).toHaveText(initialMatrixCount);

  expectLiveApiCalls(diagnostics, [...catalogEndpoints, "/api/v1/study-plans"]);
  expectSuccessfulAdmissionCalls(diagnostics.apiResponses);
  expectHealthyBrowser(diagnostics);
});

test("a live catalog choice persists into a one-program comparison after refresh", async ({ page, diagnostics }) => {
  // This scenario checks persistence and successful hydration after a hard
  // refresh. Refresh as soon as the selected program is rendered so the test
  // measures the restored load once, rather than serializing two full compare
  // loads along with the detailed curriculum assertions above.
  test.setTimeout(45_000);
  await page.goto("/programs");
  await expect(page.getByRole("heading", { name: "Каталог программ" })).toBeVisible();
  const program = await discoverLiveCurriculumProgram(page);
  const card = page.getByRole("article").filter({ hasText: program.code }).first();
  await card.getByRole("button", { name: /Сравнить/ }).click();
  await expect(card.getByRole("button", { name: /В сравнении/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("link", { name: /Открыть сравнение/ }).click();
  await expect(page).toHaveURL(/\/compare$/);
  await expect(page.getByRole("heading", { name: "Выбранные программы" })).toBeVisible();
  await expect(page.getByRole("button", { name: `Убрать программу ${program.code} из сравнения` })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Куда уходит учебное время" })).toBeVisible();
  await expect(page.getByText("1 / 3")).toBeVisible();
  const removeProgramButton = page.getByRole("button", { name: `Убрать программу ${program.code} из сравнения` });
  await expect(removeProgramButton).toBeVisible();
  expectLiveApiCalls(diagnostics, [...catalogEndpoints, "/api/v1/study-plans"]);
  expectSuccessfulAdmissionCalls(diagnostics.apiResponses);
  expectHealthyBrowser(diagnostics);

  await page.evaluate(() => {
    const nativeSetItem = Storage.prototype.setItem;
    Object.defineProperty(Storage.prototype, "setItem", {
      configurable: true,
      value(key: string, value: string) {
        if (key === "andromeda.compare.v1") {
          throw new DOMException("Storage quota exceeded", "QuotaExceededError");
        }
        nativeSetItem.call(this, key, value);
      },
    });
  });
  await removeProgramButton.click();
  await expect(page.getByRole("alert")).toContainText("Список не изменён");
  await expect(removeProgramButton).toBeVisible();
});

test("favorite selection stays synchronized in browser storage after a refresh", async ({ page, diagnostics }) => {
  await page.goto("/programs");
  const program = await discoverLiveCurriculumProgram(page);
  const card = page.getByRole("article").filter({ hasText: program.code }).first();
  await card.locator("summary").click();
  await expect(card.getByRole("heading", { name: /Места и условия поступления/ })).toBeVisible();
  const favorite = card.getByRole("button", { name: /Добавить в избранное/ });
  await favorite.click();
  await expect(card.getByRole("button", { name: /Убрать из избранного/ })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("andromeda.favorites.v1")))
    .toBe(JSON.stringify([program.externalKey]));

  // The expanded card loads admission facts. Let those real API reads settle
  // before exercising refresh persistence; otherwise browser navigation
  // cancellation codes differ between Chromium and Firefox.
  await page.waitForLoadState("networkidle");
  await page.reload();
  const reloadedCard = page.getByRole("article").filter({ hasText: program.code }).first();
  await reloadedCard.locator("summary").click();
  await expect(reloadedCard.getByRole("heading", { name: /Места и условия поступления/ })).toBeVisible();
  await expect(reloadedCard.getByRole("button", { name: /Убрать из избранного/ })).toHaveAttribute("aria-pressed", "true");
  await page.waitForLoadState("networkidle");
  expectLiveApiCalls(diagnostics, catalogEndpoints);
  expectHealthyBrowser(diagnostics);
});

test("two live programs keep their own plans, chart totals, matrix columns, and selection after reload", async ({ page, diagnostics }) => {
  await page.goto("/programs");
  await expect(page.getByRole("heading", { level: 1, name: "Каталог программ" })).toBeVisible();
  const [first, second] = await discoverLiveCurriculumPrograms(page, 2);
  if (!first || !second) throw new Error("Two independently verified curriculum programs were not discovered.");
  expect(first.externalKey).not.toBe(second.externalKey);
  expect(second.releaseKey).toBe(first.releaseKey);

  for (const program of [first, second]) {
    const card = page.getByRole("article").filter({ hasText: program.code }).first();
    await card.getByRole("button", { name: /Сравнить/ }).click();
    await expect(card.getByRole("button", { name: /В сравнении/ })).toHaveAttribute("aria-pressed", "true");
  }
  await expect(page.getByText("В сравнении 2 из 3 программы")).toBeVisible();
  await page.getByRole("link", { name: /Открыть сравнение/ }).click();
  await expect(page.getByText("2 / 3")).toBeVisible();

  const chartCards = page.locator("section[aria-labelledby='category-title'] article");
  await expect(chartCards).toHaveCount(2);
  for (const program of [first, second]) {
    const chartCard = chartCards.filter({ hasText: program.code });
    await expect(chartCard).toHaveAttribute("data-plan-key", program.planKey);
    await expect(chartCard.getByRole("heading", { name: program.name, exact: true })).toBeVisible();
    const chart = chartCard.getByRole("group", { name: new RegExp("Распределение программы " + escapeRegExp(program.code)) });
    await expect(chart).toBeVisible();
    if (program.expectedHours !== null) {
      const formatted = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(program.expectedHours) + " ч.";
      await expect(chartCard.locator("header").first()).toContainText(formatted);
    }
  }

  const matrix = page.getByRole("table", { name: "Матрица дисциплин по выбранным образовательным программам." });
  await page.getByText("Открыть таблицу и фильтры", { exact: true }).click();
  const headerTexts = await matrix.locator("thead th").allInnerTexts();
  expect(headerTexts[1]).toContain(first.code);
  expect(headerTexts[2]).toContain(second.code);
  for (const [index, program] of [first, second].entries()) {
    const courseRow = matrix.getByRole("row").filter({ hasText: program.courseName }).first();
    await expect(courseRow, `${program.code} course row`).toBeVisible();
    const values = courseRow.locator("td");
    await expect(values.nth(index), `${program.code} curriculum item must stay in its own column`).not.toContainText("Нет позиции с таким названием");
  }

  await page.reload();
  await expect(page.getByText("2 / 3")).toBeVisible();
  await expect(page.getByRole("button", { name: `Убрать программу ${first.code} из сравнения` })).toBeVisible();
  await expect(page.getByRole("button", { name: `Убрать программу ${second.code} из сравнения` })).toBeVisible();
  expectSuccessfulAdmissionCalls(diagnostics.apiResponses);
  expectLiveApiCalls(diagnostics, [...catalogEndpoints, "/api/v1/study-plans"]);
  expectHealthyBrowser(diagnostics);
});
