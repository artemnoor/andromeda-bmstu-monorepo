import { expect, test } from "./support.js";

function apiPage(items, releaseKey = "api-fixture", nextCursor = null, totalCount = items.length) {
  return { items, page: { limit: 100, next_cursor: nextCursor, total_count: totalCount, release_key: releaseKey } };
}

function notFound(route, pathname) {
  return route.fulfill({ status: 404, contentType: "application/json", json: { error: { code: "unexpected_fixture_route", message: pathname } } });
}

function sourceUrl(record) {
  return record?.source_url || record?.sources?.find((source) => source?.source_url)?.source_url || "";
}

function isHttpUrl(value) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function russianInteger(value) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value);
}

function requirementLeaves(node) {
  if (!node) return [];
  if (node.kind === "leaf" || node.subject_code) return [node];
  return (node.children || []).flatMap(requirementLeaves);
}

async function readAllPages(request, baseURL, path, params, expectedReleaseKey) {
  const items = [];
  const seenCursors = new Set();
  let cursor = null;
  let totalCount = null;
  do {
    const url = new URL(path, baseURL);
    url.searchParams.set("limit", "100");
    for (const [key, value] of Object.entries(params || {})) url.searchParams.set(key, String(value));
    if (cursor !== null) url.searchParams.set("cursor", cursor);
    const response = await request.get(url.toString());
    expect(response.status(), `${path} returned a successful page`).toBe(200);
    const result = await response.json();
    expect(result.page.release_key, `${path} stayed on the active release`).toBe(expectedReleaseKey);
    totalCount ??= result.page.total_count;
    expect(result.page.total_count, `${path} kept a stable total count`).toBe(totalCount);
    items.push(...result.items);
    const nextCursor = result.page.next_cursor;
    if (nextCursor !== null) {
      expect(seenCursors.has(nextCursor), `${path} did not repeat a cursor`).toBe(false);
      seenCursors.add(nextCursor);
    }
    cursor = nextCursor;
  } while (cursor !== null);
  expect(items, `${path} returned every advertised record`).toHaveLength(totalCount);
  const keys = items.map((item) => item.external_key);
  expect(new Set(keys), `${path} did not duplicate external identities`).toHaveProperty("size", keys.length);
  return items;
}

test("demo mode is explicit, marked, uses snapshots and can switch back to live", async ({ page, browserDiagnostics }) => {
  const apiRequests = [];
  const unexpectedRoutes = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/v1/")) apiRequests.push(request.url());
  });
  await page.goto("programs.html?data=demo");
  await expect(page.locator("#programGrid")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#andromeda-demo-data-banner")).toBeVisible();
  await expect(page.locator("#andromeda-demo-data-banner")).toContainText("это не данные активного API");
  expect(apiRequests).toEqual([]);

  await page.route("**/api/v1/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (["/api/v1/programs", "/api/v1/directions", "/api/v1/departments"].includes(pathname)) {
      return route.fulfill({ status: 200, contentType: "application/json", json: apiPage([], "e2e-empty") });
    }
    unexpectedRoutes.push(pathname);
    return notFound(route, pathname);
  });
  await page.getByRole("link", { name: "Вернуться к API" }).click();
  await expect(page).toHaveURL(/data=live/);
  await expect.poll(() => apiRequests.length).toBeGreaterThan(0);
  expect(unexpectedRoutes).toEqual([]);
});

test("live API failure stays visible and does not switch to demo snapshots", async ({ page, browserDiagnostics }) => {
  await page.route("**/api/v1/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/v1/programs") return route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "fixture_unavailable", message: "Test API unavailable" } }),
    });
    if (["/api/v1/directions", "/api/v1/departments"].includes(pathname)) {
      return route.fulfill({ status: 200, contentType: "application/json", json: apiPage([], "e2e-empty") });
    }
    return notFound(route, pathname);
  });
  browserDiagnostics.allowHttpStatus(503, "/api/v1/programs");
  browserDiagnostics.allowConsoleError("responded with a status of 503");
  await page.goto("programs.html?data=live");
  await expect(page.locator("#programGrid .error-state")).toContainText("Не удалось подключиться к каталогу");
  await expect(page.locator("#programGrid .program-card")).toHaveCount(0);
  await expect(page.locator("#andromeda-demo-data-banner")).toHaveCount(0);
  await expect(page.locator("#programGrid")).toHaveAttribute("aria-busy", "false");
});

