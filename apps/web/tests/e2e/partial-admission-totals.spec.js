import { expect, test } from "./support.js";

const programKey = "program:partial-admission";
const programCode = "01.03.02-PARTIAL";
const directionCode = "01.03.02";
const campaignKey = "campaign:partial-admission:2026";
const responsePage = (items) => ({
  items,
  page: { limit: 100, next_cursor: null, total_count: items.length, release_key: "release:partial-admission" },
});

async function installAcademicFixture(page, values) {
  await page.addInitScript((key) => {
    localStorage.setItem("andromeda.compare.v1", JSON.stringify([key]));
  }, programKey);
  const pools = values.map((value, index) => ({
    external_key: `pool:partial:${index}`, campaign_key: campaignKey, campaign_year: 2026,
    direction_code: directionCode, scope_level: "direction", funding_type: "budget",
    quota_type: "general_competition", places: value && typeof value === "object" ? value.places : value,
    places_by_source_row: value && typeof value === "object" ? value.places_by_source_row : [], sources: [],
  }));
  await page.route("**/api/v1/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/v1/programs") return route.fulfill({ json: responsePage([{
      external_key: programKey, code: programCode, name: "Partial admissions program",
      direction_key: "direction:partial", department_relations: [],
    }]) });
    if (pathname === "/api/v1/directions") return route.fulfill({ json: responsePage([{
      external_key: "direction:partial", code: directionCode, name: "Applied mathematics",
    }]) });
    if (pathname === "/api/v1/campaigns") return route.fulfill({ json: responsePage([{
      external_key: campaignKey, year: 2026, campaign_kind: "admission", sources: [],
    }]) });
    if (pathname === "/api/v1/competition-pools") return route.fulfill({ json: responsePage(pools) });
    if (pathname.includes("/subject-taxonomies/")) return route.fulfill({ json: { categories: [] } });
    if (["/api/v1/departments", "/api/v1/requirements", "/api/v1/individual-achievements", "/api/v1/tuition", "/api/v1/statistics", "/api/v1/study-plans", "/api/v1/exams"].includes(pathname)
      || pathname.endsWith("/calendar") || pathname.endsWith("/offerings")) {
      return route.fulfill({ json: responsePage([]) });
    }
    return route.fulfill({ status: 404, json: { error: { code: "unexpected_fixture_route", message: pathname } } });
  });
}

for (const scenario of [
  { name: "known and unknown rows", values: [20, null], expected: "Частичные данные", incomplete: true },
  { name: "known zero and unknown rows", values: [0, null], expected: "Частичные данные", incomplete: true },
  { name: "complete explicit-zero rows", values: [0, 0], expected: "0", incomplete: false },
  { name: "all unknown rows", values: [null, null], expected: "Не указано", incomplete: false },
  { name: "conflicting source values", values: [{ places: null, places_by_source_row: [{ places: 7 }, { places: 9 }] }], expected: "Конфликт в источнике", conflict: true },
]) {
  test(`catalog and comparison preserve admission total uncertainty: ${scenario.name}`, async ({ page, browserDiagnostics }) => {
    await installAcademicFixture(page, scenario.values);
    await page.goto("programs.html?data=live");
    await expect(page.locator("#programGrid")).toHaveAttribute("aria-busy", "false");
    const card = page.locator("#programGrid .program-card").filter({ hasText: programCode });
    await card.locator(".program-summary").click();
    const metric = card.locator(".admission-metric").filter({ hasText: "Бюджет · общий конкурс" });
    await expect(metric.locator("strong")).toHaveText(scenario.expected);
    if (scenario.incomplete) {
      await expect(metric).toContainText("1 из 2");
      await expect(metric).toContainText("полная сумма не подтверждена");
      await expect(metric.locator("strong")).not.toHaveText(String(scenario.values[0]));
    }
    if (scenario.conflict) {
      await expect(metric).toContainText("7 и 9");
      await expect(metric).toContainText("Полная сумма не подтверждена");
    }
    if (scenario.values.every((value) => value === null)) {
      await expect(metric.locator("strong")).not.toHaveText("0");
    }
    await page.goto("compare.html?data=live");
    await expect(page.locator("#compareContent")).toHaveAttribute("aria-busy", "false");
    const budgetRow = page.locator(".comparison-table tbody tr").filter({ hasText: "Бюджетные места · общий конкурс" });
    const cell = budgetRow.locator("td").first();
    await expect(cell.locator(".overview-value strong")).toHaveText(scenario.expected);
    if (scenario.incomplete) {
      await expect(cell).toContainText("1 из 2");
      await expect(cell).toContainText("полная сумма не подтверждена");
      await expect(cell.locator(".overview-value strong")).not.toHaveText(String(scenario.values[0]));
    }
    if (scenario.conflict) {
      await expect(cell).toContainText("7 и 9");
      await expect(cell).toContainText("Полная сумма не подтверждена");
    }
    if (scenario.values.every((value) => value === null)) {
      await expect(cell.locator(".overview-value strong")).not.toHaveText("0");
    }
  });
}

test("workspace displays an unknown admission row alongside the known row", async ({ page, browserDiagnostics }) => {
  await installAcademicFixture(page, [20, null, { places: null, places_by_source_row: [{ places: 7 }, { places: 9 }] }]);
  await page.goto("workspace.html?data=live#admission");
  await expect(page.locator("#admission-direction")).toHaveValue(directionCode);
  const poolPanel = page.locator("#workspaceView .panel").filter({ hasText: "Места и конкурсные категории" });
  const rows = poolPanel.locator(".admission-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).locator("strong")).toHaveText("20 мест");
  await expect(rows.nth(1).locator("strong")).toHaveText("Количество мест не указано");
  await expect(rows.nth(1).locator("strong")).not.toHaveText("0 мест");
  await expect(rows.nth(2).locator("strong")).toHaveText("В источнике расходятся значения: 7 и 9");
  await expect(poolPanel).not.toContainText("В архиве нет данных о местах");
});
