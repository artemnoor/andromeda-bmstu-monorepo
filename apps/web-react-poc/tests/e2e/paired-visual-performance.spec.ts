import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { expect, test } from "@playwright/test";
import type { Browser, CDPSession, Page, TestInfo } from "@playwright/test";
import { discoverLiveCurriculumProgram, discoverLiveCurriculumPrograms } from "./fixtures";
import type { LiveCurriculumProgram } from "./fixtures";

declare global {
interface Window {
  __andromedaQaLongTaskDurations?: number[];
  __andromedaQaCumulativeLayoutShift?: number;
  __andromedaQaComparisonProfiling?: boolean;
  }
}

type AppName = "vanilla" | "react";
type ScreenName = "home" | "catalog" | "empty-comparison" | "populated-comparison";
type BenchmarkName = "home" | "catalog-filter-50" | "catalog-filter-100" | "catalog-filter-500" | "compare-load";

interface ScreenRoute {
  readonly vanillaPath: string;
  readonly reactPath: string;
}

interface ApiResponseMetric {
  readonly path: string;
  readonly status: number | null;
}

interface ApiResourceMetric {
  readonly path: string;
  readonly durationMs: number;
  readonly transferBytes: number;
  readonly encodedBodyBytes: number;
  readonly decodedBodyBytes: number;
}

interface PageMetrics {
  readonly app: AppName;
  readonly scenario: BenchmarkName;
  readonly iteration: number;
  readonly readyMs: number;
  readonly fullDataReadyMs: number | null;
  readonly actionMs: number | null;
  readonly apiRequests: number;
  readonly apiResponses: readonly ApiResponseMetric[];
  readonly apiResources: readonly ApiResourceMetric[];
  readonly apiTransferBytes: number;
  readonly comparisonStageMs: Readonly<Record<string, number>>;
  readonly scriptCount: number;
  readonly scriptBytes: number;
  readonly resourceCount: number;
  readonly transferredResourceBytes: number;
  readonly longTaskCount: number;
  readonly longTaskDurationMs: number;
  readonly cumulativeLayoutShift: number;
  readonly jsHeapUsedBytes: number | null;
}

interface MeasuredRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface CategoryDistributionRowMetric {
  readonly category: string;
  readonly height: number;
  readonly headingWidth: number | null;
}

interface SemanticComparisonMetrics {
  readonly factRects: Readonly<Record<string, MeasuredRect>>;
  readonly unknownFactKeys: readonly string[];
  readonly unknownDonutFactKeys: readonly string[];
  readonly factTexts: Readonly<Record<string, string>>;
}

function isVerifiedZeroToUnknown(factKey: string, originalText: string | undefined, reactText: string | undefined): boolean {
  if (!originalText || !reactText) return false;
  const [kind] = JSON.parse(factKey) as [string, string, string];
  if (kind === "legend") {
    return /^·\s*0\s*ч\.\s*·\s*0%$/.test(originalText) && /^·\s*—\s*·\s*—$/.test(reactText);
  }
  if (kind === "distribution") {
    return originalText === "0 ч.|0%" && reactText === "—|—";
  }
  return kind === "donut" && originalText === "0%" && reactText === "—";
}

const reactBaseURL = process.env.REACT_WEB_BASE_URL
  ?? `http://127.0.0.1:${process.env.REACT_WEB_PORT ?? "4181"}`;
const vanillaBaseURL = process.env.VANILLA_WEB_BASE_URL
  ?? `http://127.0.0.1:${process.env.VANILLA_WEB_PORT ?? (process.env.CI ? "4173" : "43173")}`;

const routes: Record<ScreenName, ScreenRoute> = {
  home: { vanillaPath: "/index.html", reactPath: "/" },
  catalog: { vanillaPath: "/programs.html", reactPath: "/programs" },
  "empty-comparison": { vanillaPath: "/compare.html", reactPath: "/compare" },
  "populated-comparison": { vanillaPath: "/compare.html", reactPath: "/compare" },
};

const viewportCases = [
  { name: "desktop-1920x1080", width: 1920, height: 1080 },
  { name: "desktop-1440x900", width: 1440, height: 900 },
  { name: "desktop-1280x800", width: 1280, height: 800 },
  { name: "tablet-768x1024", width: 768, height: 1024 },
  { name: "mobile-390x844", width: 390, height: 844 },
  { name: "mobile-375x667", width: 375, height: 667 },
] as const;

let verifiedProgramPromise: Promise<LiveCurriculumProgram | null> | null = null;
let verifiedProgramSkipReason = "The isolated API release has no parsed, verified plan with numeric workload.";
let verifiedComparisonProgramsPromise: Promise<readonly LiveCurriculumProgram[] | null> | null = null;
let verifiedComparisonSkipReason = "The isolated API release needs two verified curriculum programs.";

interface ScreenshotFrame {
  readonly label: string;
  readonly buffer: Buffer;
}

function requirePairedRun(): void {
  test.skip(
    process.env.ANDROMEDA_PAIRED_QA !== "1",
    "Run paired vanilla-versus-React checks through npm run test:visual or test:benchmark.",
  );
}