test("live catalog follows each cursor once and renders unique records from one release", async ({ page, browserDiagnostics }) => {
  const cursors = [];
  const firstProgram = {
    external_key: "program:page-one",
    code: "01.03.02-ONE",
    name: "<img src=x onerror=window.__apiXss=1>First page program",
    direction_key: "direction:one",
    department_relations: [],
    source_url: "javascript:window.__apiUrlXss=1",
    study_plan_url: "javascript:window.__apiUrlXss=1",
  };
  const secondProgram = {
    external_key: "program:page-two",
    code: "01.03.02-TWO",
    name: "Second page program",
    direction_key: "direction:one",
    department_relations: [],
  };
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    if (pathname === "/api/v1/programs") {
      const cursor = url.searchParams.get("cursor");
      cursors.push(cursor);
      if (cursor === null) return route.fulfill({ json: apiPage([firstProgram], "cursor-fixture", "cursor-two", 2) });
      if (cursor === "cursor-two") return route.fulfill({ json: apiPage([secondProgram], "cursor-fixture", null, 2) });
      return notFound(route, pathname + "?cursor=" + cursor);
    }
    if (["/api/v1/directions", "/api/v1/departments"].includes(pathname)) {
      const items = pathname.endsWith("/directions")
        ? [{ external_key: "direction:one", code: "01.03.02", name: "Applied Mathematics" }]
        : [];
      return route.fulfill({ json: apiPage(items, "cursor-fixture") });
    }
    return notFound(route, pathname);
  });

  await page.goto("programs.html?data=live");
  await expect(page.locator("#programGrid")).toHaveAttribute("aria-busy", "false");
  const cards = page.locator("#programGrid .program-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("First page program");
  await expect(cards.nth(0).locator("img")).toHaveCount(0);
  await expect(cards.nth(0).locator(".program-link")).toHaveCount(0);
  expect(await page.evaluate(() => [window.__apiXss, window.__apiUrlXss])).toEqual([undefined, undefined]);
  await expect(cards.nth(1)).toContainText("Second page program");
  expect(cursors).toEqual([null, "cursor-two"]);
  expect(new Set([firstProgram.external_key, secondProgram.external_key]).size).toBe(2);
});

test("catalog paginates and filters 500 records without duplicate API requests", async ({ page, browserDiagnostics }, testInfo) => {
  const programs = Array.from({ length: 500 }, (_, index) => ({
    external_key: `program:scale-${index + 1}`,
    code: `99.99.01-${String(index + 1).padStart(3, "0")}`,
    name: `Synthetic scale program ${index + 1}`,
    direction_key: "direction:scale",
    department_relations: [],
    ...(index === 0 ? {
      source_url: "javascript:window.__apiUrlXss=1",
      study_plan_url: "javascript:window.__apiUrlXss=1",
    } : {}),
  }));
  const cursors = [];
  const apiRequests = [];
  const cursorIndex = new Map([[null, 0], ...Array.from({ length: 4 }, (_, index) => [`scale-page-${index + 2}`, index + 1])]);
  await page.addInitScript(() => {
    window.__andromedaLongTasks = [];
    try {
      new PerformanceObserver((entries) => {
        window.__andromedaLongTasks.push(...entries.getEntries().map((entry) => entry.duration));
      }).observe({ type: "longtask", buffered: true });
    } catch {
      // Long-task timing is optional in browser engines that do not expose it.
    }
  });
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    apiRequests.push(pathname);
    if (pathname === "/api/v1/programs") {
      const cursor = url.searchParams.get("cursor");
      cursors.push(cursor);
      const index = cursorIndex.get(cursor);
      if (index === undefined) return notFound(route, pathname + "?cursor=" + cursor);
      const nextCursor = index < 4 ? `scale-page-${index + 2}` : null;
      return route.fulfill({
        json: apiPage(programs.slice(index * 100, (index + 1) * 100), "scale-fixture", nextCursor, programs.length),
      });
    }
    if (pathname === "/api/v1/directions") {
      return route.fulfill({ json: apiPage([{ external_key: "direction:scale", code: "99.99.01", name: "Synthetic scale direction" }], "scale-fixture") });
    }
    if (pathname === "/api/v1/departments") return route.fulfill({ json: apiPage([], "scale-fixture") });
    return notFound(route, pathname);
  });

  const startedAt = Date.now();
  await page.goto("programs.html?data=live");
  const cards = page.locator("#programGrid .program-card");
  await expect(cards).toHaveCount(500, { timeout: 20_000 });
  const renderMs = Date.now() - startedAt;
  const browserMetrics = await page.evaluate(() => ({
    longTasksMs: window.__andromedaLongTasks,
    resourceCount: performance.getEntriesByType("resource").length,
  }));
  await testInfo.attach("catalog-500-program-performance.json", {
    body: Buffer.from(JSON.stringify({ renderMs, apiRequestCount: apiRequests.length, ...browserMetrics }, null, 2)),
    contentType: "application/json",
  });

  await expect(page.locator("#programGrid")).toHaveAttribute("aria-busy", "false");
  expect(cursors).toEqual([null, "scale-page-2", "scale-page-3", "scale-page-4", "scale-page-5"]);
  expect(apiRequests).toHaveLength(7);
  expect(renderMs).toBeLessThan(15_000);
  await expect(cards.first()).toContainText("Synthetic scale program 1");
  await expect(cards.last()).toContainText("Synthetic scale program 500");
  await expect(cards.first().locator(".program-link")).toHaveCount(0);
  expect(await page.evaluate(() => window.__apiUrlXss)).toBeUndefined();
  await page.getByRole("searchbox", { name: "Поиск по каталогу" }).fill("99.99.01-499");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Synthetic scale program 499");
});

