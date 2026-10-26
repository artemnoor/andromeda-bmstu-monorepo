import type { Page } from "@playwright/test";
import bviReview from "../../docs/data/bvi-orders-20261020.json" with { type: "json" };
import {
  clearPocStorage,
  discoverLiveCurriculumProgram,
  discoverLiveCurriculumPrograms,
  expect,
  expectHealthyBrowser,
  expectLiveApiCalls,
  test,
} from "./fixtures";
import type { LiveCurriculumProgram } from "./fixtures";

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

async function expectSeededAdmissionFacts(page: Page, program: { readonly directionKey: string; readonly directionCode: string | null; readonly releaseKey: string }, admission: ReturnType<Page["locator"]>): Promise<void> {
  // The program DTO does not duplicate the direction code; resolve the exact
  // direction key instead of inferring it from a profile display code.
  const directionsResponse = await page.request.get("/api/v1/directions?limit=100");
  expect(directionsResponse.status()).toBe(200);
  const directions = await directionsResponse.json();
  expect(directions.page.release_key).toBe(program.releaseKey);
  expect(directions.page.next_cursor).toBeNull();
  const directionCode = directions.items.find((item: { external_key: string }) => item.external_key === program.directionKey)?.code;
  expect(typeof directionCode).toBe("string");
  if (typeof directionCode !== "string") throw new Error("Selected program has no exact direction record.");
  const query = new URLSearchParams({ kind: "historical", year: "2026", direction_code: directionCode, limit: "100" });
  const response = await page.request.get(`/api/v1/statistics?${query}`);
  expect(response.status()).toBe(200);
  const body = await response.json() as {
    items: { statistic_kind: string; funding_type: string; minimum_score: string | null; scope_type: string; scope_label: string; sources: { source_url: string }[] }[];
    page: { release_key: string; next_cursor: string | null };
  };
  expect(body.page.release_key).toBe(program.releaseKey);
  expect(body.page.next_cursor, "the exact-year fixture must be complete").toBeNull();
  const official = body.items.filter((item) => item.statistic_kind === "official_program_card_passing_score");
  expect(official).toHaveLength(2);
  const table = admission.getByRole("table", { name: /Проходные баллы по официальной карточке/ });
  for (const [funding, label] of [["budget", "Бюджет"], ["paid", "Платное обучение"]] as const) {
    const record = official.find((item) => item.funding_type === funding);
    expect(record).toBeDefined();
    if (!record) throw new Error(`Missing official ${funding} record`);
    expect(record.scope_type).toBe("direction");
    expect(record.scope_label).toBe(directionCode);
    const cell = table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: label, exact: true }) }).getByRole("cell");
    const source = record.sources.find((item) => item.source_url.startsWith("https://api.www.bmstu.ru/majors/"));
    expect(source, "official score provenance must point to a major card").toBeDefined();
    if (record.minimum_score === null) {
      const bvi = funding === "budget" ? bviReview.directions.find((item) => item.directionCode === directionCode && item.verdict === "bvi_outside_quotas") : undefined;
      await expect(cell.locator("strong")).toHaveText(bvi ? "БВИ вне квот" : "Не опубликован");
      if (bvi) await expect(cell.getByRole("link", { name: "Приказ о зачислении БВИ" })).toHaveAttribute("href", bvi.bviSource!);
    } else {
      await expect(cell.locator("strong")).toHaveText(`${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(Number(record.minimum_score))} баллов`);
      await expect(cell).toContainText(`Всё направление ${directionCode}`);
    }
    await expect(cell.getByRole("link", { name: "Источник" })).toHaveAttribute("href",
      `https://bmstu.ru/bachelor/majors/${new URL(source!.source_url).pathname.split("/").at(-1)}`);
    if (funding !== "budget" || !bviReview.directions.some((item) => item.directionCode === directionCode && item.verdict === "bvi_outside_quotas")) await expect(cell).not.toContainText("БВИ");
  }
  const campaigns = await page.request.get("/api/v1/campaigns?year=2026&limit=100");
  expect(campaigns.status()).toBe(200);
  const campaignBody = await campaigns.json();
  expect(campaignBody.page.release_key).toBe(program.releaseKey);
  const campaign = campaignBody.items.find((item: { campaign_kind: string }) => item.campaign_kind === "admission");
  expect(campaign).toBeDefined();
  const requirementQuery = new URLSearchParams({ campaign_key: campaign.external_key, direction_key: program.directionKey, limit: "100" });
  const requirementResponse = await page.request.get(`/api/v1/requirements?${requirementQuery}`);
  expect(requirementResponse.status()).toBe(200);
  const requirements = await requirementResponse.json();
  expect(requirements.page.release_key).toBe(program.releaseKey);
  const subjects = requirements.items.flatMap((item: { root: unknown }) => collectRequirementSubjects(item.root));
  expect(subjects.length).toBeGreaterThan(0);
  await expect(admission).toContainText(subjects[0]!);
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
  const addButton = card.getByRole("button", { name: "Добавить в сравнение", exact: true });
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
  await expect(page.getByRole("heading", { name: "Поступление", exact: true })).toBeVisible();
  const admission = page.locator('[data-qa="admission-summary"]');
  await expect(admission).toHaveAttribute("data-unavailable-count", "0");
  const enrollmentTable = admission.getByRole("table", { name: /Зачислено на всё направление подготовки/ });
  await expect(enrollmentTable.locator("tbody tr")).toHaveCount(5);
  const scoreTable = admission.getByRole("table", { name: /Проходные баллы по официальной карточке/ });
  await expect(scoreTable.locator("tbody tr")).toHaveCount(2);
  for (const label of ["В том числе · отдельная квота", "В том числе · особая квота", "В том числе · целевая квота"]) {
    await expect(enrollmentTable.getByRole("rowheader", { name: label, exact: true })).toBeVisible();
  }
  expectSuccessfulAdmissionCalls(diagnostics.apiResponses);
  await expectSeededAdmissionFacts(page, program, admission);
  // Compute the workload from the FastAPI study-plan items above, independently
  // of the React comparison model, then check that the chart exposes that sum.
  const expectedHours = program.expectedHours;
  const categoryCard = page.locator("section[aria-labelledby='category-title'] article").filter({ hasText: program.code });
  await expect(categoryCard).toHaveAttribute("data-plan-key", program.planKey);
  await expect(categoryCard.getByRole("heading", { name: program.name, exact: true })).toBeVisible();
  const categoryChart = categoryCard.getByRole("group", { name: new RegExp("Распределение программы " + escapeRegExp(program.code)) });
  await expect(categoryChart).toBeVisible();
  if (expectedHours !== null) {
    await expect(categoryCard).toHaveAttribute("data-total-hours", String(expectedHours));
  }
  const renderedSegments = await categoryChart.locator("[role='button'][data-chart-category-code]").evaluateAll((elements) => (
    elements.map((element) => ({
      categoryCode: element.getAttribute("data-chart-category-code") ?? "",
      hours: Number(element.getAttribute("data-chart-hours")),
      startAngle: Number(element.getAttribute("data-chart-start-angle")),
      endAngle: Number(element.getAttribute("data-chart-end-angle")),
      paddingAngle: Number(element.getAttribute("data-chart-padding-angle")),
      sliceCount: Number(element.getAttribute("data-chart-slice-count")),
    }))
  ));
  if (!program.expectedCategoryHours.length || expectedHours === null || expectedHours <= 0) {
    expect(renderedSegments, "the chart must not invent classified categories when the active plan has none").toHaveLength(0);
  } else {
    expect(renderedSegments.map(({ categoryCode }) => categoryCode).sort())
      .toEqual(program.expectedCategoryHours.map(({ categoryCode }) => categoryCode).sort());
    for (const segment of renderedSegments) {
      const expected = program.expectedCategoryHours.find(({ categoryCode }) => categoryCode === segment.categoryCode);
      expect(expected, `${segment.categoryCode} is present in the independent API workload totals`).toBeDefined();
      if (!expected) continue;
      expect(segment.hours, `${segment.categoryCode} chart exposes its independently summed API hours`).toBeCloseTo(expected.hours, 2);
      const angleBudget = 360 - segment.sliceCount * segment.paddingAngle;
      const expectedSweep = angleBudget * expected.hours / expectedHours;
      expect(Math.abs(segment.endAngle - segment.startAngle), `${segment.categoryCode} sector angle encodes its API hours proportion`).toBeCloseTo(expectedSweep, 2);
    }
  }

  const workloadChart = page.getByRole("group", { name: "Сравнение нагрузки по семестрам" });
  await expect(workloadChart).toBeVisible();
  await expect(workloadChart.locator(".recharts-wrapper")).toBeVisible();

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
  await card.getByRole("button", { name: "Добавить в сравнение", exact: true }).click();
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

