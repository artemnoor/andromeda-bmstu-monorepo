import { expect, test as base } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";

export interface BrowserDiagnostics {
  readonly pageErrors: string[];
  readonly consoleErrors: string[];
  readonly failedRequests: string[];
  readonly apiResponses: { readonly path: string; readonly status: number }[];
}

export const test = base.extend<{ diagnostics: BrowserDiagnostics }>({
  diagnostics: async ({ page }, applyFixture, testInfo) => {
    const diagnostics: BrowserDiagnostics = {
      pageErrors: [],
      consoleErrors: [],
      failedRequests: [],
      apiResponses: [],
    };

    page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
    });
    page.on("requestfailed", (request) => {
      const errorText = request.failure()?.errorText ?? "request failed";
      // Browser engines cancel superseded asset requests during navigation.
      // These are not network failures; essential images are checked directly
      // by the browser scenarios and paired visual suite.
      if (/^(?:NS_BINDING_ABORTED|net::ERR_ABORTED|ERR_ABORTED)$/i.test(errorText)) return;
      diagnostics.failedRequests.push(
        `${request.method()} ${request.url()}: ${errorText}`,
      );
    });
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.pathname.startsWith("/api/v1/")) {
        diagnostics.apiResponses.push({ path: url.pathname, status: response.status() });
      }
    });

    await applyFixture(diagnostics);

    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach("browser-diagnostics", {
        body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
        contentType: "application/json",
      });
    }
  },
});

export { expect };

/** Keep scenarios independent without disturbing unrelated browser storage. */
export async function clearPocStorage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const initializedKey = "__andromeda_poc_test_storage_initialized_v1";
    if (sessionStorage.getItem(initializedKey) === "true") return;
    sessionStorage.setItem(initializedKey, "true");

    for (const key of [
      "andromeda.compare.v1",
      "andromeda-compare-programs-v1",
      "andromeda.compare.migration-overflow.v1",
      "andromeda.favorites.v1",
      "andromeda-favorite-programs-v1",
    ]) {
      localStorage.removeItem(key);
    }
  });
}

export function expectHealthyBrowser(diagnostics: BrowserDiagnostics): void {
  expectNoPageErrors(diagnostics);
  expect(diagnostics.consoleErrors, diagnostics.consoleErrors.join("\n")).toEqual([]);
  expect(diagnostics.failedRequests, diagnostics.failedRequests.join("\n")).toEqual([]);
}

export function expectNoPageErrors(diagnostics: BrowserDiagnostics): void {
  expect(diagnostics.pageErrors, diagnostics.pageErrors.join("\n")).toEqual([]);
}

/** Keep home-route navigation checks independent from any unverified local API database. */
export async function blockLiveApi(page: Page): Promise<void> {
  await page.route("**/api/v1/**", (route) => route.abort());
}

export function expectLiveApiCalls(
  diagnostics: BrowserDiagnostics,
  paths: readonly string[],
): void {
  const responses = diagnostics.apiResponses;
  for (const path of paths) {
    const matching = responses.filter((response) => response.path === path);
    expect(matching, `Expected the browser to call ${path}`).not.toHaveLength(0);
    expect(matching.map((response) => response.status), `${path} response statuses`).toEqual(
      matching.map(() => 200),
    );
  }
}

export interface LiveProgram {
  readonly externalKey: string;
  readonly code: string;
  readonly name: string;
  readonly directionKey: string;
  readonly directionCode: string | null;
}

