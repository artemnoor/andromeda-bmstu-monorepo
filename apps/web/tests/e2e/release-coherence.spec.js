import { expect, test } from "./support.js";

const oneProgram = {
  external_key: "program:release-test",
  code: "01.03.02-TEST",
  name: "Release coherence fixture",
  direction_key: "direction:release-test",
  department_relations: [],
};

function page(items, releaseKey, nextCursor = null) {
  return {
    items,
    page: { limit: 100, next_cursor: nextCursor, total_count: items.length, release_key: releaseKey },
  };
}

function unexpectedApiRoute(route, pathname) {
  return route.fulfill({
    status: 404,
    contentType: "application/json",
    json: { error: { code: "unexpected_fixture_route", message: pathname } },
  });
}

function emptyAdmissionDataRoute(route, pathname, releaseKey) {
  if (pathname === "/api/v1/campaigns") {
    return route.fulfill({ json: page([
      { external_key: "campaign:release-test", year: 2026, campaign_kind: "admission" },
    ], releaseKey) });
  }
  if (pathname.endsWith("/calendar") || pathname.endsWith("/offerings") || [
    "/api/v1/competition-pools",
    "/api/v1/requirements",
    "/api/v1/individual-achievements",
    "/api/v1/tuition",
    "/api/v1/statistics",
  ].includes(pathname)) {
    return route.fulfill({ json: page([], releaseKey) });
  }
  return null;
}

test("catalog fails closed when related API collections come from different releases", async ({ page: browserPage, browserDiagnostics }) => {
  await browserPage.route("**/api/v1/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/programs")) return route.fulfill({ json: page([oneProgram], "release-a") });
    if (pathname.endsWith("/directions") || pathname.endsWith("/departments")) {
      return route.fulfill({ json: page([], "release-b") });
    }
    return unexpectedApiRoute(route, pathname);
  });

  await browserPage.goto("programs.html?data=live");
  await expect(browserPage.locator("#programGrid")).toHaveAttribute("aria-busy", "false");
  await expect(browserPage.locator("#programGrid .error-state")).toContainText("Не удалось подключиться к каталогу");
  await expect(browserPage.locator("#programGrid .program-card")).toHaveCount(0);
});

test("cursor pagination fails closed when the active release changes between pages", async ({ page: browserPage, browserDiagnostics }) => {
  await browserPage.route("**/api/v1/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/directions") || pathname.endsWith("/departments")) return route.fulfill({ json: page([], "release-a") });
    return unexpectedApiRoute(route, pathname);
  });
  await browserPage.route("**/api/v1/programs**", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("cursor") === "cursor-2") {
      return route.fulfill({ json: page([], "release-b") });
    }
    return route.fulfill({ json: page([oneProgram], "release-a", "cursor-2") });
  });
  await browserPage.goto("programs.html?data=live");
  await expect(browserPage.locator("#programGrid")).toHaveAttribute("aria-busy", "false");
  await expect(browserPage.locator("#programGrid .error-state")).toContainText("Не удалось подключиться к каталогу");
  await expect(browserPage.locator("#programGrid .program-card")).toHaveCount(0);
});

test("catalog does not turn a department under review into a confirmed fact", async ({ page: browserPage, browserDiagnostics }) => {
  await browserPage.route("**/api/v1/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/programs")) {
      return route.fulfill({ json: page([{
        ...oneProgram,
        department_relations: [{ department_key: "department:review", verification_status: "manual_review" }],
      }], "release-a") });
    }
    if (pathname.endsWith("/departments")) {
      return route.fulfill({ json: page([{ external_key: "department:review", official_code: "ИУ99", name: "Department Under Review" }], "release-a") });
    }
    if (pathname.endsWith("/directions")) return route.fulfill({ json: page([], "release-a") });
    return unexpectedApiRoute(route, pathname);
  });

  await browserPage.goto("programs.html?data=live");
  const card = browserPage.locator("#programGrid .program-card").first();
  await expect(card).toContainText("Связь не подтверждена");
  await expect(card).not.toContainText("ИУ99");
  await expect(card).not.toContainText("Department Under Review");
  await expect(browserPage.locator("#departmentFilter option")).toHaveCount(1);
});

