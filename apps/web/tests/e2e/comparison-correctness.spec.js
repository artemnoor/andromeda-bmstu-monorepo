import { expect, test } from "./support.js";

const releaseKey = "release-comparison-arithmetic";
const programs = [
  { external_key: "program:a", code: "01.03.02-A", name: "Program A", direction_key: "direction:a", department_relations: [] },
  { external_key: "program:b", code: "01.03.02-B", name: "Program B", direction_key: "direction:b", department_relations: [] },
];

function page(items) {
  return { items, page: { limit: 100, next_cursor: null, total_count: items.length, release_key: releaseKey } };
}

const item = (external_key, ordinal, discipline_name, semester, credits, total_hours, category_code, category_name) => ({
  external_key,
  ordinal,
  discipline_name,
  semester,
  credits,
  total_hours,
  subject_classification: {
    category_code,
    category_name,
    taxonomy_key: "fixture-taxonomy",
    taxonomy_version: "v1",
    review_status: "classified",
  },
});

test("comparison sums metrics independently and keeps every course in its program and semester column", async ({ page: browserPage, browserDiagnostics }) => {
  const plans = [
    { external_key: "plan:a", program_key: "program:a", profile_code: "01.03.02-A", academic_year: "2025-2026", status: "parsed", profile_link_status: "verified", item_count: 4 },
    { external_key: "plan:b", program_key: "program:b", profile_code: "01.03.02-B", academic_year: "2025-2026", status: "parsed", profile_link_status: "verified", item_count: 2 },
  ];
  const itemsByPlan = {
    "plan:a": [
      item("item:a-linear", 1, "Linear Algebra", 1, 4, 100, "03", "Mathematics"),
      item("item:a-algorithms", 2, "Algorithms", 2, 2, 50, "03", "Mathematics"),
      item("item:a-zero", 3, "Explicit Zero Metrics", 3, 0, 0, "03", "Mathematics"),
      item("item:a-unreported", 4, "Unreported Metrics", null, null, null, "03", "Mathematics"),
    ],
    "plan:b": [
      item("item:b-linear", 1, "Linear Algebra", 1, 3, 120, "03", "Mathematics"),
      item("item:b-physics", 2, "Physics", 2, 5, 80, "04", "Physics"),
    ],
  };

  await browserPage.addInitScript(() => {
    localStorage.setItem("andromeda.compare.v1", JSON.stringify(["program:a", "program:b"]));
  });
  await browserPage.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    if (pathname.endsWith("/programs")) return route.fulfill({ json: page(programs) });
    if (pathname.endsWith("/directions") || pathname.endsWith("/departments") || pathname.endsWith("/campaigns")) {
      return route.fulfill({ json: page([]) });
    }
    if (pathname.endsWith("/study-plans")) {
      const programKey = url.searchParams.get("program_key");
      return route.fulfill({ json: page(plans.filter((plan) => plan.program_key === programKey)) });
    }
    if (pathname.includes("/study-plans/") && pathname.endsWith("/items")) {
      const planKey = decodeURIComponent(pathname.split("/").at(-2));
      return route.fulfill({ json: page(itemsByPlan[planKey] || []) });
    }
    if (pathname.endsWith("/subject-taxonomies/fixture-taxonomy/v1")) {
      return route.fulfill({ json: { categories: [
        { category_code: "03", category_name: "Mathematics" },
        { category_code: "04", category_name: "Physics" },
      ] } });
    }
    return route.fulfill({ status: 404, json: { error: { code: "unexpected_fixture_route", message: pathname } } });
  });

  await browserPage.goto("compare.html?data=live");
  const root = browserPage.locator("#compareContent");
  await expect(root).toHaveAttribute("aria-busy", "false");
  await expect(root.locator(".compare-selection-card")).toHaveCount(2);
  await expect(root.locator(".category-board-total strong")).toHaveText("350 ч.");
  const programTotals = root.locator(".category-program-card .category-program-total strong");
  await expect(programTotals.nth(0)).toHaveText("150 ч.");
  await expect(programTotals.nth(1)).toHaveText("200 ч.");

  const workload = root.locator(".workload-details");
  await workload.locator("summary").click();
  const semesterOne = workload.locator(".workload-row").filter({ hasText: "1 семестр" });
  const semesterTwo = workload.locator(".workload-row").filter({ hasText: "2 семестр" });
  await expect(semesterOne.locator(".workload-series").nth(0)).toHaveAttribute("aria-label", "01.03.02-A: 4 з.е.");
  await expect(semesterOne.locator(".workload-series").nth(1)).toHaveAttribute("aria-label", "01.03.02-B: 3 з.е.");
  await expect(semesterTwo.locator(".workload-series").nth(0)).toHaveAttribute("aria-label", "01.03.02-A: 2 з.е.");
  await expect(semesterTwo.locator(".workload-series").nth(1)).toHaveAttribute("aria-label", "01.03.02-B: 5 з.е.");
  const semesterThree = workload.locator(".workload-row").filter({ hasText: "3 семестр" });
  await expect(semesterThree.locator(".workload-series").nth(0)).toHaveAttribute("aria-label", "01.03.02-A: 0 з.е.");
  await expect(semesterThree.locator(".workload-series").nth(1)).toHaveAttribute("aria-label", "01.03.02-B: нет числовых данных");
  const unknownSemester = workload.locator(".workload-row").filter({ hasText: "Семестр не указан" });
  await expect(unknownSemester.locator(".workload-series").nth(0)).toHaveAttribute("aria-label", "01.03.02-A: нет числовых данных");
  await workload.getByRole("button", { name: "Часы" }).click();
  await expect(semesterOne.locator(".workload-series").nth(0)).toHaveAttribute("aria-label", "01.03.02-A: 100 ч.");
  await expect(semesterOne.locator(".workload-series").nth(1)).toHaveAttribute("aria-label", "01.03.02-B: 120 ч.");
  await expect(semesterTwo.locator(".workload-series").nth(0)).toHaveAttribute("aria-label", "01.03.02-A: 50 ч.");
  await expect(semesterTwo.locator(".workload-series").nth(1)).toHaveAttribute("aria-label", "01.03.02-B: 80 ч.");
  await expect(semesterThree.locator(".workload-series").nth(0)).toHaveAttribute("aria-label", "01.03.02-A: 0 ч.");
  await expect(unknownSemester.locator(".workload-series").nth(0)).toHaveAttribute("aria-label", "01.03.02-A: нет числовых данных");

  const matrix = root.locator(".matrix-details");
  await matrix.locator("summary").click();
  const linearRow = matrix.locator("tbody tr").filter({ hasText: "Linear Algebra" });
  await expect(linearRow.locator("td").nth(0)).toContainText("1 семестр");
  await expect(linearRow.locator("td").nth(0)).toContainText("4 з.е.");
  await expect(linearRow.locator("td").nth(0)).toContainText("100 ч.");
  await expect(linearRow.locator("td").nth(1)).toContainText("1 семестр");
  await expect(linearRow.locator("td").nth(1)).toContainText("3 з.е.");
  await expect(linearRow.locator("td").nth(1)).toContainText("120 ч.");
  await matrix.locator("#courseMatrixSemester").selectOption("2");
  await matrix.locator("#courseMatrixCategory").selectOption("Physics");
  await expect(matrix.locator(".matrix-results")).toHaveText("Показано 1 из 5 названий.");
  await expect(matrix.locator("tbody tr").filter({ hasText: "Physics" })).toHaveCount(1);
});