function attachDiagnostics(page: Page): {
  readonly pageErrors: string[];
  readonly requestFailures: string[];
  readonly apiRequests: { path: string; status: number | null }[];
} {
  const diagnostics = {
    pageErrors: [] as string[],
    requestFailures: [] as string[],
    apiRequests: [] as { path: string; status: number | null }[],
  };
  page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    diagnostics.requestFailures.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "failed"}`);
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/v1/")) {
      diagnostics.apiRequests.push({ path: url.pathname, status: null });
    }
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/v1/")) {
      diagnostics.apiRequests.push({ path: url.pathname, status: response.status() });
    }
  });
  return diagnostics;
}

function resetDiagnostics(diagnostics: ReturnType<typeof attachDiagnostics>): void {
  diagnostics.pageErrors.length = 0;
  diagnostics.requestFailures.length = 0;
  diagnostics.apiRequests.length = 0;
}

function assertHealthy(diagnostics: ReturnType<typeof attachDiagnostics>): void {
  expect(diagnostics.pageErrors, diagnostics.pageErrors.join("\n")).toEqual([]);
  const failedRequests = diagnostics.requestFailures.filter((failure) => !failure.includes("ERR_ABORTED"));
  expect(failedRequests, failedRequests.join("\n")).toEqual([]);
  const failedApi = diagnostics.apiRequests.filter((response) => (
    response.path.startsWith("/api/v1/") && response.status !== 200
  ));
  expect(failedApi, JSON.stringify(failedApi)).toEqual([]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isMeasuredRect(value: unknown): value is MeasuredRect {
  if (typeof value !== "object" || value === null) return false;
  const rect = value as Record<string, unknown>;
  return ["x", "y", "width", "height"].every((key) => typeof rect[key] === "number");
}

function isCategoryDistributionRows(value: unknown): value is readonly CategoryDistributionRowMetric[] {
  return Array.isArray(value) && value.every((row) => (
    isRecord(row)
    && typeof row.category === "string"
    && typeof row.height === "number"
    && (typeof row.headingWidth === "number" || row.headingWidth === null)
  ));
}

function assertEquivalentRect(label: string, vanilla: unknown, react: unknown, tolerance = 2): void {
  expect(isMeasuredRect(vanilla), `${label}: original element is measurable`).toBe(true);
  expect(isMeasuredRect(react), `${label}: React element is measurable`).toBe(true);
  if (!isMeasuredRect(vanilla) || !isMeasuredRect(react)) return;
  for (const key of ["x", "y", "width", "height"] as const) {
    expect(
      Math.abs(vanilla[key] - react[key]),
      `${label} ${key} difference (original ${vanilla[key]}, React ${react[key]})`,
    ).toBeLessThanOrEqual(tolerance);
  }
}

async function waitForScreen(page: Page, app: AppName, screen: ScreenName): Promise<void> {
  if (screen === "home") {
    await expect(page.getByText("МГТУ имени Баумана × Андромеда", { exact: true })).toBeVisible();
    return;
  }

  if (screen === "catalog") {
    if (app === "vanilla") {
      await expect(page.locator("#programGrid")).toHaveAttribute("aria-busy", "false");
      await expect(page.locator("#catalogProgramTotal")).not.toHaveText("—");
      await expect(page.locator("#programGrid .error-state")).toHaveCount(0);
      await expect(page.locator("#programGrid article").first()).toBeVisible();
    } else {
      await expect(page.getByRole("heading", { name: "Все программы" })).toBeVisible();
      await expect(page.locator("[title^='Активный академический выпуск']")).toBeVisible();
      await expect(page.getByRole("article").first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Открыть меню" })).toBeVisible();
    }
    return;
  }

  if (screen === "empty-comparison") {
    if (app === "vanilla") {
      await expect(page.locator("#selectedCount")).toHaveText("0 / 3");
      await expect(page.locator("#compareContent")).toHaveAttribute("aria-busy", "false");
    } else {
      await expect(page.getByRole("button", { name: "Открыть меню" })).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: "Добавь программы для сравнения" })).toBeVisible();
    return;
  }

  if (app === "vanilla") {
    await expect(page.locator("#selectedCount")).toHaveText("1 / 3");
  } else {
    await expect(page.getByRole("heading", { name: "Сравни программы" })).toBeVisible();
    await expect(page.getByText("1 / 3")).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Матрица предметов" })).toBeVisible();
}

async function navigateAndWait(
  page: Page,
  app: AppName,
  screen: ScreenName,
  viewport: { width: number; height: number },
  catalogAnchors?: readonly number[],
): Promise<{
  frames: ScreenshotFrame[];
  catalogCodes: string[];
  catalogKeys: string[];
  catalogEntries: { code: string; name: string; externalKey: string }[];
  headings: string[];
  documentHeight: number;
  documentWidth: number;
  overflowElements: readonly { tag: string; identity: string; right: number; width: number; text: string }[];
  layout: Record<string, unknown> | null;
  routeLayout: Record<string, unknown> | null;
  semanticComparison: SemanticComparisonMetrics;
  chrome: Record<string, unknown>;
}> {
  await page.setViewportSize(viewport);
  const baseURL = app === "vanilla" ? vanillaBaseURL : reactBaseURL;
  const path = app === "vanilla" ? routes[screen].vanillaPath : routes[screen].reactPath;
  const response = await page.goto(new URL(path, baseURL).href, { waitUntil: "domcontentloaded" });
  expect(response?.status(), `${app} ${screen} HTTP status`).toBe(200);
  await waitForScreen(page, app, screen);
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
  });
  const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const overflowElements = await page.evaluate(() => {
    const candidates = [...document.querySelectorAll<HTMLElement>("body *")].flatMap((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.right <= innerWidth + 1 || rect.left >= innerWidth) return [];
      let parent = element.parentElement;
      while (parent && parent !== document.body) {
        const style = getComputedStyle(parent);
        if (["auto", "scroll"].includes(style.overflowX) && parent.scrollWidth > parent.clientWidth + 1) return [];
        parent = parent.parentElement;
      }
      const text = (element.innerText ?? "").trim().replace(/\s+/g, " ").slice(0, 100);
      return [{
        tag: element.tagName.toLowerCase(),
        identity: element.id || String(element.className || "").slice(0, 100),
        right: Number(rect.right.toFixed(1)),
        width: Number(rect.width.toFixed(1)),
        text,
      }];
    });
    return candidates.sort((left, right) => right.right - left.right).slice(0, 8);
  });
  const catalogEntries = screen !== "catalog" ? [] : app === "vanilla"
    ? await page.evaluate(async () => {
      type RecordView = { readonly external_key: unknown; readonly code: unknown; readonly name: unknown };
      const academicData = (window as Window & {
        AcademicData?: { programs: () => Promise<readonly RecordView[]> };
      }).AcademicData;
      if (!academicData) throw new Error("Original catalog did not expose its loaded academic records.");
      const records = await academicData.programs();
      const visibleCards = [...document.querySelectorAll<HTMLElement>("#programGrid article")].map((card) => ({
        code: card.querySelector(".program-code")?.textContent?.trim() ?? "",
        name: card.querySelector(".program-title")?.textContent?.trim() ?? "",
      }));
      if (visibleCards.length !== records.length) {
        throw new Error(`Original catalog renders ${visibleCards.length} cards for ${records.length} API records.`);
      }
      return records.map((record, index) => {
        const card = visibleCards[index];
        const code = typeof record.code === "string" ? record.code : "";
        const name = typeof record.name === "string" ? record.name : "";
        const externalKey = typeof record.external_key === "string" ? record.external_key : "";
        if (!card || card.code !== code || card.name !== name || !externalKey) {
          throw new Error(`Original catalog card ${index} does not match its API program identity.`);
        }
        return { code, name, externalKey };
      });
    })
    : await page.locator("article[data-program-code]").evaluateAll((elements) =>
      elements.map((element) => ({
        code: element.getAttribute("data-program-code") ?? "",
        name: element.querySelector("h2")?.textContent?.trim() ?? "",
        externalKey: element.getAttribute("data-program-key") ?? "",
      })));
  const catalogCodes = catalogEntries.map((entry) => entry.code);
  const catalogKeys = catalogEntries.map((entry) => entry.externalKey);
  const headings = await page.locator("h2:visible").evaluateAll((elements) =>
    elements.filter((element) => !element.closest("#programGrid, article[data-program-key]"))
      .map((element) => (element.textContent ?? "").trim().replace(/\s+/g, " ")));
  const semanticComparison = screen === "populated-comparison"
    ? await page.evaluate((appName): SemanticComparisonMetrics => {
      const factRects: Record<string, MeasuredRect> = {};
      const unknownFactKeys: string[] = [];
      const unknownDonutFactKeys: string[] = [];
      const factTexts: Record<string, string> = {};
      const rect = (element: Element | null): MeasuredRect | null => {
        if (!element) return null;
        const bounds = element.getBoundingClientRect();
        return {
          x: bounds.left,
          y: bounds.top + window.scrollY,
          width: bounds.width,
          height: bounds.height,
        };
      };
      const key = (kind: string, category: string, code: string) => JSON.stringify([kind, category, code]);
      const normalizedText = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
      const directTextContent = (element: Element) => [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "")
        .join("");
      const directTextRect = (element: Element): MeasuredRect | null => {
        const ranges = [...element.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
          .map((node) => {
            const range = document.createRange();
            range.selectNode(node);
            return range.getBoundingClientRect();
          });
        if (!ranges.length) return null;
        const left = Math.min(...ranges.map((bounds) => bounds.left));
        const top = Math.min(...ranges.map((bounds) => bounds.top));
        const right = Math.max(...ranges.map((bounds) => bounds.right));
        const bottom = Math.max(...ranges.map((bounds) => bounds.bottom));
        return { x: left, y: top + window.scrollY, width: right - left, height: bottom - top };
      };
      const valueParts = (element: Element) => [...element.children]
        .map((child) => normalizedText(child.textContent))
        .join("|");

      if (appName === "react") {
        for (const item of document.querySelectorAll<HTMLElement>('[data-qa="category-legend-item"]')) {
          const category = item.dataset.category ?? "";
          for (const value of item.querySelectorAll<HTMLElement>('[data-qa="category-legend-values"] [data-program-code]')) {
            const programCode = value.dataset.programCode ?? "";
            const factKey = key("legend", category, programCode);
            const bounds = directTextRect(value);
            if (bounds) factRects[factKey] = bounds;
            factTexts[factKey] = normalizedText(directTextContent(value));
            if (value.dataset.semanticState === "unknown") unknownFactKeys.push(factKey);
          }
        }
        for (const row of document.querySelectorAll<HTMLElement>('[data-qa="category-distribution-row"]')) {
          const category = row.dataset.category ?? "";
          for (const cell of row.querySelectorAll<HTMLElement>('td[data-program-code]')) {
            const unknown = cell.querySelector<HTMLElement>('[data-semantic-state="unknown"]');
            if (!unknown) continue;
            const programCode = cell.dataset.programCode ?? "";
            const factKey = key("distribution", category, programCode);
            const valueContainer = unknown.parentElement;
            const bounds = rect(valueContainer);
            if (bounds) factRects[factKey] = bounds;
            factTexts[factKey] = valueContainer ? valueParts(valueContainer) : normalizedText(unknown.textContent);
            unknownFactKeys.push(factKey);
          }
        }
        for (const card of document.querySelectorAll<HTMLElement>("[data-qa='category-chart-card']")) {
          const programCode = card.querySelector<HTMLElement>("[data-qa='category-program-code']")?.textContent?.trim() ?? "";
          const category = card.querySelector<HTMLElement>("[data-qa='category-chart-center-label']")?.textContent?.trim() ?? "";
          const value = card.querySelector<HTMLElement>("[data-qa='category-chart-center-value']");
          if (!programCode || !category || !value) continue;
          const factKey = key("donut", category, programCode);
            const bounds = directTextRect(value);
            if (bounds) factRects[factKey] = bounds;
            factTexts[factKey] = normalizedText(directTextContent(value));
          if (factTexts[factKey] === "—") unknownDonutFactKeys.push(factKey);
        }
      } else {
        for (const item of document.querySelectorAll<HTMLElement>(".category-shared-item")) {
          const category = item.querySelector<HTMLElement>(".category-shared-name")?.textContent?.trim() ?? "";
          for (const value of item.querySelectorAll<HTMLElement>(".category-shared-values > span")) {
            const programCode = value.querySelector("strong")?.textContent?.trim() ?? "";
            const bounds = directTextRect(value);
            if (bounds) factRects[key("legend", category, programCode)] = bounds;
            factTexts[key("legend", category, programCode)] = normalizedText(directTextContent(value));
          }
        }
        const table = document.querySelector<HTMLTableElement>(".category-distribution-table");
        const programCodes = table
          ? [...table.querySelectorAll<HTMLElement>("thead th")].slice(1).map((cell) => cell.querySelector(".category-program-code")?.textContent?.trim() ?? "")
          : [];
        for (const row of document.querySelectorAll<HTMLTableRowElement>(".category-distribution-table tbody tr")) {
          const category = row.querySelector<HTMLElement>(".category-row-name")?.textContent?.trim() ?? "";
          const cells = [...row.querySelectorAll<HTMLTableCellElement>("td")];
          for (const [index, cell] of cells.entries()) {
            const value = cell.querySelector<HTMLElement>(".category-distribution-values");
            if (!value) continue;
            const bounds = rect(value);
            const factKey = key("distribution", category, programCodes[index] ?? "");
            if (bounds) factRects[factKey] = bounds;
            factTexts[factKey] = valueParts(value);
          }
        }
        for (const card of document.querySelectorAll<HTMLElement>(".category-program-card")) {
          const programCode = card.querySelector<HTMLElement>(".category-program-code")?.textContent?.trim() ?? "";
          const category = card.querySelector<HTMLElement>(".category-donut-center span")?.textContent?.trim() ?? "";
          const value = card.querySelector<HTMLElement>(".category-donut-center strong");
          if (!programCode || !category || !value) continue;
          const factKey = key("donut", category, programCode);
          const bounds = rect(value);
          if (bounds) factRects[factKey] = bounds;
          factTexts[factKey] = normalizedText(value.textContent);
        }
      }
      return { factRects, unknownFactKeys, unknownDonutFactKeys, factTexts };
    }, app)
    : { factRects: {}, unknownFactKeys: [], unknownDonutFactKeys: [], factTexts: {} };
  const chrome = await page.evaluate(() => {
    const inspect = (element: HTMLElement | null) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const center = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        x: Number(rect.x.toFixed(1)),
        y: Number(rect.y.toFixed(1)),
        width: Number(rect.width.toFixed(1)),
        height: Number(rect.height.toFixed(1)),
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        zIndex: style.zIndex,
        centerTag: center?.tagName ?? null,
        centerClass: typeof center?.className === "string" ? center.className : null,
      };
    };
    return {
      brand: inspect(document.querySelector<HTMLElement>('img[src*="andromeda-symbol"]')),
      menu: inspect(document.querySelector<HTMLElement>('button[aria-label*="меню"]')),
      main: inspect(document.querySelector<HTMLElement>("main")),
    };
  });
  const layout = screen === "home" ? await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>("main#top");
    if (!main) return null;
    const measureWidth = (element: HTMLElement | null) => {
      if (!element) return null;
      const { x, width } = element.getBoundingClientRect();
      return { x: Number(x.toFixed(1)), width: Number(width.toFixed(1)) };
    };
    const measure = (selector: string) => {
      const element = main.querySelector<HTMLElement>(selector);
      if (!element) return null;
      const { top, height, x, width } = element.getBoundingClientRect();
      return {
        top: Number(top.toFixed(1)),
        height: Number(height.toFixed(1)),
        x: Number(x.toFixed(1)),
        width: Number(width.toFixed(1)),
      };
    };
    return {
      gridColumns: getComputedStyle(main).gridTemplateColumns,
      gridRows: getComputedStyle(main).gridTemplateRows,
      pagePadding: {
        left: getComputedStyle(main).paddingLeft,
        right: getComputedStyle(main).paddingRight,
      },
      viewport: { innerWidth, clientWidth: document.documentElement.clientWidth, bodyWidth: getComputedStyle(document.body).width },
      page: measureWidth(main),
      hero: measure(":scope > section:nth-of-type(1)"),
      stats: measure(":scope > section:nth-of-type(2)"),
      actions: measure("#home-actions"),
      process: measure("#how-it-works"),
      processTitle: (() => {
        const title = main.querySelector<HTMLElement>("#how-it-works h2");
        if (!title) return null;
        const style = getComputedStyle(title);
        return {
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          fontFamily: style.fontFamily,
          fontWeight: style.fontWeight,
          letterSpacing: style.letterSpacing,
          width: Number(title.getBoundingClientRect().width.toFixed(1)),
          height: Number(title.getBoundingClientRect().height.toFixed(1)),
        };
      })(),
      processHeading: measure("#how-it-works > header"),
    };
  }) : null;
  const routeLayout = screen === "catalog" || screen === "empty-comparison" || screen === "populated-comparison"
    ? await page.evaluate(() => {
      const main = document.querySelector<HTMLElement>("main");
      const measure = (element: HTMLElement | null) => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          x: Number(rect.x.toFixed(1)),
          y: Number(rect.y.toFixed(1)),
          width: Number(rect.width.toFixed(1)),
          height: Number(rect.height.toFixed(1)),
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
        };
      };
      const comparisonSections = Object.fromEntries([
        ["selection", "Выбранные программы"],
        ["admission", "Места и проходные баллы"],
        ["workload", "По семестрам"],
        ["curriculum", "Куда уходит учебное время"],
        ["matrix", "Матрица предметов"],
      ].map(([key, label]) => {
        const heading = [...(main?.querySelectorAll<HTMLElement>("h2, h3") ?? [])]
          .find((element) => (element.textContent ?? "").trim() === label);
        return [key, measure(heading?.closest<HTMLElement>("section") ?? null)];
      }));
      const distributionHeading = [...(main?.querySelectorAll<HTMLElement>("h2, h3") ?? [])]
        .find((element) => (element.textContent ?? "").trim() === "Часы по категориям");
      const distributionRows = [...(distributionHeading?.closest("section")?.querySelectorAll<HTMLTableRowElement>("tbody tr") ?? [])]
        .map((row) => {
          const heading = row.querySelector<HTMLElement>("th");
          const rect = heading?.getBoundingClientRect();
          return {
            height: Number(row.getBoundingClientRect().height.toFixed(1)),
            category: (heading?.innerText ?? "").trim().replace(/\s+/g, " "),
            headingWidth: rect ? Number(rect.width.toFixed(1)) : null,
          };
        });
      return {
        main: measure(main),
        intro: measure(main?.querySelector<HTMLElement>('section[aria-labelledby="catalog-title"], section[aria-labelledby="compare-title"], section.catalog-hero, section.compare-intro') ?? main?.querySelector<HTMLElement>("section") ?? null),
        title: measure(main?.querySelector<HTMLElement>("h1") ?? null),
        description: measure(main?.querySelector<HTMLElement>("h1 + p, .introCopy > p:last-child, .heroCopy > p:last-child") ?? null),
        content: measure(main?.querySelector<HTMLElement>('[aria-labelledby="catalog-list-title"], .catalog-panel, [data-qa="comparison-state"], .empty-state') ?? null),
        comparisonSections,
        categoryDistributionRows: distributionRows,
      };
    })
    : null;
  if (screen !== "catalog") {
    const fullPage = PNG.sync.read(await page.screenshot({ fullPage: true, animations: "disabled", caret: "hide", scale: "css" }));
    return {
      catalogCodes,
      catalogKeys,
      catalogEntries,
      headings,
      documentHeight,
      documentWidth,
      overflowElements,
      layout,
      routeLayout,
      semanticComparison,
      chrome,
      frames: [{
        label: "full-page",
        buffer: PNG.sync.write(cropToWidth(fullPage, viewport.width)),
      }],
    };
  }

  const frames: ScreenshotFrame[] = [];
  frames.push({
    label: "top",
    buffer: await page.screenshot({ animations: "disabled", caret: "hide", scale: "css" }),
  });
  const defaultAnchors = [Math.floor(catalogCodes.length / 2), catalogCodes.length - 1]
    .filter((cardIndex) => cardIndex >= 0);
  const anchors = [...new Set(catalogAnchors ?? defaultAnchors)];
  for (const [index, cardIndex] of anchors.entries()) {
    const code = catalogCodes[cardIndex] ?? "";
    const card = app === "vanilla"
      ? page.locator("#programGrid article").nth(cardIndex)
      : page.locator("article[data-program-code]").nth(cardIndex);
    const targetY = await card.evaluate((element) => {
      const top = element.getBoundingClientRect().top + window.scrollY - 100;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const destination = Math.max(0, Math.min(top, maxScroll));
      window.scrollTo({ top: destination, behavior: "instant" });
      return destination;
    });
    await page.waitForFunction((scrollY) => Math.abs(window.scrollY - scrollY) <= 1, targetY);
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready);
    frames.push({
      label: `${index === 0 ? "middle" : "bottom"}-${cardIndex}-${code}`,
      buffer: await page.screenshot({ animations: "disabled", caret: "hide", scale: "css" }),
    });
  }
  return { frames, catalogCodes, catalogKeys, catalogEntries, headings, documentHeight, documentWidth, overflowElements, layout, routeLayout, semanticComparison, chrome };
}

async function attachPng(testInfo: TestInfo, name: string, data: Buffer): Promise<void> {
  await testInfo.attach(name, { body: data, contentType: "image/png" });
}

function clipToHeight(source: PNG, height: number): PNG {
  const clipped = new PNG({ width: source.width, height });
  const rowBytes = source.width * 4;
  for (let row = 0; row < Math.min(source.height, height); row += 1) {
    const sourceRow = row;
    source.data.copy(
      clipped.data,
      row * rowBytes,
      sourceRow * rowBytes,
      (sourceRow + 1) * rowBytes,
    );
  }
  return clipped;
}

function maskRect(image: PNG, rect: MeasuredRect): void {
  const left = Math.max(0, Math.floor(rect.x) - 1);
  const top = Math.max(0, Math.floor(rect.y) - 1);
  const right = Math.min(image.width, Math.ceil(rect.x + rect.width) + 1);
  const bottom = Math.min(image.height, Math.ceil(rect.y + rect.height) + 1);
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * image.width + x) * 4;
      image.data[offset] = 255;
      image.data[offset + 1] = 255;
      image.data[offset + 2] = 255;
      image.data[offset + 3] = 255;
    }
  }
}

function safeFrameLabel(label: string): string {
  return label.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function visualTolerancePercentFor(screen: ScreenName): number {
  if (screen === "home") return 0.1;
  if (screen === "catalog") return 5;
  if (screen === "populated-comparison") return 10;
  return 2.25;
}

/** Full-page Chromium captures can expand to scrollWidth; compare the visible viewport crop. */
function cropToWidth(source: PNG, width: number): PNG {
  const cropped = new PNG({ width, height: source.height });
  cropped.data.fill(250);
  for (let row = 0; row < source.height; row += 1) {
    const copyWidth = Math.min(source.width, width);
    source.data.copy(
      cropped.data,
      row * width * 4,
      row * source.width * 4,
      row * source.width * 4 + copyWidth * 4,
    );
    if (copyWidth < width) {
      for (let column = copyWidth; column < width; column += 1) {
        cropped.data[(row * width + column) * 4 + 3] = 255;
      }
    }
  }
  return cropped;
}

async function getVerifiedProgram(browser: Browser): Promise<LiveCurriculumProgram | null> {
  if (!verifiedProgramPromise) {
    verifiedProgramPromise = (async () => {
      const context = await browser.newContext({ baseURL: reactBaseURL });
      try {
        return await discoverLiveCurriculumProgram(await context.newPage());
      } catch (error) {
        const noVerifiedPlan = error instanceof Error
          && error.message.includes("needs a parsed, verified plan with a named course and numeric workload");
        if (!noVerifiedPlan) throw error;
        verifiedProgramSkipReason = error.message;
        return null;
      } finally {
        await context.close();
      }
    })();
  }
  return verifiedProgramPromise;
}

async function getVerifiedComparisonPrograms(browser: Browser): Promise<readonly LiveCurriculumProgram[] | null> {
  if (!verifiedComparisonProgramsPromise) {
    verifiedComparisonProgramsPromise = (async () => {
      const context = await browser.newContext({ baseURL: reactBaseURL });
      try {
        return await discoverLiveCurriculumPrograms(await context.newPage(), 2);
      } catch (error) {
        const noPair = error instanceof Error && error.message.includes("needs 2 distinct programs");
        if (!noPair) throw error;
        verifiedComparisonSkipReason = error.message;
        return null;
      } finally {
        await context.close();
      }
    })();
  }
  return verifiedComparisonProgramsPromise;
}

interface ScaleSeed {
  readonly program: Record<string, unknown>;
  readonly releaseKey: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function getScaleSeed(browser: Browser): Promise<ScaleSeed> {
  const context = await browser.newContext();
  try {
    const response = await context.request.get(new URL("/api/v1/programs?limit=100", reactBaseURL).href);
    expect(response.status(), "FastAPI supplies the base record for synthetic catalog scale measurements").toBe(200);
    const body: unknown = await response.json();
    expect(body).toEqual(expect.objectContaining({ items: expect.any(Array), page: expect.any(Object) }));
    if (!isRecord(body) || !Array.isArray(body.items) || !isRecord(body.page)) {
      throw new Error("FastAPI returned an invalid base program page for catalog scale tests.");
    }
    const program = body.items.find((item): item is Record<string, unknown> => (
      isRecord(item) && typeof item.external_key === "string" && typeof item.direction_key === "string"
    ));
    expect(program, "The isolated release must include a program record").toBeDefined();
    if (!program) throw new Error("The isolated release has no source program to scale.");
    expect(typeof body.page.release_key).toBe("string");
    if (typeof body.page.release_key !== "string") throw new Error("The API did not return release identity.");
    return { program, releaseKey: body.page.release_key };
  } finally {
    await context.close();
  }
}

function scaledProgramRecords(seed: ScaleSeed, count: number): readonly Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => ({
    ...seed.program,
    external_key: `qa:synthetic-program:${index + 1}`,
    code: `QA-${String(index + 1).padStart(3, "0")}`,
    name: `Синтетическая программа ${String(index + 1).padStart(3, "0")}`,
  }));
}

function scaledScenarioCount(scenario: BenchmarkName): number | null {
  if (!scenario.startsWith("catalog-filter-")) return null;
  const value = Number(scenario.slice("catalog-filter-".length));
  return [50, 100, 500].includes(value) ? value : null;
}

async function installCatalogScaleRoute(page: Page, seed: ScaleSeed, count: number): Promise<void> {
  const records = scaledProgramRecords(seed, count);
  const routePattern = "**/api/v1/programs**";
  await page.unroute(routePattern);
  await page.route(routePattern, async (route) => {
    const requestUrl = new URL(route.request().url());
    const cursor = requestUrl.searchParams.get("cursor");
    const cursorMatch = cursor?.match(/^qa-cursor-(\d+)$/);
    const offset = cursorMatch ? Number(cursorMatch[1]) : 0;
    const requestedLimit = Number(requestUrl.searchParams.get("limit") ?? "100");
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 100)
      : 100;
    const end = Math.min(offset + limit, count);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: records.slice(offset, end),
        page: {
          limit,
          next_cursor: end < count ? `qa-cursor-${end}` : null,
          total_count: count,
          release_key: seed.releaseKey,
        },
      }),
    });
  });
}

async function waitForCatalogScale(
  page: Page,
  app: AppName,
  count: number,
): Promise<void> {
  if (app === "vanilla") {
    await expect(page.locator("#programGrid")).toHaveAttribute("aria-busy", "false");
    await expect(page.locator("#catalogProgramTotal")).toHaveText(String(count));
    await expect(page.locator("#programGrid article").first()).toBeVisible();
  } else {
    await expect(page.getByRole("heading", { name: "Все программы" })).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(count);
  }
}

async function measureCatalogScaleFilter(
  page: Page,
  app: AppName,
  count: number,
): Promise<number> {
  const targetCode = `QA-${String(count).padStart(3, "0")}`;
  const search = app === "vanilla" ? page.locator("#searchInput") : page.locator("#program-search");
  const startedAt = await page.evaluate(() => performance.now());
  await search.fill(targetCode);
  const matching = app === "vanilla"
    ? page.locator("#programGrid article").filter({ hasText: targetCode })
    : page.getByRole("article").filter({ hasText: targetCode });
  await expect(matching).toHaveCount(1);
  return page.evaluate((start) => performance.now() - start, startedAt);
}

async function capturePair(
  browser: Browser,
  screen: ScreenName,
  viewport: typeof viewportCases[number],
  testInfo: TestInfo,
  program: LiveCurriculumProgram | null = null,
): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    colorScheme: "light",
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
  });
  if (screen === "populated-comparison" && program) {
    await context.addInitScript((programKey: string) => {
      if (["/compare.html", "/compare"].includes(window.location.pathname)) {
        localStorage.clear();
        localStorage.setItem("andromeda.compare.v1", JSON.stringify([programKey]));
      }
    }, program.externalKey);
  }
  const page = await context.newPage();
  const diagnostics = attachDiagnostics(page);

  try {
    const vanillaCapture = await navigateAndWait(page, "vanilla", screen, viewport);
    assertHealthy(diagnostics);
    resetDiagnostics(diagnostics);
    const catalogAnchors = screen === "catalog"
      ? [Math.floor(vanillaCapture.catalogCodes.length / 2), vanillaCapture.catalogCodes.length - 1]
        .filter((cardIndex) => cardIndex >= 0)
      : undefined;
    const reactCapture = await navigateAndWait(page, "react", screen, viewport, catalogAnchors);
    assertHealthy(diagnostics);
    if (screen === "catalog") {
      expect(reactCapture.catalogEntries, "React catalog must preserve each original external key, code, and name in order")
        .toEqual(vanillaCapture.catalogEntries);
    }
    if (screen === "populated-comparison") {
      const releaseNote = page.locator('[data-qa="active-release-note"]');
      await expect(releaseNote, "React comparison identifies the single active academic release").toBeVisible();
      await expect(releaseNote).toContainText("Активный академический выпуск:");
      await expect(releaseNote).toContainText("Все таблицы и планы сверены с этим ключом.");
      const releaseCode = releaseNote.locator('[data-qa="active-release-key"]');
      expect(program?.releaseKey, "the paired fixture was discovered from a verified active release").toBeTruthy();
      if (!program?.releaseKey) throw new Error("The populated comparison has no verified release identity.");
      await expect(releaseCode, "the displayed release identity matches the verified test release").toHaveText(program.releaseKey);
      const releaseNoteInDocument = await releaseNote.evaluate((element) => ({
        isLastMainChild: element.parentElement?.lastElementChild === element,
        bottom: element.getBoundingClientRect().bottom + window.scrollY,
        documentHeight: document.documentElement.scrollHeight,
      }));
      expect(releaseNoteInDocument.isLastMainChild, "the release note remains the final comparison section").toBe(true);
      expect(releaseNoteInDocument.bottom, "the full-page screenshot includes the release note").toBeLessThanOrEqual(releaseNoteInDocument.documentHeight);

      const sectionNames = ["selection", "admission", "workload", "curriculum", "matrix"] as const;
      const originalSections = vanillaCapture.routeLayout?.comparisonSections;
      const reactSections = reactCapture.routeLayout?.comparisonSections;
      expect(originalSections, "original comparison exposes its major section geometry").toBeDefined();
      expect(reactSections, "React comparison exposes its major section geometry").toBeDefined();
      for (const name of sectionNames) {
        const original = isRecord(originalSections) ? originalSections[name] : null;
        const react = isRecord(reactSections) ? reactSections[name] : null;
        expect(isMeasuredRect(original), `original ${name} section has a measurable frame`).toBe(true);
        expect(isMeasuredRect(react), `React ${name} section has a measurable frame`).toBe(true);
        if (!isMeasuredRect(original) || !isMeasuredRect(react)) continue;
        expect.soft(Math.abs(original.x - react.x), `${name} section horizontal offset`).toBeLessThanOrEqual(2);
        expect.soft(Math.abs(original.width - react.width), `${name} section width`).toBeLessThanOrEqual(2);
        expect.soft(Math.abs(original.y - react.y), `${name} section vertical offset`).toBeLessThanOrEqual(12);
        const heightDelta = Math.abs(original.height - react.height) / Math.max(original.height, 1) * 100;
        expect.soft(heightDelta, `${name} section height delta`).toBeLessThanOrEqual(5);
      }
      const originalRows = vanillaCapture.routeLayout?.categoryDistributionRows;
      const reactRows = reactCapture.routeLayout?.categoryDistributionRows;
      expect(isCategoryDistributionRows(originalRows), "original comparison renders category distribution rows").toBe(true);
      expect(isCategoryDistributionRows(reactRows), "React comparison renders category distribution rows").toBe(true);
      if (isCategoryDistributionRows(originalRows) && isCategoryDistributionRows(reactRows)) {
        expect(reactRows, "category counts remain the same").toHaveLength(originalRows.length);
        expect(reactRows.map((row) => row.category), "category rows remain in the same order").toEqual(originalRows.map((row) => row.category));
        const expectedFirstColumnWidth = viewport.width <= 620 ? 165 : 215;
        expect(originalRows[0]?.headingWidth, "vanilla category table uses the expected responsive sticky-column width")
          .toBe(expectedFirstColumnWidth);
        expect(reactRows[0]?.headingWidth, "React category table keeps the original responsive sticky-column width")
          .toBe(expectedFirstColumnWidth);
        for (let index = 0; index < originalRows.length; index += 1) {
          const originalRow = originalRows[index];
          const reactRow = reactRows[index];
          if (!originalRow || !reactRow) continue;
          expect.soft(Math.abs(originalRow.height - reactRow.height), `category row ${originalRow.category} height`)
            .toBeLessThanOrEqual(1);
        }
      }
      const unknownCell = page.locator('[data-qa="category-distribution-row"] [data-semantic-state="unknown"]').first();
      await expect(unknownCell, "unknown category hours stay visibly distinct from confirmed zero").toHaveText("—");
      await expect(unknownCell, "unknown category hours include an accessible explanation").toHaveAttribute("title", /нет подтверждённых дисциплин|не указаны числовые часы/i);
      const unknownFactKeys = [...new Set(reactCapture.semanticComparison.unknownFactKeys)];
      expect(unknownFactKeys, "comparison must explicitly identify source values whose classification or workload is unknown").not.toHaveLength(0);
      for (const factKey of unknownFactKeys) {
        const vanillaRect = vanillaCapture.semanticComparison.factRects[factKey];
        const reactRect = reactCapture.semanticComparison.factRects[factKey];
        expect(vanillaRect, `original comparison contains the corresponding source value for ${factKey}`).toBeDefined();
        expect(reactRect, `React comparison contains the explicit unknown value for ${factKey}`).toBeDefined();
        expect(vanillaCapture.semanticComparison.factTexts[factKey], `original source text is captured for ${factKey}`).toBeTruthy();
        expect(reactCapture.semanticComparison.factTexts[factKey], `React unknown text is captured for ${factKey}`).toBeTruthy();
      }
      const maskableUnknownFactKeys = unknownFactKeys.filter((factKey) => isVerifiedZeroToUnknown(
        factKey,
        vanillaCapture.semanticComparison.factTexts[factKey],
        reactCapture.semanticComparison.factTexts[factKey],
      ));
      for (const factKey of maskableUnknownFactKeys) {
        const [kind] = JSON.parse(factKey) as [string, string, string];
        const originalText = vanillaCapture.semanticComparison.factTexts[factKey];
        const reactText = reactCapture.semanticComparison.factTexts[factKey];
        if (kind === "legend") {
          expect(originalText, `only confirmed original zero hours and share are masked for ${factKey}`).toMatch(/^·\s*0\s*ч\.\s*·\s*0%$/);
          expect(reactText, `React preserves both legend metrics as unknown for ${factKey}`).toMatch(/^·\s*—\s*·\s*—$/);
        } else {
          expect(originalText, `only confirmed original zero workload is masked for ${factKey}`).toBe("0 ч.|0%");
          expect(reactText, `React preserves workload and share as unknown for ${factKey}`).toBe("—|—");
        }
      }
      for (const factKey of reactCapture.semanticComparison.unknownDonutFactKeys) {
        const vanillaRect = vanillaCapture.semanticComparison.factRects[factKey];
        const reactRect = reactCapture.semanticComparison.factRects[factKey];
        expect(vanillaRect, `original comparison contains the corresponding donut value for ${factKey}`).toBeDefined();
        expect(reactRect, `React comparison contains the explicit unknown donut value for ${factKey}`).toBeDefined();
        expect(vanillaCapture.semanticComparison.factTexts[factKey], `original zero is explicitly identified for ${factKey}`).toBe("0%");
        expect(reactCapture.semanticComparison.factTexts[factKey], `React preserves unknown as unknown for ${factKey}`).toBe("—");
      }
    }
    expect(reactCapture.headings, `${screen} React page must preserve original section headings in order`).toEqual(vanillaCapture.headings);
    const heightDeltaPercent = Math.abs(reactCapture.documentHeight - vanillaCapture.documentHeight) / vanillaCapture.documentHeight * 100;
    expect(heightDeltaPercent, `${screen} page height delta must not hide missing trailing content`).toBeLessThanOrEqual(3.5);
    expect(vanillaCapture.documentWidth, `original page must not overflow horizontally: ${JSON.stringify(vanillaCapture.overflowElements)}`).toBe(viewport.width);
    expect(reactCapture.documentWidth, `React page must not overflow horizontally: ${JSON.stringify(reactCapture.overflowElements)}`).toBe(viewport.width);
    for (const element of ["brand", "menu"] as const) {
      assertEquivalentRect(`${screen} ${element}`, vanillaCapture.chrome[element], reactCapture.chrome[element]);
    }
    if (screen !== "home") {
      for (const element of ["intro", "title", "description"] as const) {
        assertEquivalentRect(
          `${screen} ${element}`,
          vanillaCapture.routeLayout?.[element],
          reactCapture.routeLayout?.[element],
        );
      }
    }

    expect(reactCapture.frames.map((frame) => frame.label)).toEqual(vanillaCapture.frames.map((frame) => frame.label));
    const maskableUnknownFactKeys = screen === "populated-comparison"
      ? [...new Set(reactCapture.semanticComparison.unknownFactKeys)].filter((factKey) => isVerifiedZeroToUnknown(
        factKey,
        vanillaCapture.semanticComparison.factTexts[factKey],
        reactCapture.semanticComparison.factTexts[factKey],
      ))
      : [];
    const maskableUnknownDonutFactKeys = screen === "populated-comparison"
      ? [...new Set(reactCapture.semanticComparison.unknownDonutFactKeys)].filter((factKey) => isVerifiedZeroToUnknown(
        factKey,
        vanillaCapture.semanticComparison.factTexts[factKey],
        reactCapture.semanticComparison.factTexts[factKey],
      ))
      : [];
    let diffPixelCount = 0;
    let semanticMaskedDiffPixelCount = 0;
    let totalPixels = 0;
    const frameReports = [];
    for (const [index, vanillaFrame] of vanillaCapture.frames.entries()) {
      const reactFrame = reactCapture.frames[index];
      expect(reactFrame, `React screenshot frame ${vanillaFrame.label}`).toBeDefined();
      if (!reactFrame) throw new Error(`Missing React screenshot frame ${vanillaFrame.label}.`);
      const vanilla = PNG.sync.read(vanillaFrame.buffer);
      const react = PNG.sync.read(reactFrame.buffer);
      expect(react.width, `${vanillaFrame.label} paired viewport width`).toBe(vanilla.width);
      // Compare pixels only where both pages render content. Full-page height is
      // checked separately, so padding the shorter capture with transparent
      // pixels would count the same geometry difference twice.
      const height = Math.min(vanilla.height, react.height);
      const vanillaComparable = clipToHeight(vanilla, height);
      const reactComparable = clipToHeight(react, height);
      const vanillaSemanticComparable = clipToHeight(vanilla, height);
      const reactSemanticComparable = clipToHeight(react, height);
      if (screen === "populated-comparison") {
        for (const factKey of maskableUnknownFactKeys) {
          const vanillaRect = vanillaCapture.semanticComparison.factRects[factKey];
          const reactRect = reactCapture.semanticComparison.factRects[factKey];
          if (!vanillaRect || !reactRect) throw new Error(`Cannot mask unmatched unknown academic fact ${factKey}.`);
          maskRect(vanillaSemanticComparable, vanillaRect);
          maskRect(reactSemanticComparable, reactRect);
        }
        for (const factKey of maskableUnknownDonutFactKeys) {
          const vanillaRect = vanillaCapture.semanticComparison.factRects[factKey];
          const reactRect = reactCapture.semanticComparison.factRects[factKey];
          if (!vanillaRect || !reactRect) throw new Error(`Cannot mask unmatched unknown donut fact ${factKey}.`);
          maskRect(vanillaSemanticComparable, vanillaRect);
          maskRect(reactSemanticComparable, reactRect);
        }
      }
      const diff = new PNG({ width: vanilla.width, height });
      const changed = pixelmatch(
        vanillaComparable.data,
        reactComparable.data,
        diff.data,
        vanilla.width,
        height,
        { threshold: 0.1, includeAA: false, alpha: 0.65 },
      );
      const semanticMaskedDiff = new PNG({ width: vanilla.width, height });
      const semanticMaskedChanged = pixelmatch(
        vanillaSemanticComparable.data,
        reactSemanticComparable.data,
        semanticMaskedDiff.data,
        vanilla.width,
        height,
        { threshold: 0.1, includeAA: false, alpha: 0.65 },
      );
      diffPixelCount += changed;
      semanticMaskedDiffPixelCount += semanticMaskedChanged;
      totalPixels += vanilla.width * height;
      const diffBytes = PNG.sync.write(diff);
      const maskedDiffBytes = PNG.sync.write(semanticMaskedDiff);
      const safeLabel = safeFrameLabel(vanillaFrame.label);
      const vanillaOutput = testInfo.outputPath(`vanilla-${safeLabel}.png`);
      const reactOutput = testInfo.outputPath(`react-${safeLabel}.png`);
      const outputFile = testInfo.outputPath(`pixel-diff-${safeLabel}.png`);
      const maskedOutputFile = testInfo.outputPath(`pixel-diff-semantic-masked-${safeLabel}.png`);
      await mkdir(dirname(outputFile), { recursive: true });
      await writeFile(vanillaOutput, vanillaFrame.buffer);
      await writeFile(reactOutput, reactFrame.buffer);
      await writeFile(outputFile, diffBytes);
      await writeFile(maskedOutputFile, maskedDiffBytes);
      await attachPng(testInfo, `vanilla-${vanillaFrame.label}.png`, vanillaFrame.buffer);
      await attachPng(testInfo, `react-${reactFrame.label}.png`, reactFrame.buffer);
      await testInfo.attach(`pixel-diff-${vanillaFrame.label}.png`, { path: outputFile, contentType: "image/png" });
      await testInfo.attach(`pixel-diff-semantic-masked-${vanillaFrame.label}.png`, { path: maskedOutputFile, contentType: "image/png" });
      frameReports.push({
        section: vanillaFrame.label,
        width: vanilla.width,
        vanillaHeight: vanilla.height,
        reactHeight: react.height,
        comparisonHeight: height,
        diffPixelCount: changed,
        semanticMaskedDiffPixelCount: semanticMaskedChanged,
        totalPixels: vanilla.width * height,
        diffPercent: Number((changed / (vanilla.width * height) * 100).toFixed(2)),
        semanticMaskedDiffPercent: Number((semanticMaskedChanged / (vanilla.width * height) * 100).toFixed(2)),
      });
    }
    const report = {
      screen,
      viewport: viewport.name,
      viewportWidth: viewport.width,
      vanillaDocumentWidth: vanillaCapture.documentWidth,
      reactDocumentWidth: reactCapture.documentWidth,
      vanillaHorizontalOverflowPx: Math.max(0, vanillaCapture.documentWidth - viewport.width),
      reactHorizontalOverflowPx: Math.max(0, reactCapture.documentWidth - viewport.width),
      vanillaDocumentHeight: vanillaCapture.documentHeight,
      reactDocumentHeight: reactCapture.documentHeight,
      documentHeightDeltaPercent: Number((Math.abs(reactCapture.documentHeight - vanillaCapture.documentHeight) / vanillaCapture.documentHeight * 100).toFixed(2)),
      catalogProgramCount: screen === "catalog" ? vanillaCapture.catalogCodes.length : null,
      catalogProgramOrderMatches: screen === "catalog"
        ? JSON.stringify(reactCapture.catalogCodes) === JSON.stringify(vanillaCapture.catalogCodes)
        : null,
      vanillaOverflowElements: vanillaCapture.overflowElements,
      reactOverflowElements: reactCapture.overflowElements,
      vanillaLayout: vanillaCapture.layout,
      reactLayout: reactCapture.layout,
      vanillaRouteLayout: vanillaCapture.routeLayout,
      reactRouteLayout: reactCapture.routeLayout,
      vanillaChrome: vanillaCapture.chrome,
      reactChrome: reactCapture.chrome,
      diffPixelCount,
      semanticMaskedDiffPixelCount,
      totalPixels,
      diffPercent: Number((diffPixelCount / totalPixels * 100).toFixed(2)),
      semanticMaskedDiffPercent: Number((semanticMaskedDiffPixelCount / totalPixels * 100).toFixed(2)),
      semanticMaskCount: screen === "populated-comparison"
        ? [...new Set([...maskableUnknownFactKeys, ...maskableUnknownDonutFactKeys])].length
        : 0,
      frames: frameReports,
      program: program ? {
        code: program.code,
        name: program.name,
        planKey: program.planKey,
        academicYear: program.academicYear,
        courseName: program.courseName,
        expectedHours: program.expectedHours,
        expectedCredits: program.expectedCredits,
      } : null,
      visualTolerancePercent: visualTolerancePercentFor(screen),
      note: "Paired Chromium pixel delta with reduced motion and identical viewport. Raw and semantic-masked deltas are measured over the shared screenshot area; full page height is checked independently with a strict 3.5% limit. Masks cover only text-value rectangles for paired category legend, table, or donut facts where captured source text proves that the original shows numeric zero and React correctly preserves the value as unknown; unrelated cells, bars, and geometry remain in the pixel comparison. The React-only active-release note follows the shared pixel area, so dedicated E2E assertions check its exact verified release key, text, last-section placement, and inclusion in the full-page height.",
    };
    const visualTolerancePercent = visualTolerancePercentFor(screen);
    const visualDiffPercent = screen === "populated-comparison" ? report.semanticMaskedDiffPercent : report.diffPercent;
    await testInfo.attach("pixel-diff-metrics.json", {
      body: Buffer.from(JSON.stringify(report, null, 2)),
      contentType: "application/json",
    });
    const metricsPath = testInfo.outputPath("pixel-diff-metrics.json");
    await mkdir(dirname(metricsPath), { recursive: true });
    await writeFile(metricsPath, JSON.stringify(report, null, 2));
    process.stdout.write(`VISUAL_DELTA ${JSON.stringify(report)}\n`);
    expect(visualDiffPercent, `${screen} ${viewport.name} overall visual delta${screen === "populated-comparison" ? " after exact unknown-value masks" : ""}`).toBeLessThanOrEqual(visualTolerancePercent);
    for (const frame of frameReports) {
      const frameVisualDiffPercent = screen === "populated-comparison" ? frame.semanticMaskedDiffPercent : frame.diffPercent;
      expect(frameVisualDiffPercent, `${screen} ${viewport.name} ${frame.section} visual delta${screen === "populated-comparison" ? " after exact unknown-value masks" : ""}`)
        .toBeLessThanOrEqual(visualTolerancePercent);
    }
  } finally {
    await context.close();
  }
}

for (const viewport of viewportCases) {
  for (const screen of ["home", "catalog", "empty-comparison", "populated-comparison"] as const) {
    test(`@paired @visual ${screen} vanilla vs React at ${viewport.name}`, async ({ browser }, testInfo) => {
      requirePairedRun();
      if (screen === "populated-comparison") {
        const program = await getVerifiedProgram(browser);
        if (!program) {
          test.skip(true, verifiedProgramSkipReason);
          return;
        }
        await capturePair(browser, screen, viewport, testInfo, program);
      } else {
        await capturePair(browser, screen, viewport, testInfo);
      }
    });
  }
}

async function waitForBenchmarkScenario(
  page: Page,
  app: AppName,
  scenario: BenchmarkName,
  comparisonPrograms: readonly LiveCurriculumProgram[],
): Promise<number> {
  if (scenario === "home") {
    await expect(page.getByText("МГТУ имени Баумана × Андромеда", { exact: true })).toBeVisible();
  } else {
    const scaleCount = scaledScenarioCount(scenario);
    if (scaleCount !== null) {
      await waitForCatalogScale(page, app, scaleCount);
    } else {
      await expect(page.getByRole("heading", { name: "Матрица предметов" })).toBeVisible();
      for (const selectedProgram of comparisonPrograms) {
        if (app === "react") {
          const card = page.locator(`article[data-program-key="${selectedProgram.externalKey}"]`);
          await expect(card).toHaveAttribute("data-plan-key", selectedProgram.planKey);
        } else {
          await expect(page.locator(".category-program-card").filter({ hasText: selectedProgram.code })).toBeVisible();
        }
        await expect(page.getByRole("group", {
          name: new RegExp("Распределение программы " + escapeRegExp(selectedProgram.code)),
        })).toBeVisible();
      }
    }
  }

  return page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return navigation ? performance.now() - navigation.startTime : Number.NaN;
  });
}

async function waitForFullComparisonData(
  page: Page,
  app: AppName,
  scenario: BenchmarkName,
  comparisonPrograms: readonly LiveCurriculumProgram[],
): Promise<number | null> {
  if (scenario !== "compare-load") return null;

  if (app === "react") {
    const releaseKey = comparisonPrograms[0]?.releaseKey;
    if (!releaseKey) throw new Error("The comparison benchmark requires a verified release key.");
    await expect(page.locator('[data-qa="active-release-key"]')).toHaveText(releaseKey);
  } else {
    const content = page.locator("#compareContent");
    await expect(content.locator(".admission-loading-note, .admission-error-note")).toHaveCount(0);
    await expect(content.locator("table.comparison-table")).toBeVisible();
  }

  return page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return navigation ? performance.now() - navigation.startTime : Number.NaN;
  });
}

async function visitForBenchmark(
  page: Page,
  cacheSession: CDPSession,
  app: AppName,
  scenario: BenchmarkName,
  iteration: number,
  diagnostics: ReturnType<typeof attachDiagnostics>,
  comparisonPrograms: readonly LiveCurriculumProgram[],
  scaleSeed: ScaleSeed,
): Promise<PageMetrics> {
  resetDiagnostics(diagnostics);
  await cacheSession.send("Network.clearBrowserCache");
  const scaleCount = scaledScenarioCount(scenario);
  if (scaleCount !== null) await installCatalogScaleRoute(page, scaleSeed, scaleCount);
  else await page.unroute("**/api/v1/programs**");
  const baseURL = app === "vanilla" ? vanillaBaseURL : reactBaseURL;
  const path = scenario === "home"
    ? app === "vanilla" ? "/index.html" : "/"
    : scenario === "compare-load"
      ? app === "vanilla" ? "/compare.html" : "/compare"
      : app === "vanilla" ? "/programs.html" : "/programs";

  await page.goto(new URL(path, baseURL).href, { waitUntil: "domcontentloaded" });
  const readyMs = await waitForBenchmarkScenario(page, app, scenario, comparisonPrograms);
  expect(Number.isFinite(readyMs), "Navigation Timing should expose the navigation start").toBe(true);
  const fullDataReadyMs = await waitForFullComparisonData(page, app, scenario, comparisonPrograms);
  if (fullDataReadyMs !== null) {
    expect(Number.isFinite(fullDataReadyMs), "full comparison readiness should expose the navigation start").toBe(true);
  }
  await page.waitForLoadState("networkidle");
  assertHealthy(diagnostics);
  const actionMs = scaleCount === null ? null : await measureCatalogScaleFilter(page, app, scaleCount);
  if (actionMs !== null) {
    await page.waitForLoadState("networkidle");
    assertHealthy(diagnostics);
  }
  const scriptStats = await page.evaluate(() => {
    const resources = performance.getEntriesByType("resource")
      .filter((entry): entry is PerformanceResourceTiming => entry.entryType === "resource");
    const scripts = resources.filter((entry) => /\.(?:m?js)$/i.test(new URL(entry.name).pathname));
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const heap = performance as Performance & { memory?: { usedJSHeapSize?: number } };
    return {
      scriptCount: scripts.length,
      scriptBytes: scripts.reduce((total, entry) => total + (entry.encodedBodySize || entry.transferSize), 0),
      resourceCount: resources.length + (navigation ? 1 : 0),
      transferredResourceBytes: resources.reduce((total, entry) => total + (entry.encodedBodySize || entry.transferSize), 0)
        + (navigation?.transferSize ?? 0),
      longTaskDurations: [...(window.__andromedaQaLongTaskDurations ?? [])],
      cumulativeLayoutShift: window.__andromedaQaCumulativeLayoutShift ?? 0,
      jsHeapUsedBytes: typeof heap.memory?.usedJSHeapSize === "number" ? heap.memory.usedJSHeapSize : null,
      apiResources: resources.flatMap((entry) => {
        const url = new URL(entry.name);
        if (!url.pathname.startsWith("/api/v1/")) return [];
        return [{
          path: url.pathname + url.search,
          durationMs: Number((entry.responseEnd - entry.startTime).toFixed(2)),
          transferBytes: entry.transferSize || entry.encodedBodySize,
          encodedBodyBytes: entry.encodedBodySize,
          decodedBodyBytes: entry.decodedBodySize,
        }];
      }),
      comparisonStageMs: Object.fromEntries(performance.getEntriesByType("measure")
        .filter((entry) => entry.name.startsWith("andromeda:comparison:stage:"))
        .map((entry) => [entry.name.slice("andromeda:comparison:stage:".length), Number(entry.duration.toFixed(2))])),
    };
  });

  return {
    app,
    scenario,
    iteration,
    readyMs: Number(readyMs.toFixed(2)),
    fullDataReadyMs: fullDataReadyMs === null ? null : Number(fullDataReadyMs.toFixed(2)),
    actionMs: actionMs === null ? null : Number(actionMs.toFixed(2)),
    apiRequests: diagnostics.apiRequests.length,
    apiResponses: [...diagnostics.apiRequests],
    apiResources: scriptStats.apiResources,
    apiTransferBytes: scriptStats.apiResources.reduce((total, entry) => total + entry.transferBytes, 0),
    comparisonStageMs: scriptStats.comparisonStageMs,
    scriptCount: scriptStats.scriptCount,
    scriptBytes: scriptStats.scriptBytes,
    resourceCount: scriptStats.resourceCount,
    transferredResourceBytes: scriptStats.transferredResourceBytes,
    longTaskCount: scriptStats.longTaskDurations.length,
    longTaskDurationMs: Number(scriptStats.longTaskDurations.reduce((sum, duration) => sum + duration, 0).toFixed(2)),
    cumulativeLayoutShift: Number(scriptStats.cumulativeLayoutShift.toFixed(4)),
    jsHeapUsedBytes: scriptStats.jsHeapUsedBytes,
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle] ?? 0;
  return Number(value.toFixed(2));
}

function nearestRankPercentile(values: readonly number[], percentile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil(percentile / 100 * sorted.length));
  return Number((sorted[rank - 1] ?? 0).toFixed(2));
}

function summarizeMetrics(metrics: readonly PageMetrics[]) {
  const groups = new Map<string, PageMetrics[]>();
  for (const metric of metrics) {
    const key = `${metric.app}:${metric.scenario}`;
    groups.set(key, [...(groups.get(key) ?? []), metric]);
  }
  return [...groups.entries()].map(([key, samples]) => {
    const readyTimes = samples.map((sample) => sample.readyMs);
    const fullDataReadyTimes = samples.flatMap((sample) => (
      sample.fullDataReadyMs === null ? [] : [sample.fullDataReadyMs]
    ));
    const actionTimes = samples.flatMap((sample) => sample.actionMs === null ? [] : [sample.actionMs]);
    const apiCounts = samples.map((sample) => sample.apiRequests);
    const scriptBytes = samples.map((sample) => sample.scriptBytes);
    const heapBytes = samples.flatMap((sample) => sample.jsHeapUsedBytes === null ? [] : [sample.jsHeapUsedBytes]);
    const stages = new Set(samples.flatMap((sample) => Object.keys(sample.comparisonStageMs)));
    return {
      appAndScenario: key,
      sampleCount: samples.length,
      readyMs: { median: median(readyTimes), p95: nearestRankPercentile(readyTimes, 95) },
      ...(fullDataReadyTimes.length ? {
        fullDataReadyMs: {
          median: median(fullDataReadyTimes),
          p95: nearestRankPercentile(fullDataReadyTimes, 95),
        },
      } : {}),
      ...(actionTimes.length ? { actionMs: { median: median(actionTimes), p95: nearestRankPercentile(actionTimes, 95) } } : {}),
      apiRequestsMedian: median(apiCounts),
      apiTransferBytesMedian: median(samples.map((sample) => sample.apiTransferBytes)),
      comparisonStageMs: Object.fromEntries([...stages].map((stage) => {
        const values = samples.flatMap((sample) => stage in sample.comparisonStageMs
          ? [sample.comparisonStageMs[stage] ?? 0]
          : []);
        return [stage, { median: median(values), p95: nearestRankPercentile(values, 95) }];
      })),
      transferredScriptBytesMedian: median(scriptBytes),
      scriptCountMedian: median(samples.map((sample) => sample.scriptCount)),
      resourceCountMedian: median(samples.map((sample) => sample.resourceCount)),
      transferredResourceBytesMedian: median(samples.map((sample) => sample.transferredResourceBytes)),
      longTaskCountMedian: median(samples.map((sample) => sample.longTaskCount)),
      longTaskDurationMsMedian: median(samples.map((sample) => sample.longTaskDurationMs)),
      cumulativeLayoutShiftMedian: median(samples.map((sample) => sample.cumulativeLayoutShift)),
      ...(heapBytes.length ? { jsHeapUsedBytesMedian: median(heapBytes) } : { jsHeapUsedBytesMedian: null }),
    };
  });
}

test("@paired @benchmark repeated vanilla-versus-React browser measurements", async ({ browser }, testInfo) => {
  requirePairedRun();
  test.setTimeout(300_000);
  const iterationCount = Number.parseInt(process.env.BENCHMARK_ITERATIONS ?? "5", 10);
  expect(Number.isInteger(iterationCount) && iterationCount >= 3 && iterationCount <= 20).toBe(true);
  const comparisonPrograms = await getVerifiedComparisonPrograms(browser);
  if (!comparisonPrograms) {
    test.skip(true, verifiedComparisonSkipReason);
    return;
  }
  if (comparisonPrograms.length !== 2) throw new Error("The performance benchmark needs exactly two selected programs.");
  const scaleSeed = await getScaleSeed(browser);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    colorScheme: "light",
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
  });
  const page = await context.newPage();
  const comparisonProgramKeys = comparisonPrograms.map((selectedProgram) => selectedProgram.externalKey);
  await page.addInitScript((programKeys: readonly string[]) => {
    window.__andromedaQaLongTaskDurations = [];
    window.__andromedaQaCumulativeLayoutShift = 0;
    window.__andromedaQaComparisonProfiling = window.location.pathname === "/compare";
    if (typeof PerformanceObserver !== "undefined") {
      if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) window.__andromedaQaLongTaskDurations?.push(entry.duration);
        }).observe({ type: "longtask", buffered: true });
      }
      if (PerformanceObserver.supportedEntryTypes.includes("layout-shift")) {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
            if (!shift.hadRecentInput) {
              window.__andromedaQaCumulativeLayoutShift = (window.__andromedaQaCumulativeLayoutShift ?? 0) + shift.value;
            }
          }
        }).observe({ type: "layout-shift", buffered: true });
      }
    }
    if (["/compare.html", "/compare"].includes(window.location.pathname)) {
      localStorage.clear();
      localStorage.setItem("andromeda.compare.v1", JSON.stringify(programKeys));
    }
  }, comparisonProgramKeys);
  const diagnostics = attachDiagnostics(page);
  const cacheSession = await context.newCDPSession(page);
  await cacheSession.send("Network.enable");
  await cacheSession.send("Network.setCacheDisabled", { cacheDisabled: true });

  try {
    const scenarios: BenchmarkName[] = [
      "home",
      "catalog-filter-50",
      "catalog-filter-100",
      "catalog-filter-500",
      "compare-load",
    ];
    const metrics: PageMetrics[] = [];

    // Warm each app/screen once, then alternate app order for every measured pair.
    for (const scenario of scenarios) {
      for (const app of ["vanilla", "react"] as const) {
        await visitForBenchmark(page, cacheSession, app, scenario, 0, diagnostics, comparisonPrograms, scaleSeed);
      }
      for (let iteration = 1; iteration <= iterationCount; iteration += 1) {
        const order: readonly AppName[] = iteration % 2 === 0 ? ["react", "vanilla"] : ["vanilla", "react"];
        for (const app of order) {
          metrics.push(await visitForBenchmark(
            page,
            cacheSession,
            app,
            scenario,
            iteration,
            diagnostics,
            comparisonPrograms,
            scaleSeed,
          ));
        }
      }
    }

    const report = {
      experiment: "paired vanilla static production build versus React production build browser measurements",
      browser: "Chromium (same Playwright browser process)",
      viewport: "1440x900, deviceScaleFactor=1",
      reducedMotion: "reduce",
      cache: "Chromium HTTP cache disabled and cleared before every navigation; one context reused so storage remains isolated to this experiment.",
      iterationsPerAppAndScenario: iterationCount,
      warmupLoadsPerAppAndScenario: 1,
      liveReleasePrograms: comparisonPrograms.map((selectedProgram) => ({
        code: selectedProgram.code,
        name: selectedProgram.name,
        externalKey: selectedProgram.externalKey,
        verifiedPlanKey: selectedProgram.planKey,
        academicYear: selectedProgram.academicYear,
        expectedHours: selectedProgram.expectedHours,
        expectedCredits: selectedProgram.expectedCredits,
        releaseKey: selectedProgram.releaseKey,
      })),
      catalogScale: {
        sizes: [50, 100, 500],
        source: "Synthetic catalog-only rows cloned from one live API program and renamed with unique QA identities; admission and curriculum facts are not asserted.",
        releaseKey: scaleSeed.releaseKey,
      },
      metrics: summarizeMetrics(metrics),
      samples: metrics,
      methodology: {
        readyMs: "PerformanceNavigationTiming.startTime to the first visible screen-specific comparison content; for Vanilla, admission may still be loading",
        fullDataReadyMs: "For compare-load only: Vanilla waits for the admission loading panel to be replaced by the comparison table; React waits for its active-release key, which appears only after the loader has resolved. This is the primary full-data comparison-readiness metric.",
        actionMs: "catalog fill to the single matching QA code becoming visible; synthetic catalog sizes are 50, 100, and 500 rows",
        scriptBytes: "sum of ResourceTiming encodedBodySize (or transferSize fallback) for every loaded .js/.mjs resource; cache disabled for each measured navigation",
        transferredResourceBytes: "navigation transferSize plus encodedBodySize (or transferSize fallback) for all resource entries; cache disabled for each measured navigation and API response bodies are included",
        apiResourceTimings: "Resource Timing duration, transferSize, encodedBodySize, and decodedBodySize for each /api/v1/ response; durations are browser-observed request/response spans",
        comparisonStages: "opt-in performance.mark/measure around catalog, selection, plans, items, taxonomy, curriculum-model, admission, final release verification, and total loader time; enabled only in paired React comparison benchmark navigations",
        longTasks: "PerformanceObserver longtask count and total duration during the page visit; Chromium support only",
        cumulativeLayoutShift: "sum of layout-shift values without recent user input during the page visit",
        jsHeapUsedBytes: "Chromium performance.memory snapshot after screen readiness; non-standard and reported as null when unsupported",
        p95: "nearest-rank percentile over repeated samples",
        note: "Vanilla is served from apps/web/dist and React from Vite production preview; browser and API are shared, and data requests use the isolated PostgreSQL 16 seed.",
      },
    };
    const json = Buffer.from(JSON.stringify(report, null, 2));
    const reportPath = testInfo.outputPath("paired-performance-report.json");
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, json);
    await testInfo.attach("paired-performance-report.json", { body: json, contentType: "application/json" });
    process.stdout.write(`PAIRED_PERFORMANCE ${JSON.stringify(report.metrics)}\n`);
  } finally {
    await cacheSession.detach();
    await context.close();
  }
});