test("@live verifies academic DTO relationships and renders PostgreSQL-backed facts", async ({ page, request, browserDiagnostics }, testInfo) => {
  test.skip(process.env.PLAYWRIGHT_LIVE_API !== "1", "Set PLAYWRIGHT_LIVE_API=1 and run the isolated API test stack.");
  const baseURL = String(testInfo.project.use.baseURL);
  const browserApiResponses = [];
  page.on("response", (response) => {
    try {
      const url = new URL(response.url());
      if (url.pathname.startsWith("/api/v1/")) browserApiResponses.push({ path: url.pathname, search: url.search, status: response.status() });
    } catch {
      // Ignore non-HTTP browser responses.
    }
  });
  const healthResponse = await request.get(new URL("/api/v1/health", baseURL).toString());
  expect(healthResponse.status()).toBe(200);
  const health = await healthResponse.json();
  expect(health.status).toBe("ready");
  expect(health.active_release_key).toBeTruthy();

  const directApiOrigin = process.env.API_ORIGIN || baseURL;
  const directHealthResponse = await request.get(new URL("/api/v1/health", directApiOrigin).toString(), {
    headers: { Origin: "https://untrusted-origin.invalid" },
  });
  expect(directHealthResponse.status()).toBe(200);
  expect(directHealthResponse.headers()["access-control-allow-origin"]).toBeUndefined();
  const directWriteResponse = await request.post(new URL("/api/v1/programs", directApiOrigin).toString(), {
    data: { name: "unauthorized write probe" },
  });
  expect(directWriteResponse.status()).toBe(405);

  const releaseResponse = await request.get(new URL("/api/v1/release", baseURL).toString());
  expect(releaseResponse.status()).toBe(200);
  expect((await releaseResponse.json()).release_key).toBe(health.active_release_key);

  const allDirections = await readAllPages(request, baseURL, "/api/v1/directions", {}, health.active_release_key);
  const allDepartments = await readAllPages(request, baseURL, "/api/v1/departments", {}, health.active_release_key);
  const allStudyPlans = await readAllPages(request, baseURL, "/api/v1/study-plans", {}, health.active_release_key);
  const allPlaceQuotas = await readAllPages(
    request,
    baseURL,
    "/api/v1/place-quotas",
    { campaign_key: "campaign:bmstu:2026" },
    health.active_release_key,
  );
  expect(allPlaceQuotas).toEqual([]);

  const allPrograms = [];
  const seenCursors = new Set();
  let cursor = null;
  let totalCount = null;
  do {
    const url = new URL("/api/v1/programs", baseURL);
    url.searchParams.set("limit", "100");
    if (cursor !== null) url.searchParams.set("cursor", cursor);
    const response = await request.get(url.toString());
    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result.page.release_key).toBe(health.active_release_key);
    totalCount ??= result.page.total_count;
    expect(result.page.total_count).toBe(totalCount);
    allPrograms.push(...result.items);
    const nextCursor = result.page.next_cursor;
    if (nextCursor !== null) {
      expect(seenCursors.has(nextCursor)).toBe(false);
      seenCursors.add(nextCursor);
    }
    cursor = nextCursor;
  } while (cursor !== null);
  expect(allPrograms.length).toBeGreaterThan(0);
  expect(allPrograms.length).toBe(totalCount);
  const keys = allPrograms.map((program) => program.external_key);
  expect(new Set(keys).size).toBe(keys.length);
  const directionsByKey = new Map(allDirections.map((direction) => [direction.external_key, direction]));
  const departmentsByKey = new Map(allDepartments.map((department) => [department.external_key, department]));
  expect(allPrograms.filter((program) => program.direction_key).every((program) => directionsByKey.has(program.direction_key))).toBe(true);
  for (const program of allPrograms) {
    for (const relation of program.department_relations || []) {
      if (relation.verification_status === "verified") expect(departmentsByKey.has(relation.department_key)).toBe(true);
    }
    expect(program.sources.length).toBeGreaterThan(0);
  }

  const programByKey = new Map(allPrograms.map((program) => [program.external_key, program]));
  const linkedPlan = allStudyPlans.find((plan) => plan.status === "parsed"
    && plan.profile_link_status === "verified"
    && Number(plan.item_count) > 0
    && programByKey.has(plan.program_key));
  expect(linkedPlan, "seed release contains a verified parsed study plan linked to a canonical program").toBeTruthy();
  const linkedProgram = programByKey.get(linkedPlan.program_key);
  expect(linkedPlan.profile_code).toBe(linkedProgram.code);
  expect(linkedPlan.sources.length).toBeGreaterThan(0);
  const curriculumItems = await readAllPages(
    request,
    baseURL,
    `/api/v1/study-plans/${encodeURIComponent(linkedPlan.external_key)}/items`,
    {},
    health.active_release_key,
  );
  expect(curriculumItems.length).toBe(linkedPlan.item_count);
  expect(curriculumItems.every((item) => item.sources.length > 0)).toBe(true);

  const campaigns = await readAllPages(request, baseURL, "/api/v1/campaigns", { year: 2026 }, health.active_release_key);
  const campaign = campaigns.find((record) => record.campaign_kind === "admission" && Number(record.year) === 2026);
  expect(campaign, "seed release contains a 2026 admission campaign").toBeTruthy();
  expect(campaign.sources.length).toBeGreaterThan(0);
  const encodedCampaign = encodeURIComponent(campaign.external_key);
  const calendar = await readAllPages(request, baseURL, `/api/v1/campaigns/${encodedCampaign}/calendar`, {}, health.active_release_key);
  const offerings = await readAllPages(request, baseURL, `/api/v1/campaigns/${encodedCampaign}/offerings`, {}, health.active_release_key);
  const pools = await readAllPages(request, baseURL, "/api/v1/competition-pools", { campaign_key: campaign.external_key }, health.active_release_key);
  const targetedPool = pools.find((pool) => pool.quota_type === "targeted"
    && pool.scope_level === "direction_and_target_organization"
    && pool.target_organization
    && pool.direction_code);
  const quotas = await readAllPages(request, baseURL, "/api/v1/place-quotas", { campaign_key: campaign.external_key }, health.active_release_key);
  const requirements = await readAllPages(request, baseURL, "/api/v1/requirements", { campaign_key: campaign.external_key }, health.active_release_key);
  const achievements = await readAllPages(request, baseURL, "/api/v1/individual-achievements", { campaign_key: campaign.external_key }, health.active_release_key);
  const tuition = await readAllPages(request, baseURL, "/api/v1/tuition", {}, health.active_release_key);
  const historicalStatistics = await readAllPages(request, baseURL, "/api/v1/statistics", { kind: "historical" }, health.active_release_key);
  const campaignStatistics = await readAllPages(request, baseURL, "/api/v1/statistics", { kind: "admission", year: 2026 }, health.active_release_key);
  const exams = await readAllPages(request, baseURL, "/api/v1/exams", {}, health.active_release_key);
  const taxonomyClassification = curriculumItems
    .map((item) => item.subject_classification || item.subjectClassification)
    .find((classification) => classification?.taxonomy_key && classification?.taxonomy_version);
  const taxonomyKey = taxonomyClassification?.taxonomy_key || "bmstu-subject-domain-16";
  const taxonomyVersion = taxonomyClassification?.taxonomy_version || "v1";
  const taxonomyResponse = await request.get(new URL(
    `/api/v1/subject-taxonomies/${encodeURIComponent(taxonomyKey)}/${encodeURIComponent(taxonomyVersion)}`,
    baseURL,
  ).toString());
  expect(taxonomyResponse.status()).toBe(200);
  const taxonomy = await taxonomyResponse.json();
  expect(Array.isArray(taxonomy.categories)).toBe(true);
  expect(taxonomy.categories.length).toBeGreaterThan(0);
  expect(calendar.length).toBeGreaterThan(0);
  expect(offerings.length).toBeGreaterThan(0);
  expect(pools.length).toBeGreaterThan(0);
  expect(pools.some((pool) => pool.quota_type && Number(pool.places) > 0)).toBe(true);
  expect(targetedPool, "seed release preserves source-backed targeted organization fields").toBeTruthy();
  expect(targetedPool.target_organization_inn).toMatch(/^\d+$/);
  expect(targetedPool.target_organization_kpp).toMatch(/^\d+$/);
  expect(targetedPool.target_organization_ogrn).toMatch(/^\d+$/);
  expect(targetedPool.target_region).toBeTruthy();
  expect(targetedPool.campus_label_in_document).toBeTruthy();
  // The current release has no place_quota_assertions records; when that table
  // is populated, every row still has a valid value and pool relation.
  expect(quotas.every((quota) => Number.isInteger(quota.places) && quota.places >= 0)).toBe(true);
  expect(quotas.filter((quota) => quota.pool_key).every((quota) => pools.some((pool) => pool.external_key === quota.pool_key)),
    "place quota rows refer to a competition pool in the same release").toBe(true);
  expect(requirements.length).toBeGreaterThan(0);
  expect(achievements.length).toBeGreaterThan(0);
  expect(tuition.length).toBeGreaterThan(0);
  expect(historicalStatistics.length).toBeGreaterThan(0);
  expect(campaignStatistics.length).toBeGreaterThan(0);
  expect(exams.length).toBeGreaterThan(0);
  expect(offerings.filter((offering) => offering.program_link_status === "exact").every((offering) => programByKey.has(offering.program_key))).toBe(true);
  expect(requirements.every((requirement) => requirement.root && ["AND", "OR", "AT_LEAST"].includes(requirement.root.operator))).toBe(true);
  expect(tuition.every((record) => record.currency && !String(record.academic_year || "").toLowerCase().includes("unspecified"))).toBe(true);
  expect([...offerings, ...requirements, ...achievements, ...tuition, ...historicalStatistics].every((record) => record.sources.length > 0)).toBe(true);

  const expectedProgram = allPrograms.find((program) => {
    const direction = directionsByKey.get(program.direction_key);
    const relation = (program.department_relations || []).find((item) => item.verification_status === "verified");
    return direction && relation && departmentsByKey.has(relation.department_key);
  });
  expect(expectedProgram, "seed release has a program with verified direction and department identities").toBeTruthy();
  const expectedDirection = directionsByKey.get(expectedProgram.direction_key);
  const expectedDepartmentRelation = expectedProgram.department_relations.find((item) => item.verification_status === "verified");
  const expectedDepartment = departmentsByKey.get(expectedDepartmentRelation.department_key);

  const admissionProgram = allPrograms.find((program) => {
    const direction = directionsByKey.get(program.direction_key);
    const departmentRelation = (program.department_relations || []).find((item) => item.verification_status === "verified");
    const department = departmentRelation && departmentsByKey.get(departmentRelation.department_key);
    const departmentCode = department?.official_code || department?.code || "";
    if (!direction || !departmentCode) return false;

    const exactOfferingKeys = new Set(offerings
      .filter((offering) => offering.program_link_status === "exact" && offering.program_key === program.external_key)
      .map((offering) => offering.external_key));
    const generalPools = pools.filter((pool) => pool.direction_code === direction.code
      && pool.quota_type === "general_competition");
    const linkedPools = generalPools.filter((pool) => [
      ...(Array.isArray(pool.offering_keys) ? pool.offering_keys : []),
      pool.offering_key,
    ].some((key) => exactOfferingKeys.has(key)));
    const departmentPools = generalPools.filter((pool) => pool.scope_level === "department" && pool.department_code === departmentCode);
    const directionPools = generalPools.filter((pool) => pool.scope_level === "direction" && !pool.department_code);
    const scopePools = linkedPools.length ? linkedPools : departmentPools.length ? departmentPools : directionPools;
    const budgetPoolWithPlaces = scopePools.some((pool) => pool.funding_type === "budget"
      && pool.places !== null && pool.places !== undefined);
    const sourcedRequirement = requirements.some((requirement) => requirement.direction_code === direction.code
      && isHttpUrl(sourceUrl(requirement))
      && requirementLeaves(requirement.root).some((leaf) => leaf.subject_code && leaf.minimum_score !== null && leaf.minimum_score !== undefined));
    return budgetPoolWithPlaces && sourcedRequirement;
  });
  expect(admissionProgram, "seed release has a verified program with budget and sourced 2026 exam facts").toBeTruthy();

  const admissionDirection = directionsByKey.get(admissionProgram.direction_key);
  const admissionRelation = admissionProgram.department_relations.find((item) => item.verification_status === "verified");
  const admissionDepartment = departmentsByKey.get(admissionRelation.department_key);
  const admissionDepartmentCode = admissionDepartment.official_code || admissionDepartment.code;
  const exactOfferingKeys = new Set(offerings
    .filter((offering) => offering.program_link_status === "exact" && offering.program_key === admissionProgram.external_key)
    .map((offering) => offering.external_key));
  const relevantGeneralPools = pools.filter((pool) => pool.direction_code === admissionDirection.code
    && pool.quota_type === "general_competition");
  const linkedPools = relevantGeneralPools.filter((pool) => [
    ...(Array.isArray(pool.offering_keys) ? pool.offering_keys : []),
    pool.offering_key,
  ].some((key) => exactOfferingKeys.has(key)));
  const departmentPools = relevantGeneralPools.filter((pool) => pool.scope_level === "department" && pool.department_code === admissionDepartmentCode);
  const directionPools = relevantGeneralPools.filter((pool) => pool.scope_level === "direction" && !pool.department_code);
  const admissionScopePools = linkedPools.length ? linkedPools : departmentPools.length ? departmentPools : directionPools;
  const admissionBudgetPools = admissionScopePools.filter((pool) => pool.funding_type === "budget");
  const knownBudgetPools = admissionBudgetPools.filter((pool) => pool.places !== null && pool.places !== undefined);
  const unknownBudgetPoolCount = admissionBudgetPools.length - knownBudgetPools.length;
  const expectedBudgetPlaces = knownBudgetPools.reduce((sum, pool) => sum + Number(pool.places), 0);
  const expectedBudgetLabel = unknownBudgetPoolCount
    ? knownBudgetPools.length ? "Частичные данные" : "Не указано"
    : russianInteger(expectedBudgetPlaces);
  const expectedPoolSource = admissionBudgetPools.map(sourceUrl).find(isHttpUrl) || null;
  const expectedRequirement = requirements.find((requirement) => requirement.direction_code === admissionDirection.code
    && isHttpUrl(sourceUrl(requirement))
    && requirementLeaves(requirement.root).some((leaf) => leaf.subject_code && leaf.minimum_score !== null && leaf.minimum_score !== undefined));
  const expectedExamLeaf = requirementLeaves(expectedRequirement.root)
    .find((leaf) => leaf.subject_code && leaf.minimum_score !== null && leaf.minimum_score !== undefined);
  const expectedCurriculumItem = curriculumItems.find((item) => item.discipline_name);
  expect(expectedCurriculumItem, "verified study plan includes a named curriculum item").toBeTruthy();
  const taxonomyCategoryCodes = new Set(taxonomy.categories
    .filter((category) => category.name || category.category_name)
    .map((category) => category.category_code || category.code)
    .filter(Boolean));

  await page.goto("programs.html?data=live");
  await expect(page.locator("#programGrid")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#programGrid .program-card")).toHaveCount(totalCount);
  const card = page.locator("#programGrid .program-card").filter({ hasText: expectedProgram.code });
  await expect(card).toBeVisible();
  await expect(card.locator(".program-title")).toHaveText(expectedProgram.name);
  await expect(card.locator(".program-fact").filter({ hasText: "Направление" })).toContainText(expectedDirection.code + " · " + expectedDirection.name);
  await expect(card.locator(".program-fact").filter({ hasText: "Кафедра" })).toContainText((expectedDepartment.official_code || expectedDepartment.code) + " · " + expectedDepartment.name);
  await expect(page.locator("#andromeda-demo-data-banner")).toHaveCount(0);

  // Drive the live comparison from browser storage so study plans, curriculum
  // items, and taxonomy flow through Node's same-origin proxy into FastAPI.
  const comparisonProgramKeys = [...new Set([linkedProgram.external_key, admissionProgram.external_key])];
  const comparisonDirectionCodes = [...new Set([expectedDirection.code, admissionDirection.code])];
  const compareRequestStart = browserApiResponses.length;
  const comparisonStartedAt = Date.now();
  await page.evaluate((programKeys) => {
    localStorage.setItem("andromeda.compare.v1", JSON.stringify(programKeys));
  }, comparisonProgramKeys);
  await page.goto("compare.html?data=live");
  await expect(page.locator("#compareContent")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".category-comparison-board")).toBeVisible();
  await expect(page.locator(".category-program-head > .category-program-code")).toHaveText(linkedProgram.code);
  await expect(page.locator(".category-count-tag")).toContainText(String(taxonomyCategoryCodes.size));
  await expect(page.locator(".comparison-table")).toBeVisible();
  const comparisonProgramCodes = await page.locator(".comparison-table thead .program-head-code").allTextContents();
  const admissionColumnIndex = comparisonProgramCodes.findIndex((code) => code === admissionProgram.code);
  expect(admissionColumnIndex, "comparison table includes the program used for admission fact checks").toBeGreaterThanOrEqual(0);
  const comparisonBudgetRow = page.locator(".comparison-table tbody tr").filter({ hasText: "Бюджетные места · общий конкурс" });
  await expect(comparisonBudgetRow.locator("td").nth(admissionColumnIndex).locator(".overview-value strong"))
    .toHaveText(expectedBudgetLabel);
  if (unknownBudgetPoolCount && knownBudgetPools.length) {
    await expect(comparisonBudgetRow.locator("td").nth(admissionColumnIndex).locator(".overview-value span"))
      .toContainText("полная сумма не подтверждена");
  }
  const comparisonApiRequests = browserApiResponses.slice(compareRequestStart);
  const comparisonPoolRequests = comparisonApiRequests.filter((response) => response.path === "/api/v1/competition-pools");
  expect(comparisonPoolRequests.length).toBeGreaterThan(0);
  expect(comparisonPoolRequests.every((response) => comparisonDirectionCodes.includes(new URLSearchParams(response.search).get("direction_code"))))
    .toBe(true);
  const comparisonRenderMs = Date.now() - comparisonStartedAt;
  await testInfo.attach("live-comparison-performance.json", {
    body: Buffer.from(JSON.stringify({ renderMs: comparisonRenderMs, apiRequestCount: comparisonApiRequests.length }, null, 2)),
    contentType: "application/json",
  });
  expect(comparisonRenderMs).toBeLessThan(15_000);
  await page.locator(".matrix-details > summary").click();
  await expect(page.locator(".matrix-table .matrix-course-title").filter({ hasText: expectedCurriculumItem.discipline_name }).first()).toBeVisible();

  // Open the real admission page as well as the catalog card. Its pool values
  // must agree with the API records, while missing source URLs stay absent.
  await page.goto(`admission.html?data=live&direction=${encodeURIComponent(admissionDirection.code)}`);
  await expect(page.locator("#dataStatus")).toHaveText("Актуальные данные через API каталога");
  await expect(page.locator("#directionFilter")).toHaveValue(admissionDirection.code);
  await expect(page.locator("#requirements .exam-rule")).not.toHaveCount(0);
  await expect(page.locator("#requirements")).toContainText(russianInteger(Number(expectedExamLeaf.minimum_score)));
  await expect(page.locator("#requirements a.source-link").first()).toHaveAttribute("href", sourceUrl(expectedRequirement));
  const visibleBudgetPool = knownBudgetPools[0];
  const visibleQuotaLabel = { general_competition: "Общий конкурс", special: "Особая квота", separate: "Отдельная квота", targeted: "Целевой приём" }[visibleBudgetPool.quota_type];
  const visiblePoolRow = page.locator("#pools .pool-row").filter({ hasText: visibleQuotaLabel }).filter({ hasText: "Бюджет" }).first();
  await expect(visiblePoolRow.locator(".pool-places")).toHaveText(russianInteger(Number(visibleBudgetPool.places)));

  await page.goto(`admission.html?data=live&direction=${encodeURIComponent(targetedPool.direction_code)}`);
  const targetRow = page.locator("#pools .pool-row").filter({ hasText: targetedPool.target_organization }).first();
  await expect(targetRow).toContainText(`ИНН ${targetedPool.target_organization_inn}`);
  await expect(targetRow).toContainText(`КПП ${targetedPool.target_organization_kpp}`);
  await expect(targetRow).toContainText(`ОГРН ${targetedPool.target_organization_ogrn}`);
  await expect(targetRow).toContainText(targetedPool.target_region);
  await expect(targetRow).toContainText(targetedPool.campus_label_in_document);

  // Reopen the catalog and verify independently computed real admission facts.
  await page.goto("programs.html?data=live");
  await expect(page.locator("#programGrid")).toHaveAttribute("aria-busy", "false");
  const admissionCard = page.locator("#programGrid .program-card").filter({ hasText: admissionProgram.code });
  await admissionCard.locator(".program-summary").click();
  const admissionPanel = admissionCard.locator(".admission-panel");
  await expect(admissionPanel.locator(".admission-section h3").filter({ hasText: "Места на приём 2026" })).toBeVisible();
  const budgetMetric = admissionPanel.locator(".admission-metric").filter({ hasText: "Бюджет · общий конкурс" });
  await expect(budgetMetric.locator("strong")).toHaveText(expectedBudgetLabel);
  if (unknownBudgetPoolCount && knownBudgetPools.length) {
    await expect(budgetMetric).toContainText("полная сумма не подтверждена");
  }
  const poolSourceLink = admissionPanel.locator("a.admission-source").filter({ hasText: "Документ о местах" });
  if (expectedPoolSource) await expect(poolSourceLink).toHaveAttribute("href", expectedPoolSource);
  else await expect(poolSourceLink).toHaveCount(0);
  const requirementSection = admissionPanel.locator(".admission-section").filter({ hasText: "Минимальные баллы ЕГЭ · 2026" });
  await expect(requirementSection.locator("h3")).toBeVisible();
  await expect(requirementSection).toContainText(russianInteger(Number(expectedExamLeaf.minimum_score)));
  await expect(requirementSection.locator("a.admission-source").filter({ hasText: "Требования приёма" })).toHaveAttribute("href", sourceUrl(expectedRequirement));

  const requiredBrowserApiPaths = [
    "/api/v1/study-plans",
    `/api/v1/study-plans/${encodeURIComponent(linkedPlan.external_key)}/items`,
    `/api/v1/subject-taxonomies/${encodeURIComponent(taxonomyKey)}/${encodeURIComponent(taxonomyVersion)}`,
    "/api/v1/campaigns",
    `/api/v1/campaigns/${encodeURIComponent(campaign.external_key)}/calendar`,
    `/api/v1/campaigns/${encodeURIComponent(campaign.external_key)}/offerings`,
    "/api/v1/competition-pools",
    "/api/v1/requirements",
    "/api/v1/individual-achievements",
    "/api/v1/tuition",
    "/api/v1/statistics",
  ];
  for (const requiredPath of requiredBrowserApiPaths) {
    expect(browserApiResponses.some((response) => response.path === requiredPath && response.status === 200),
      `browser loaded ${requiredPath} through the web server proxy`).toBe(true);
  }
});

