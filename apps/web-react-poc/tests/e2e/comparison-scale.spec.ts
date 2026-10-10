import type { Page, Route } from "@playwright/test";
import {
  discoverLiveCurriculumProgram,
  expect,
  expectHealthyBrowser,
  test,
} from "./fixtures";

declare global {
  interface Window {
    __andromedaQaComparisonProfiling?: boolean;
  }
}

interface ApiPageBody {
  readonly items: readonly Record<string, unknown>[];
  readonly page: {
    readonly limit: number;
    readonly next_cursor: string | null;
    readonly total_count: number | null;
    readonly release_key: string;
  };
}

interface RouteScenarioStats {
  readonly rows: number;
  planRequestCount: number;
  itemPageCount: number;
  planResponseBytes: number;
  itemResponseBytes: number;
}

interface ScaleMeasurement extends RouteScenarioStats {
  readonly readinessMs: number;
  readonly curriculumModelMs: number;
  readonly matrixDisclosureLayoutMs: number;
  readonly renderedRows: number;
  readonly stageMeasures: readonly { readonly name: string; readonly durationMs: number }[];
}

const PAGE_SIZE = 100;
const ROW_COUNTS = [100, 500, 1000] as const;
const PAGE_CURSOR_PREFIX = "qa-comparison-scale-offset-";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function apiPageBody(value: unknown, label: string): ApiPageBody {
  if (!isRecord(value) || !Array.isArray(value.items) || !isRecord(value.page)) {
    throw new Error(`${label} returned an invalid API page envelope.`);
  }
  const page = value.page;
  if (
    typeof page.limit !== "number"
    || typeof page.release_key !== "string"
    || typeof page.total_count !== "number"
    || (page.next_cursor !== undefined && page.next_cursor !== null && typeof page.next_cursor !== "string")
  ) {
    throw new Error(`${label} returned invalid pagination metadata.`);
  }
  const items = value.items.filter(isRecord);
  if (items.length !== value.items.length) throw new Error(`${label} returned a non-object record.`);
  return {
    items,
    page: {
      limit: page.limit,
      next_cursor: typeof page.next_cursor === "string" ? page.next_cursor : null,
      total_count: page.total_count,
      release_key: page.release_key,
    },
  };
}

async function readLiveCollection(
  page: Page,
  pathname: string,
  query: URLSearchParams,
  expectedReleaseKey: string,
): Promise<readonly Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let expectedTotal: number | null = null;

  do {
    const pageQuery = new URLSearchParams(query);
    pageQuery.set("limit", String(PAGE_SIZE));
    if (cursor) pageQuery.set("cursor", cursor);
    const response = await page.request.get(`${pathname}?${pageQuery.toString()}`);
    expect(response.status(), `${pathname} must return live API data`).toBe(200);
    const body = apiPageBody(await response.json() as unknown, pathname);
    expect(body.page.release_key, `${pathname} release identity`).toBe(expectedReleaseKey);
    if (expectedTotal === null) expectedTotal = body.page.total_count;
    expect(body.page.total_count, `${pathname} total_count must remain stable while paging`).toBe(expectedTotal);
    items.push(...body.items);
    cursor = body.page.next_cursor;
    if (cursor !== null) {
      expect(seenCursors.has(cursor), `${pathname} must not repeat a cursor`).toBe(false);
      seenCursors.add(cursor);
    }
  } while (cursor !== null);

  expect(items, `${pathname} must return all declared rows`).toHaveLength(expectedTotal ?? 0);
  return items;
}

function jsonBody(items: readonly Record<string, unknown>[], releaseKey: string, totalCount: number, nextCursor: string | null): string {
  return JSON.stringify({
    items,
    page: {
      limit: PAGE_SIZE,
      next_cursor: nextCursor,
      total_count: totalCount,
      release_key: releaseKey,
    },
  });
}