test("catalog details open through Подробнее and remain available after a refresh", async ({ page, diagnostics }) => {
  await page.goto("/programs");
  const program = await discoverLiveCurriculumProgram(page);
  const card = page.getByRole("article").filter({ hasText: program.code }).first();
  await card.getByRole("link", { name: "Подробнее ↗" }).click();
  await expect(page).toHaveURL(/\/programs\/[\w.-]+$/);
  await expect(page.getByRole("heading", { name: "Приёмная кампания", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Содержание программы", exact: true })).toBeVisible();
  await expect(page.locator("main > header").getByRole("button", { name: /избранное/i })).toHaveCount(0);

  // The expanded card loads admission facts. Let those real API reads settle
  // before exercising refresh persistence; otherwise browser navigation
  // cancellation codes differ between Chromium and Firefox.
  await page.waitForLoadState("networkidle");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Приёмная кампания", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Назад в каталог", exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expectLiveApiCalls(diagnostics, catalogEndpoints);
  expectHealthyBrowser(diagnostics);
});

test("two live programs keep their own plans, chart totals, matrix columns, and selection after reload", async ({ page, diagnostics }) => {
  // This real-data scenario verifies several cursor-paginated endpoints and a
  // populated curriculum matrix in all three browsers against one PostgreSQL
  // service. Keep a finite but realistic budget for the slower WebKit worker.
  test.setTimeout(60_000);
  await page.goto("/programs");
  await expect(page.getByRole("heading", { level: 1, name: "Каталог программ" })).toBeVisible();
  const [first, second] = await discoverLiveCurriculumPrograms(page, 2);
  if (!first || !second) throw new Error("Two independently verified curriculum programs were not discovered.");
  expect(first.externalKey).not.toBe(second.externalKey);
  expect(second.releaseKey).toBe(first.releaseKey);

  for (const program of [first, second]) {
    const card = page.getByRole("article").filter({ hasText: program.code }).first();
    await card.getByRole("button", { name: "Добавить в сравнение", exact: true }).click();
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
      await expect(chartCard).toHaveAttribute("data-total-hours", String(program.expectedHours));
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

test("three live programs keep exact release, verified plans, and separate matrix columns", async ({ page, diagnostics }) => {
  test.setTimeout(90_000);
  await page.goto("/programs");
  await expect(page.getByRole("heading", { level: 1, name: "Каталог программ" })).toBeVisible();

  let programs: readonly LiveCurriculumProgram[];
  try {
    programs = await discoverLiveCurriculumPrograms(page, 3);
  } catch (error) {
    if (error instanceof Error && error.message.includes("needs 3 distinct programs")) {
      test.skip(true, "The isolated PostgreSQL 16 release has fewer than three independently verified curriculum programs.");
      return;
    }
    throw error;
  }
  expect(new Set(programs.map((program) => program.externalKey)).size).toBe(3);
  expect(new Set(programs.map((program) => program.planKey)).size).toBe(3);
  expect(new Set(programs.map((program) => program.releaseKey)).size).toBe(1);

  await page.evaluate((programKeys) => {
    localStorage.setItem("andromeda.compare.v1", JSON.stringify(programKeys));
  }, programs.map((program) => program.externalKey));
  const response = await page.goto("/compare", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Сравни программы" })).toBeVisible();
  await expect(page.getByText("3 / 3")).toBeVisible();
  await expect(page.locator("[data-qa=active-release-key]")).toHaveText(programs[0]!.releaseKey);
  for (const program of programs) {
    await expect(page.getByRole("button", { name: `Убрать программу ${program.code} из сравнения` })).toBeVisible();
  }

  const chartCards = page.locator("section[aria-labelledby='category-title'] article");
  await expect(chartCards).toHaveCount(3);
  for (const program of programs) {
    await expect(chartCards.filter({ hasText: program.code })).toHaveAttribute("data-plan-key", program.planKey);
  }

  await page.getByText("Открыть таблицу и фильтры", { exact: true }).click();
  const matrix = page.getByRole("table", { name: "Матрица дисциплин по выбранным образовательным программам." });
  const headers = await matrix.locator("thead th").allInnerTexts();
  for (const [index, program] of programs.entries()) {
    expect(headers[index + 1]).toContain(program.code);
    const row = matrix.getByRole("row").filter({ hasText: program.courseName }).first();
    await expect(row, `${program.code} curriculum item row`).toBeVisible();
    await expect(row.locator("td").nth(index), `${program.code} data stays in its selected program column`)
      .not.toContainText("Нет позиции с таким названием");
  }

  expectSuccessfulAdmissionCalls(diagnostics.apiResponses);
  expectLiveApiCalls(diagnostics, [...catalogEndpoints, "/api/v1/study-plans"]);
  expectHealthyBrowser(diagnostics);
});