test("workspace labels unverified departments and excludes them from filtering", async ({ page: browserPage, browserDiagnostics }) => {
  await browserPage.route("**/api/v1/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/programs")) {
      return route.fulfill({ json: page([{
        ...oneProgram,
        department_relations: [{ department_key: "department:review", verification_status: "manual_review" }],
      }], "release-a") });
    }
    if (pathname.endsWith("/departments")) {
      return route.fulfill({ json: page([{ external_key: "department:review", code: "ИУ99", name: "Department Under Review" }], "release-a") });
    }
    if (pathname.endsWith("/directions")) return route.fulfill({ json: page([], "release-a") });
    const admissionResponse = emptyAdmissionDataRoute(route, pathname, "release-a");
    if (admissionResponse) return admissionResponse;
    return unexpectedApiRoute(route, pathname);
  });

  await browserPage.goto("workspace.html?data=live#catalog");
  const card = browserPage.locator("#workspaceView .catalog-card").first();
  await expect(card).toContainText("Кафедра: связь не подтверждена");
  await expect(card).not.toContainText("ИУ99");
  await expect(card).not.toContainText("Department Under Review");
  await expect(browserPage.getByRole("combobox", { name: "Фильтр по кафедре" }).locator("option")).toHaveCount(1);
});

test("admission details do not substitute a different year when the selected campaign is missing", async ({ page: browserPage, browserDiagnostics }) => {
  await browserPage.route("**/api/v1/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/programs")) return route.fulfill({ json: page([oneProgram], "release-a") });
    if (pathname.endsWith("/campaigns")) {
      return route.fulfill({ json: page([{ external_key: "campaign:2027", year: 2027, campaign_kind: "admission" }], "release-a") });
    }
    if (pathname.endsWith("/directions") || pathname.endsWith("/departments")) return route.fulfill({ json: page([], "release-a") });
    return unexpectedApiRoute(route, pathname);
  });
  browserDiagnostics.allowConsoleError("Не удалось отобразить условия приёма программы");

  await browserPage.goto("programs.html?data=live");
  const details = browserPage.locator("#programGrid .program-expander").first();
  await details.locator("summary").click();
  const panel = details.locator(".admission-panel");
  await expect(panel).toContainText("Не удалось загрузить статистику поступления");
  await expect(panel).not.toContainText("2027");
  await expect(panel.locator(".admission-section")).toHaveCount(0);
});

test("comparison excludes disciplines from a parsed but unverified study-plan link", async ({ page: browserPage, browserDiagnostics }) => {
  const programA = { ...oneProgram, external_key: "program:a", code: "01.03.02-A", name: "Program with unverified plan" };
  const programB = { ...oneProgram, external_key: "program:b", code: "01.03.02-B", name: "Program with verified plan" };
  const programC = { ...oneProgram, external_key: "program:c", code: "01.03.02-C", name: "Program with verified but unreviewed plan content" };
  const requests = [];
  await browserPage.addInitScript(() => {
    localStorage.setItem("andromeda.compare.v1", JSON.stringify(["program:a", "program:b", "program:c"]));
  });
  browserPage.on("request", (request) => requests.push(new URL(request.url()).pathname));
  await browserPage.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    const decodedPathname = decodeURIComponent(pathname);
    if (pathname.endsWith("/programs")) return route.fulfill({ json: page([programA, programB, programC], "release-a") });
    if (pathname.endsWith("/study-plans")) {
      const programKey = url.searchParams.get("program_key");
      return route.fulfill({ json: page([
        { external_key: "plan:unverified", program_key: "program:a", profile_link_status: "manual_review", status: "unverified", item_count: 1 },
        { external_key: "plan:verified", program_key: "program:b", profile_link_status: "verified", status: "parsed", item_count: 1 },
        { external_key: "plan:review-content", program_key: "program:c", profile_link_status: "verified", status: "unverified", item_count: 1 },
      ].filter((plan) => plan.program_key === programKey), "release-a") });
    }
    if (decodedPathname.endsWith("/plan:verified/items")) {
      return route.fulfill({ json: page([{
        external_key: "item:verified",
        ordinal: 1,
        discipline_name: "Verified course",
        semester: 1,
        credits: 3,
        total_hours: 108,
        subject_classification: { category_code: "03", category_name: "Computer Science", review_status: "classified" },
      }], "release-a") });
    }
    if (decodedPathname.endsWith("/plan:unverified/items")) {
      return route.fulfill({ json: page([{
        external_key: "item:unverified",
        ordinal: 1,
        discipline_name: "Unverified course that must not be attributed",
        semester: 1,
        credits: 5,
        total_hours: 180,
      }], "release-a") });
    }
    if (pathname.includes("/subject-taxonomies/")) {
      return route.fulfill({ json: { categories: [{ category_code: "03", name: "Computer Science" }] } });
    }
    if (pathname.endsWith("/directions") || pathname.endsWith("/departments")) return route.fulfill({ json: page([], "release-a") });
    const admissionResponse = emptyAdmissionDataRoute(route, pathname, "release-a");
    if (admissionResponse) return admissionResponse;
    return unexpectedApiRoute(route, pathname);
  });

  await browserPage.goto("compare.html?data=live");
  await expect(browserPage.locator("#compareContent")).toContainText("Verified course");
  await expect(browserPage.locator("#compareContent")).toContainText("Актуальная версия учебного плана не подтверждена; состав не используется");
  await expect(browserPage.locator("#compareContent")).toContainText("Состав учебного плана требует проверки");
  await expect(browserPage.locator("#compareContent")).not.toContainText("Unverified course that must not be attributed");
  expect(requests.some((pathname) => decodeURIComponent(pathname).endsWith("/plan:unverified/items"))).toBe(false);
  expect(requests.some((pathname) => decodeURIComponent(pathname).endsWith("/plan:verified/items"))).toBe(true);
});