export interface LiveCurriculumProgram extends LiveProgram {
  readonly releaseKey: string;
  readonly planKey: string;
  readonly academicYear: string;
  readonly courseName: string;
  readonly expectedHours: number | null;
  readonly expectedCredits: number | null;
  readonly expectedCategoryHours: readonly { readonly categoryCode: string; readonly hours: number }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pageItems(value: unknown): readonly Record<string, unknown>[] {
  expect(value).toEqual(expect.objectContaining({ items: expect.any(Array), page: expect.any(Object) }));
  if (!isRecord(value) || !Array.isArray(value.items)) throw new Error("FastAPI returned an invalid page envelope.");
  return value.items.filter(isRecord);
}

interface LivePageCollection {
  readonly items: readonly Record<string, unknown>[];
  readonly releaseKey: string;
}

async function readLivePages(page: Page, path: string): Promise<LivePageCollection> {
  const items: Record<string, unknown>[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let expectedRelease: string | null = null;
  let expectedTotal: number | null = null;
  do {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const response = await page.request.get(`${path}?${query.toString()}`);
    expect(response.status(), `${path} must return a live API page`).toBe(200);
    const body: unknown = await response.json();
    const records = pageItems(body);
    if (!isRecord(body) || !isRecord(body.page)) throw new Error("FastAPI returned an invalid pagination envelope.");
    const releaseKey = body.page.release_key;
    const totalCount = body.page.total_count;
    const nextCursor = body.page.next_cursor;
    expect(typeof releaseKey).toBe("string");
    expect(typeof totalCount).toBe("number");
    expect(nextCursor === null || typeof nextCursor === "string").toBe(true);
    if (expectedRelease === null) expectedRelease = releaseKey as string;
    if (expectedTotal === null) expectedTotal = totalCount as number;
    expect(releaseKey, `${path} must keep one academic release across pages`).toBe(expectedRelease);
    expect(totalCount, `${path} must keep one total count across pages`).toBe(expectedTotal);
    items.push(...records);
    cursor = typeof nextCursor === "string" ? nextCursor : null;
    if (cursor !== null) {
      expect(seenCursors.has(cursor), `${path} must not repeat a cursor`).toBe(false);
      seenCursors.add(cursor);
    }
  } while (cursor !== null);
  if (expectedTotal !== null) expect(items).toHaveLength(expectedTotal);
  if (expectedRelease === null) throw new Error(`${path} did not return an academic release identity.`);
  return { items, releaseKey: expectedRelease };
}

/** Read fixture identity from the live API instead of baking one curriculum code into a spec. */
export async function discoverLiveProgram(page: Page): Promise<LiveProgram> {
  const response = await page.request.get("/api/v1/programs?limit=100");
  expect(response.status(), "live FastAPI program list status").toBe(200);
  const body: unknown = await response.json();
  expect(body).toEqual(expect.objectContaining({ items: expect.any(Array) }));

  const record = body as { items: unknown[] };
  const first = record.items.find((value): value is Record<string, unknown> => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const candidate = value as Record<string, unknown>;
    return typeof candidate.external_key === "string"
      && typeof candidate.code === "string"
      && candidate.code.trim().length > 0
      && typeof candidate.name === "string"
      && candidate.name.trim().length > 0;
  });
  expect(first, "the isolated academic release must contain a named program").toBeDefined();
  if (!first) throw new Error("The isolated academic release did not contain a named program.");
  return {
    externalKey: first.external_key as string,
    code: first.code as string,
    name: first.name as string,
    directionKey: first.direction_key as string,
    directionCode: typeof first.direction_code === "string" ? first.direction_code : null,
  };
}

function academicYearEnd(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const years = value.match(/(?:19|20)\d{2}/g)?.map(Number) ?? [];
  return years.length ? Math.max(...years) : null;
}

/** Pick canonical programs with unique latest verified plans and independent API totals. */
export async function discoverLiveCurriculumPrograms(
  page: Page,
  requestedCount = 1,
): Promise<readonly LiveCurriculumProgram[]> {
  const [programSnapshot, planSnapshot] = await Promise.all([
    readLivePages(page, "/api/v1/programs"),
    readLivePages(page, "/api/v1/study-plans"),
  ]);
  expect(programSnapshot.releaseKey, "program fixture release identity").toBe(planSnapshot.releaseKey);
  const activeResponse = await page.request.get("/api/v1/release");
  expect(activeResponse.status(), "active release fixture status").toBe(200);
  const activeBody: unknown = await activeResponse.json();
  if (!isRecord(activeBody) || typeof activeBody.release_key !== "string") {
    throw new Error("FastAPI returned an invalid active-release response.");
  }
  expect(activeBody.release_key, "catalog and plans must match the active release").toBe(programSnapshot.releaseKey);

  const programByKey = new Map(programSnapshot.items.flatMap((program) => (
    typeof program.external_key === "string" ? [[program.external_key, program] as const] : []
  )));
  const byProgram = new Map<string, Record<string, unknown>[]>();
  for (const plan of planSnapshot.items) {
    if (typeof plan.program_key !== "string") continue;
    byProgram.set(plan.program_key, [...(byProgram.get(plan.program_key) ?? []), plan]);
  }
  const candidates = [...byProgram.entries()].flatMap(([programKey, programPlans]) => {
    if (!programByKey.has(programKey)) return [];
    const years = programPlans.map((plan) => academicYearEnd(plan.academic_year));
    if (programPlans.length > 1 && years.some((year) => year === null)) return [];
    const latestYear = years.some((year) => year !== null)
      ? Math.max(...years.filter((year): year is number => year !== null))
      : null;
    const latestPlans = latestYear === null
      ? programPlans
      : programPlans.filter((plan) => academicYearEnd(plan.academic_year) === latestYear);
    if (latestPlans.length !== 1) return [];
    const plan = latestPlans[0];
    if (!plan || plan.status !== "parsed" || plan.profile_link_status !== "verified"
      || typeof plan.external_key !== "string" || Number(plan.item_count) <= 0) return [];
    return [plan];
  })
    .sort((left, right) => Number(right.item_count) - Number(left.item_count));

  const discovered: LiveCurriculumProgram[] = [];
  for (const plan of candidates) {
    const program = programByKey.get(plan.program_key as string);
    if (!program || typeof program.name !== "string" || typeof program.code !== "string") continue;
    const itemSnapshot = await readLivePages(
      page,
      `/api/v1/study-plans/${encodeURIComponent(plan.external_key as string)}/items`,
    );
    expect(itemSnapshot.releaseKey, `${plan.external_key} item release identity`).toBe(programSnapshot.releaseKey);
    const items = itemSnapshot.items;
    expect(items).toHaveLength(Number(plan.item_count));
    expect(items.every((item) => item.study_plan_key === plan.external_key)).toBe(true);

    const taxonomyIdentities = new Map<string, { readonly key: string; readonly version: string }>();
    for (const item of items) {
      const classification = isRecord(item.subject_classification) ? item.subject_classification : null;
      if (typeof classification?.taxonomy_key !== "string" || typeof classification.taxonomy_version !== "string") continue;
      taxonomyIdentities.set(`${classification.taxonomy_key}\u0000${classification.taxonomy_version}`, {
        key: classification.taxonomy_key,
        version: classification.taxonomy_version,
      });
    }
    const taxonomyIdentity = taxonomyIdentities.size === 1
      ? [...taxonomyIdentities.values()][0] ?? null
      : taxonomyIdentities.size === 0
        ? { key: "bmstu-subject-domain-16", version: "v1" }
        : null;
    const taxonomyCodes = new Set<string>();
    if (taxonomyIdentity) {
      const taxonomyResponse = await page.request.get(
        `/api/v1/subject-taxonomies/${encodeURIComponent(taxonomyIdentity.key)}/${encodeURIComponent(taxonomyIdentity.version)}`,
      );
      expect(taxonomyResponse.status(), "taxonomy used to independently verify chart category totals").toBe(200);
      const taxonomyBody: unknown = await taxonomyResponse.json();
      if (isRecord(taxonomyBody)
        && taxonomyBody.taxonomy_key === taxonomyIdentity.key
        && taxonomyBody.taxonomy_version === taxonomyIdentity.version
        && Array.isArray(taxonomyBody.categories)) {
        for (const category of taxonomyBody.categories) {
          if (isRecord(category) && typeof category.category_code === "string") taxonomyCodes.add(category.category_code);
        }
      }
    }
    const expectedCategoryHoursByCode = new Map<string, { hours: number; count: number }>();
    for (const item of items) {
      const classification = isRecord(item.subject_classification) ? item.subject_classification : null;
      const categoryCode = taxonomyIdentities.size > 1 || !taxonomyIdentity || !classification
        || classification.review_status !== "classified"
        || classification.taxonomy_key !== taxonomyIdentity.key
        || classification.taxonomy_version !== taxonomyIdentity.version
        || typeof classification.category_code !== "string"
        || !taxonomyCodes.has(classification.category_code)
        ? "unclassified"
        : classification.category_code;
      const hours = finiteNumber(item.total_hours ?? item.hours);
      if (hours === null) continue;
      const aggregate = expectedCategoryHoursByCode.get(categoryCode) ?? { hours: 0, count: 0 };
      expectedCategoryHoursByCode.set(categoryCode, {
        hours: aggregate.hours + hours,
        count: aggregate.count + 1,
      });
    }
    const expectedCategoryHours = [...expectedCategoryHoursByCode]
      .filter(([, metric]) => metric.count > 0)
      .map(([categoryCode, metric]) => ({ categoryCode, hours: metric.hours }));

    const hours: number[] = [];
    const credits: number[] = [];
    for (const item of items) {
      const hoursValue = finiteNumber(item.total_hours ?? item.hours);
      const creditsValue = finiteNumber(item.credits);
      if (hoursValue !== null) hours.push(hoursValue);
      if (creditsValue !== null) credits.push(creditsValue);
    }
    const courseName = items.find((item) => typeof item.discipline_name === "string" && item.discipline_name.trim())?.discipline_name;
    if (typeof courseName !== "string" || (hours.length === 0 && credits.length === 0)) continue;
    discovered.push({
      externalKey: program.external_key as string,
      code: program.code,
      name: program.name,
      directionKey: program.direction_key as string,
      directionCode: typeof program.direction_code === "string" ? program.direction_code : null,
      releaseKey: programSnapshot.releaseKey,
      planKey: plan.external_key as string,
      academicYear: typeof plan.academic_year === "string" ? plan.academic_year : "Год не указан",
      courseName,
      expectedHours: hours.length ? hours.reduce((sum, value) => sum + value, 0) : null,
      expectedCredits: credits.length ? credits.reduce((sum, value) => sum + value, 0) : null,
      expectedCategoryHours,
    });
    if (discovered.length === requestedCount) return discovered;
  }
  throw new Error(`The isolated release needs ${requestedCount} distinct programs with unique latest verified plans and named courses with numeric workload.`);
}

export async function discoverLiveCurriculumProgram(page: Page): Promise<LiveCurriculumProgram> {
  const [program] = await discoverLiveCurriculumPrograms(page, 1);
  if (!program) throw new Error("No verified program fixture was discovered.");
  return program;
}

export type { TestInfo };