test("@live profile loads achievements without requesting unrelated admission collections", async ({ page, browserDiagnostics }, testInfo) => {
  test.skip(process.env.PLAYWRIGHT_LIVE_API !== "1", "Set PLAYWRIGHT_LIVE_API=1 and run the isolated API test stack.");
  const requestedPaths = [];
  page.on("request", (request) => {
    try {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/v1/")) requestedPaths.push(url.pathname);
    } catch {
      // Ignore browser-internal requests.
    }
  });

  await page.goto("profile.html?data=live");
  await expect(page.locator("#achievementList .achievement-option").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#targetDirection option").nth(1)).toBeAttached();
  const admissionPaths = requestedPaths.filter((path) => [
    "/api/v1/campaigns",
    "/api/v1/individual-achievements",
    "/api/v1/competition-pools",
    "/api/v1/requirements",
    "/api/v1/tuition",
    "/api/v1/statistics",
  ].includes(path));
  expect(admissionPaths).toContain("/api/v1/campaigns");
  expect(admissionPaths).toContain("/api/v1/individual-achievements");
  expect(admissionPaths).not.toContain("/api/v1/competition-pools");
  expect(admissionPaths).not.toContain("/api/v1/requirements");
  expect(admissionPaths).not.toContain("/api/v1/tuition");
  expect(admissionPaths).not.toContain("/api/v1/statistics");
  await testInfo.attach("profile-api-request-scope.json", {
    body: Buffer.from(JSON.stringify(admissionPaths, null, 2)),
    contentType: "application/json",
  });
});

test("profile remains usable when localStorage is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage is disabled", "SecurityError");
      },
    });
  });
  await page.goto("profile.html?data=demo");
  await expect(page.locator("#profileForm")).toBeVisible();
  await page.locator("#score-mathematics").fill("88");
  await page.getByRole("button", { name: "Сохранить профиль" }).click();
  await expect(page.locator("#saveStatus")).toContainText("Не удалось сохранить локально");
});
