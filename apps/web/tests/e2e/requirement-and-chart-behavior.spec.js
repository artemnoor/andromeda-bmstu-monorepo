import { expect, test } from "./support.js";

const releaseKey = "behavior-fixture-release";
const campaignKey = "campaign:behavior:2026";
const directionCode = "01.03.02";
const pageResponse = (items) => ({
  items,
  page: { limit: 100, next_cursor: null, total_count: items.length, release_key: releaseKey },
});
const leaf = (subject_code, minimum_score = 50) => ({ kind: "leaf", subject_code, minimum_score });
const group = (operator, children, threshold) => ({ kind: "operator", operator, children, ...(threshold === undefined ? {} : { threshold }) });

// Expected results are explicit truth-table cases, independent of the UI's evaluator.
const requirementCases = [
  { name: "AND passes only when all nested conditions pass", root: group("AND", [leaf("mathematics"), group("OR", [leaf("physics"), leaf("chemistry")])]), scores: { mathematics: 50, physics: 50 }, expected: "подтверждён допустимый вариант условий" },
  { name: "AND fails when one known condition fails even if another is unknown", root: group("AND", [leaf("mathematics"), leaf("physics")]), scores: { mathematics: 49 }, expected: "часть минимумов не достигнута" },
  { name: "AND with a missing score remains undecided", root: group("AND", [leaf("mathematics"), leaf("physics")]), scores: { mathematics: 70 }, expected: "Заполни баллы ЕГЭ" },
  { name: "OR passes with one passing score and one unknown score", root: group("OR", [leaf("mathematics"), leaf("physics")]), scores: { mathematics: 50 }, expected: "подтверждён допустимый вариант условий" },
  { name: "OR passes through a known alternative when another minimum is unpublished", root: group("OR", [leaf("mathematics"), leaf("physics", null)]), scores: { mathematics: 50, physics: 100 }, expected: "подтверждён допустимый вариант условий" },
  { name: "OR fails only when all alternatives are known failures", root: group("OR", [leaf("mathematics"), leaf("physics")]), scores: { mathematics: 49, physics: 49 }, expected: "часть минимумов не достигнута" },
  { name: "OR with a failed and an unknown alternative stays undecided", root: group("OR", [leaf("mathematics"), leaf("physics")]), scores: { mathematics: 49 }, expected: "Заполни баллы ЕГЭ" },
  { name: "AT_LEAST two passes with two known passes and an unknown third", root: group("AT_LEAST", [leaf("mathematics"), leaf("physics"), leaf("chemistry")], 2), scores: { mathematics: 50, physics: 50 }, expected: "подтверждён допустимый вариант условий" },
  { name: "AT_LEAST two fails when at most one remaining alternative can pass", root: group("AT_LEAST", [leaf("mathematics"), leaf("physics"), leaf("chemistry")], 2), scores: { mathematics: 49, physics: 49 }, expected: "часть минимумов не достигнута" },
  { name: "AT_LEAST two remains undecided when its missing score can change the result", root: group("AT_LEAST", [leaf("mathematics"), leaf("physics"), leaf("chemistry")], 2), scores: { mathematics: 50, physics: 49 }, expected: "Заполни баллы ЕГЭ" },
  { name: "an unpublished minimum is not treated as a zero threshold", root: group("AND", [leaf("mathematics", null)]), scores: { mathematics: 100 }, expected: "эти условия нельзя проверить" },
  { name: "an explicit zero score and zero published minimum remain valid", root: group("AND", [leaf("mathematics", 0)]), scores: { mathematics: 0 }, expected: "подтверждён допустимый вариант условий" },
];

for (const scenario of requirementCases) {
  test(`admission requirement semantics: ${scenario.name}`, async ({ page, browserDiagnostics }) => {
    await page.addInitScript((scores) => {
      localStorage.setItem("andromeda.applicant.v1", JSON.stringify({ scores }));
    }, scenario.scores);
    await page.route("**/api/v1/**", (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/api/v1/programs") return route.fulfill({ json: pageResponse([{
        external_key: "program:behavior", code: "01.03.02-01", name: "Requirement behavior program",
        direction_key: "direction:behavior", department_relations: [],
      }]) });
      if (pathname === "/api/v1/directions") return route.fulfill({ json: pageResponse([{
        external_key: "direction:behavior", code: directionCode, name: "Applied mathematics",
      }]) });
      if (pathname === "/api/v1/campaigns") return route.fulfill({ json: pageResponse([{
        external_key: campaignKey, year: 2026, campaign_kind: "admission", sources: [],
      }]) });
      if (pathname === "/api/v1/requirements") return route.fulfill({ json: pageResponse([{
        external_key: "requirement:behavior", direction_code: directionCode, root: scenario.root, sources: [],
      }]) });
      if (["/api/v1/departments", "/api/v1/competition-pools", "/api/v1/individual-achievements", "/api/v1/tuition", "/api/v1/statistics"].includes(pathname)
        || pathname.endsWith("/calendar") || pathname.endsWith("/offerings")) {
        return route.fulfill({ json: pageResponse([]) });
      }
      return route.fulfill({ status: 404, json: { error: { code: "unexpected_fixture_route", message: pathname } } });
    });
    await page.goto(`admission.html?data=live&direction=${directionCode}`);
    await expect(page.locator("#dataStatus")).toHaveText("Актуальные данные через API каталога");
    await expect(page.locator("#requirements .exam-rule").first()).toBeVisible();
    await expect(page.locator("#scoreEvaluation")).toContainText(scenario.expected);
    await expect(page.locator("#scoreEvaluation")).toContainText("не прогноз конкурса");
    await expect(page.locator("#andromeda-demo-data-banner")).toHaveCount(0);
  });
}