test("comparison reports a failed curriculum request as unavailable, not absent from the plan", async ({ page: browserPage, browserDiagnostics }) => {
  const programA = { ...oneProgram, external_key: "program:failing", code: "01.03.02-A", name: "Plan request fails" };
  const programB = { ...oneProgram, external_key: "program:available", code: "01.03.02-B", name: "Plan request succeeds" };
  const plans = [
    { external_key: "plan:failing", program_key: programA.external_key, academic_year: "2025-2026", profile_code: programA.code, status: "parsed", profile_link_status: "verified", item_count: 1 },
    { external_key: "plan:available", program_key: programB.external_key, academic_year: "2025-2026", profile_code: programB.code, status: "parsed", profile_link_status: "verified", item_count: 1 },
  ];
  await browserPage.addInitScript(() => {
    localStorage.setItem("andromeda.compare.v1", JSON.stringify(["program:failing", "program:available"]));
  });
  browserDiagnostics.allowHttpStatus(503, "/api/v1/study-plans/plan%3Afailing/items");
  browserDiagnostics.allowConsoleError("status of 503");
  await browserPage.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    const decoded = decodeURIComponent(pathname);
    if (pathname.endsWith("/programs")) return route.fulfill({ json: page([programA, programB], "release-a") });
    if (pathname.endsWith("/study-plans")) {
      const programKey = url.searchParams.get("program_key");
      return route.fulfill({ json: page(plans.filter((plan) => plan.program_key === programKey), "release-a") });
    }
    if (decoded.endsWith("/plan:failing/items")) {
      return route.fulfill({ status: 503, json: { error: { code: "fixture_unavailable", message: "Temporary fixture outage" } } });
    }
    if (decoded.endsWith("/plan:available/items")) return route.fulfill({ json: page([{
      external_key: "item:probability",
      ordinal: 1,
      discipline_name: "Probability",
      semester: 1,
      credits: 3,
      total_hours: 96,
      subject_classification: { category_code: "03", category_name: "Mathematics", review_status: "classified" },
    }], "release-a") });
    if (pathname.includes("/subject-taxonomies/")) return route.fulfill({ json: { categories: [{ category_code: "03", name: "Mathematics" }] } });
    if (pathname.endsWith("/directions") || pathname.endsWith("/departments")) return route.fulfill({ json: page([], "release-a") });
    const admissionResponse = emptyAdmissionDataRoute(route, pathname, "release-a");
    if (admissionResponse) return admissionResponse;
    return unexpectedApiRoute(route, pathname);
  });

  await browserPage.goto("compare.html?data=live");
  const root = browserPage.locator("#compareContent");
  await expect(root).toContainText("Probability");
  await expect(root).toContainText("Состав учебного плана не удалось загрузить");
  const probabilityRow = root.locator(".matrix-course-title").filter({ hasText: "Probability" }).locator("xpath=..");
  await expect(probabilityRow.locator("td").nth(0)).toContainText("Состав учебного плана не удалось загрузить");
  await expect(probabilityRow.locator("td").nth(0)).not.toContainText("Не входит в план");
});