async function installCurriculumOverrides(
  page: Page,
  options: {
    readonly programKey: string;
    readonly planKey: string;
    readonly releaseKey: string;
    readonly livePlan: Record<string, unknown>;
    readonly liveItemTemplate: Record<string, unknown>;
    readonly stats: Map<number, RouteScenarioStats>;
    readonly getRowCount: () => number;
  },
): Promise<void> {
  await page.route("**/api/v1/study-plans**", async (route: Route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }

    const url = new URL(route.request().url());
    const pathname = decodeURIComponent(url.pathname);
    const rowCount = options.getRowCount();
    const stats = options.stats.get(rowCount);
    if (!stats) {
      await route.continue();
      return;
    }

    if (pathname === "/api/v1/study-plans" && url.searchParams.get("program_key") === options.programKey) {
      const responsePlan = { ...options.livePlan, item_count: rowCount };
      const body = jsonBody([responsePlan], options.releaseKey, 1, null);
      stats.planRequestCount += 1;
      stats.planResponseBytes += Buffer.byteLength(body, "utf8");
      await route.fulfill({ status: 200, contentType: "application/json", body });
      return;
    }

    if (pathname === `/api/v1/study-plans/${options.planKey}/items`) {
      const cursor = url.searchParams.get("cursor");
      const offset = cursor === null
        ? 0
        : Number(cursor.startsWith(PAGE_CURSOR_PREFIX) ? cursor.slice(PAGE_CURSOR_PREFIX.length) : Number.NaN);
      if (!Number.isInteger(offset) || offset < 0 || offset >= rowCount) {
        await route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "invalid_cursor", message: "Invalid synthetic test cursor." } }),
        });
        return;
      }

      const end = Math.min(offset + PAGE_SIZE, rowCount);
      const items = Array.from({ length: end - offset }, (_, index) => {
        const ordinal = offset + index + 1;
        return {
          ...options.liveItemTemplate,
          external_key: `qa:comparison-scale:${rowCount}:${ordinal}`,
          study_plan_key: options.planKey,
          ordinal,
          discipline_name: `Тестовая дисциплина ${rowCount} · ${String(ordinal).padStart(4, "0")}`,
        };
      });
      const nextCursor = end < rowCount ? `${PAGE_CURSOR_PREFIX}${end}` : null;
      const body = jsonBody(items, options.releaseKey, rowCount, nextCursor);
      stats.itemPageCount += 1;
      stats.itemResponseBytes += Buffer.byteLength(body, "utf8");
      await route.fulfill({ status: 200, contentType: "application/json", body });
      return;
    }

    await route.continue();
  });
}

async function readComparisonStageMeasures(page: Page): Promise<readonly { readonly name: string; readonly durationMs: number }[]> {
  return page.evaluate(() => performance.getEntriesByType("measure")
    .filter((entry) => entry.name.startsWith("andromeda:comparison:stage:"))
    .map((entry) => ({ name: entry.name, durationMs: Number(entry.duration.toFixed(2)) })));
}