test("comparison category selection, keyboard chart activation, details and discipline search agree", async ({ page, browserDiagnostics }) => {
  const programs = [
    { external_key: "program:a", code: "P-A", name: "Program A", direction_key: null, department_relations: [] },
    { external_key: "program:b", code: "P-B", name: "Program B", direction_key: null, department_relations: [] },
  ];
  const plans = programs.map((program) => ({
    external_key: `plan:${program.external_key}`, program_key: program.external_key,
    academic_year: "2025-2026", status: "parsed", profile_link_status: "verified", item_count: 2,
  }));
  const curriculum = (programKey) => [
    { external_key: `item:${programKey}:mathematics`, ordinal: 1, discipline_name: "Linear Algebra", semester: 1, credits: 4, total_hours: programKey === "program:a" ? 160 : 120,
      subject_classification: { category_code: "03", category_name: "Mathematics", taxonomy_key: "behavior-taxonomy", taxonomy_version: "v1", review_status: "classified" } },
    { external_key: `item:${programKey}:physics`, ordinal: 2, discipline_name: "Physics", semester: 2, credits: 2, total_hours: programKey === "program:a" ? 40 : 80,
      subject_classification: { category_code: "04", category_name: "Physics", taxonomy_key: "behavior-taxonomy", taxonomy_version: "v1", review_status: "classified" } },
  ];
  await page.addInitScript(() => localStorage.setItem("andromeda.compare.v1", JSON.stringify(["program:a", "program:b"])));
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    if (pathname === "/api/v1/programs") return route.fulfill({ json: pageResponse(programs) });
    if (["/api/v1/directions", "/api/v1/departments", "/api/v1/campaigns"].includes(pathname)) return route.fulfill({ json: pageResponse([]) });
    if (pathname === "/api/v1/study-plans") return route.fulfill({ json: pageResponse(plans.filter((plan) => plan.program_key === url.searchParams.get("program_key"))) });
    if (pathname.includes("/study-plans/") && pathname.endsWith("/items")) {
      const planKey = decodeURIComponent(pathname.split("/").at(-2));
      const plan = plans.find((candidate) => candidate.external_key === planKey);
      return route.fulfill({ json: pageResponse(plan ? curriculum(plan.program_key) : []) });
    }
    if (pathname.endsWith("/subject-taxonomies/behavior-taxonomy/v1")) return route.fulfill({ json: { categories: [
      { category_code: "03", category_name: "Mathematics" }, { category_code: "04", category_name: "Physics" },
    ] } });
    return route.fulfill({ status: 404, json: { error: { code: "unexpected_fixture_route", message: pathname } } });
  });
  await page.goto("compare.html?data=live");
  const board = page.locator(".category-comparison-board");
  await expect(board).toBeVisible();
  const physicsLegend = board.locator(".category-shared-select").filter({ hasText: "Physics" });
  await physicsLegend.click();
  await expect(physicsLegend).toHaveAttribute("aria-pressed", "true");
  await expect(board.locator(".category-donut-center strong")).toHaveText(["20%", "40%"]);
  await expect(board.locator(".category-donut-center span")).toHaveText(["Physics", "Physics"]);
  const mathematicsSegment = board.locator(".category-donut-segment[aria-label^='Mathematics:']").first();
  await mathematicsSegment.focus();
  await page.keyboard.press("Enter");
  await expect(mathematicsSegment).toHaveAttribute("aria-pressed", "true");
  await expect(physicsLegend).toHaveAttribute("aria-pressed", "false");
  await expect(board.locator(".category-donut-center strong")).toHaveText(["80%", "60%"]);
  await page.getByRole("button", { name: "Подробнее о категории «Physics»" }).click();
  const dialog = page.locator(".category-subject-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".category-dialog-title")).toHaveText("Physics");
  await expect(dialog.locator(".category-dialog-subject-name")).toHaveText(["Physics", "Physics"]);
  await expect(dialog.locator(".category-dialog-subject-meta").nth(0)).toContainText("40 ч.");
  await expect(dialog.locator(".category-dialog-subject-meta").nth(1)).toContainText("80 ч.");
  await expect(dialog.locator(".category-dialog-close")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  const matrix = page.locator(".matrix-details");
  await matrix.locator("summary").click();
  await matrix.locator("#courseMatrixSearch").fill("PHYS");
  await expect(matrix.locator("th.matrix-course-title")).toContainText(["Physics"]);
  await expect(matrix.locator(".matrix-results")).toHaveText("Показано 1 из 2 названий.");
  await matrix.locator("#courseMatrixSearch").fill("no such discipline");
  await expect(matrix.locator(".matrix-no-results")).toHaveText("По этим фильтрам дисциплин нет.");
  await matrix.locator("#courseMatrixSearch").fill("");
  await expect(matrix.locator("th.matrix-course-title")).toHaveCount(2);
  await expect(matrix.locator(".matrix-results")).toHaveText("Показано 2 из 2 названий.");
});