test("comparison uses only the uniquely latest curriculum version for a program", async ({ page: browserPage, browserDiagnostics }) => {
  const plan = { ...oneProgram, external_key: "program:versioned", code: "01.03.02-V", name: "Versioned program" };
  const versions = [
    { external_key: "plan:old", program_key: plan.external_key, academic_year: "2023-2024", status: "parsed", profile_link_status: "verified", item_count: 1 },
    { external_key: "plan:current", program_key: plan.external_key, academic_year: "2025-2026", status: "parsed", profile_link_status: "verified", item_count: 1 },
  ];
  const itemRequests = [];
  await browserPage.addInitScript(() => localStorage.setItem("andromeda.compare.v1", JSON.stringify(["program:versioned"])));
  await browserPage.on("request", (request) => {
    const url = new URL(request.url());
    if (decodeURIComponent(url.pathname).includes("/study-plans/") && url.pathname.endsWith("/items")) itemRequests.push(decodeURIComponent(url.pathname));
  });
  await browserPage.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    const decoded = decodeURIComponent(pathname);
    if (pathname.endsWith("/programs")) return route.fulfill({ json: page([plan], "release-a") });
    if (pathname.endsWith("/study-plans")) return route.fulfill({ json: page(versions.filter((row) => row.program_key === url.searchParams.get("program_key")), "release-a") });
    if (decoded.endsWith("/plan:old/items")) return route.fulfill({ json: page([{ external_key: "item:old", ordinal: 1, discipline_name: "Historical version only", total_hours: 30 }], "release-a") });
    if (decoded.endsWith("/plan:current/items")) return route.fulfill({ json: page([{ external_key: "item:current", ordinal: 1, discipline_name: "Current version only", total_hours: 40 }], "release-a") });
    if (pathname.includes("/subject-taxonomies/")) return route.fulfill({ json: { categories: [{ category_code: "03", name: "Mathematics" }] } });
    if (pathname.endsWith("/directions") || pathname.endsWith("/departments")) return route.fulfill({ json: page([], "release-a") });
    const admissionResponse = emptyAdmissionDataRoute(route, pathname, "release-a");
    if (admissionResponse) return admissionResponse;
    return unexpectedApiRoute(route, pathname);
  });

  await browserPage.goto("compare.html?data=live");
  const root = browserPage.locator("#compareContent");
  await expect(root).toContainText("Current version only");
  await expect(root).not.toContainText("Historical version only");
  expect(itemRequests).toEqual(["/api/v1/study-plans/plan:current/items"]);
});

test("comparison does not present an older verified plan as current while a newer version needs review", async ({ page: browserPage }) => {
  const pendingProgram = { ...oneProgram, external_key: "program:pending-version", code: "01.03.02-P", name: "Program with pending version" };
  const comparisonProgram = { ...oneProgram, external_key: "program:comparison", code: "01.03.03-C", name: "Comparison program" };
  const versions = [
    { external_key: "plan:old-verified", program_key: pendingProgram.external_key, academic_year: "2023-2024", status: "parsed", profile_link_status: "verified", item_count: 1 },
    { external_key: "plan:new-pending", program_key: pendingProgram.external_key, academic_year: "2025-2026", status: "unverified", profile_link_status: "manual_review", item_count: 1 },
    { external_key: "plan:comparison", program_key: comparisonProgram.external_key, academic_year: "2025-2026", status: "parsed", profile_link_status: "verified", item_count: 1 },
  ];
  const itemRequests = [];
  await browserPage.addInitScript((keys) => localStorage.setItem("andromeda.compare.v1", JSON.stringify(keys)), [pendingProgram.external_key, comparisonProgram.external_key]);
  await browserPage.on("request", (request) => {
    const url = new URL(request.url());
    if (decodeURIComponent(url.pathname).includes("/study-plans/") && url.pathname.endsWith("/items")) itemRequests.push(decodeURIComponent(url.pathname));
  });
  await browserPage.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    const decoded = decodeURIComponent(pathname);
    if (pathname.endsWith("/programs")) return route.fulfill({ json: page([pendingProgram, comparisonProgram], "release-a") });
    if (pathname.endsWith("/study-plans")) return route.fulfill({ json: page(versions.filter((row) => row.program_key === url.searchParams.get("program_key")), "release-a") });
    if (decoded.endsWith("/plan:comparison/items")) {
      return route.fulfill({ json: page([{ external_key: "item:comparison", ordinal: 1, discipline_name: "Course from comparison program", total_hours: 40 }], "release-a") });
    }
    if (pathname.includes("/subject-taxonomies/")) return route.fulfill({ json: { categories: [{ category_code: "03", name: "Mathematics" }] } });
    if (pathname.endsWith("/directions") || pathname.endsWith("/departments")) return route.fulfill({ json: page([], "release-a") });
    const admissionResponse = emptyAdmissionDataRoute(route, pathname, "release-a");
    if (admissionResponse) return admissionResponse;
    return unexpectedApiRoute(route, pathname);
  });

  await browserPage.goto("compare.html?data=live");
  const root = browserPage.locator("#compareContent");
  await expect(root).toContainText("Course from comparison program");
  await expect(root).toContainText("Актуальная версия учебного плана не подтверждена; состав не используется");
  await expect(root).not.toContainText("Устаревший курс");
  expect(itemRequests).toEqual(["/api/v1/study-plans/plan:comparison/items"]);
});