test("@scale measures real comparison rendering with 100, 500, and 1000 curriculum rows", async ({ page, diagnostics }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Stress timings are collected in Chromium for a consistent browser engine.");
  test.setTimeout(180_000);

  await page.goto("/programs");
  const program = await discoverLiveCurriculumProgram(page);
  expect(program.releaseKey).toBeTruthy();

  const programPlans = await readLiveCollection(
    page,
    "/api/v1/study-plans",
    new URLSearchParams({ program_key: program.externalKey }),
    program.releaseKey,
  );
  const livePlan = programPlans.find((plan) => plan.external_key === program.planKey);
  expect(livePlan, "the discovered verified plan must be present in its program-scoped API response").toBeDefined();
  if (!livePlan) throw new Error("The live API did not return the discovered study plan.");
  expect(livePlan.program_key).toBe(program.externalKey);
  expect(livePlan.status).toBe("parsed");
  expect(livePlan.profile_link_status).toBe("verified");

  const itemPath = `/api/v1/study-plans/${encodeURIComponent(program.planKey)}/items`;
  const firstItemResponse = await page.request.get(`${itemPath}?limit=${PAGE_SIZE}`);
  expect(firstItemResponse.status(), "the original plan must expose at least one live item").toBe(200);
  const liveItemPage = apiPageBody(await firstItemResponse.json() as unknown, itemPath);
  expect(liveItemPage.page.release_key).toBe(program.releaseKey);
  expect(liveItemPage.items.length).toBeGreaterThan(0);
  expect(liveItemPage.items.every((item) => item.study_plan_key === program.planKey)).toBe(true);
  expect(typeof livePlan.item_count).toBe("number");
  expect(liveItemPage.page.total_count).toBe(livePlan.item_count);
  const liveItemTemplate = liveItemPage.items[0];
  if (!liveItemTemplate) throw new Error("The live plan has no curriculum item to use as a realistic template.");

  const statsBySize = new Map<number, RouteScenarioStats>(ROW_COUNTS.map((rows) => [rows, {
    rows,
    planRequestCount: 0,
    itemPageCount: 0,
    planResponseBytes: 0,
    itemResponseBytes: 0,
  }]));
  let activeRowCount: number = ROW_COUNTS[0];
  await page.addInitScript((programKey: string) => {
    window.__andromedaQaComparisonProfiling = true;
    localStorage.setItem("andromeda.compare.v1", JSON.stringify([programKey]));
  }, program.externalKey);
  await installCurriculumOverrides(page, {
    programKey: program.externalKey,
    planKey: program.planKey,
    releaseKey: program.releaseKey,
    livePlan,
    liveItemTemplate,
    stats: statsBySize,
    getRowCount: () => activeRowCount,
  });

  const measurements: ScaleMeasurement[] = [];
  for (const rows of ROW_COUNTS) {
    activeRowCount = rows;
    const response = await page.goto("/compare", { waitUntil: "domcontentloaded" });
    expect(response?.status(), `comparison route HTTP status at ${rows} rows`).toBe(200);
    await expect(page.getByRole("heading", { name: "Куда уходит учебное время" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Матрица предметов" })).toBeVisible();
    await expect(page.locator('[data-qa="active-release-key"]')).toHaveText(program.releaseKey);
    await expect(page.locator(`article[data-program-key="${program.externalKey}"]`)).toHaveAttribute("data-plan-key", program.planKey);

    const readinessMs = await page.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      return Number((navigation ? performance.now() - navigation.startTime : Number.NaN).toFixed(2));
    });
    const curriculumModelMs = await page.evaluate(() => {
      const entries = performance.getEntriesByName("andromeda:comparison:stage:curriculum-model");
      return Number((entries.at(-1)?.duration ?? Number.NaN).toFixed(2));
    });
    expect(Number.isFinite(readinessMs)).toBe(true);
    expect(Number.isFinite(curriculumModelMs), "comparison model profiling must be enabled for this measurement").toBe(true);

    const details = page.locator("details").filter({ has: page.getByText("Открыть таблицу и фильтры", { exact: true }) });
    const isOpenBeforeExpansion = await details.evaluate((element) => (element as HTMLDetailsElement).open);
    const summary = page.getByText("Открыть таблицу и фильтры", { exact: true });
    const renderMeasurement = page.evaluate(() => new Promise<{ readonly durationMs: number; readonly rows: number }>((resolve, reject) => {
      const detailsElement = [...document.querySelectorAll("details")].find((element) => (
        element.querySelector("summary")?.textContent?.trim() === "Открыть таблицу и фильтры"
      ));
      if (!detailsElement) {
        reject(new Error("The comparison matrix details element is missing."));
        return;
      }
      const finish = (startedAt: number) => {
        requestAnimationFrame(() => {
          const table = detailsElement.querySelector("table");
          const bounds = table?.getBoundingClientRect();
          // Reading the bounds forces layout for the expanded table before this sample ends.
          void bounds?.height;
          resolve({
            durationMs: Number((performance.now() - startedAt).toFixed(2)),
            rows: table?.querySelectorAll("tbody > tr").length ?? 0,
          });
        });
      };
      if (detailsElement.open) {
        finish(performance.now());
        return;
      }
      const startedAt = performance.now();
      detailsElement.addEventListener("toggle", () => finish(startedAt), { once: true });
    }));
    if (!isOpenBeforeExpansion) await summary.click();
    const renderResult = await renderMeasurement;
    const matrix = page.getByRole("table", { name: "Матрица дисциплин по выбранным образовательным программам." });
    await expect(matrix).toBeVisible();
    await expect(page.getByText(`Показано ${rows} из ${rows} названий.`, { exact: true })).toBeVisible();
    const renderedRows = await matrix.locator("tbody > tr").count();
    expect(renderedRows, `rendered matrix row count for ${rows} synthetic items`).toBe(rows);
    expect(renderResult.rows, `browser layout row count for ${rows} synthetic items`).toBe(rows);
    const routeStats = statsBySize.get(rows);
    if (!routeStats) throw new Error(`No route statistics were collected for ${rows} rows.`);
    expect(routeStats.planRequestCount).toBe(1);
    expect(routeStats.itemPageCount).toBe(Math.ceil(rows / PAGE_SIZE));
    expect(routeStats.planResponseBytes).toBeGreaterThan(0);
    expect(routeStats.itemResponseBytes).toBeGreaterThan(0);

    measurements.push({
      ...routeStats,
      readinessMs,
      curriculumModelMs,
      matrixDisclosureLayoutMs: renderResult.durationMs,
      renderedRows,
      stageMeasures: await readComparisonStageMeasures(page),
    });
  }

  expectHealthyBrowser(diagnostics);
  await testInfo.attach("comparison-scale-measurements.json", {
    body: Buffer.from(JSON.stringify({
      browser: "Chromium",
      liveProgram: {
        externalKey: program.externalKey,
        code: program.code,
        planKey: program.planKey,
        releaseKey: program.releaseKey,
      },
      dataSource: "FastAPI/PostgreSQL live release, with route overrides limited to this program's study-plan and study-plan-items GET responses",
      syntheticRows: "Each generated row clones one real item from the discovered verified plan and changes its unique key, ordinal, and name. Program, plan, release, pagination, and remaining item fields are preserved.",
      timingMethod: "Readiness is navigation start to visible comparison content and includes React creation of all matrix rows, which are already in the DOM inside the closed details disclosure. Curriculum-model duration comes from the opt-in Performance.measure stage. Matrix disclosure layout duration starts when the details toggle is observed and ends on the next animation frame after layout is forced; it is not a React mount/reconciliation timing. No fixed delay or timing threshold is used.",
      measurements,
    }, null, 2)),
    contentType: "application/json",
  });
});
