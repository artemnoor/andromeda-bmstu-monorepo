import { expect, test } from "./support.js";

for (const scenario of [
  { name: "HTTP 429", status: 429, body: JSON.stringify({ error: { code: "rate_limited", message: "Slow down" } }), allowStatus: 429 },
  { name: "HTTP 500", status: 500, body: JSON.stringify({ error: { code: "internal_error", message: "Temporarily unavailable" } }), allowStatus: 500 },
  { name: "invalid JSON", status: 200, body: "{" },
  { name: "missing release identity", status: 200, body: JSON.stringify({ items: [], page: { limit: 100, next_cursor: null, total_count: 0 } }) },
]) {
  test(`catalog stays truthful when the API returns ${scenario.name}`, async ({ page, browserDiagnostics }) => {
    await page.route("**/api/v1/**", (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/api/v1/programs") {
        return route.fulfill({ status: scenario.status, contentType: "application/json", body: scenario.body });
      }
      if (["/api/v1/directions", "/api/v1/departments"].includes(pathname)) {
        return route.fulfill({ json: {
          items: [],
          page: { limit: 100, next_cursor: null, total_count: 0, release_key: "resilience-fixture" },
        } });
      }
      return route.fulfill({ status: 404, json: { error: { code: "unexpected_fixture_route", message: pathname } } });
    });
    if (scenario.allowStatus) {
      browserDiagnostics.allowHttpStatus(scenario.allowStatus, "/api/v1/programs");
      browserDiagnostics.allowConsoleError(`status of ${scenario.allowStatus}`);
    }
    await page.goto("programs.html?data=live");
    await expect(page.locator("#programGrid .error-state")).toContainText("Не удалось подключиться к каталогу");
    await expect(page.locator("#programGrid .program-card")).toHaveCount(0);
    await expect(page.locator("#programGrid")).toHaveAttribute("aria-busy", "false");
    await expect(page.locator("#andromeda-demo-data-banner")).toHaveCount(0);
  });
}

test("catalog stops when a cursor repeats instead of requesting forever", async ({ page, browserDiagnostics }) => {
  const requestedCursors = [];
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    if (pathname === "/api/v1/programs") {
      const cursor = url.searchParams.get("cursor");
      requestedCursors.push(cursor);
      return route.fulfill({ json: {
        items: [],
        page: { limit: 100, next_cursor: "repeat-me", total_count: 0, release_key: "repeated-cursor" },
      } });
    }
    if (["/api/v1/directions", "/api/v1/departments"].includes(pathname)) {
      return route.fulfill({ json: {
        items: [],
        page: { limit: 100, next_cursor: null, total_count: 0, release_key: "repeated-cursor" },
      } });
    }
    return route.fulfill({ status: 404, json: { error: { code: "unexpected_fixture_route", message: pathname } } });
  });
  await page.goto("programs.html?data=live");
  await expect(page.locator("#programGrid .error-state")).toContainText("Не удалось подключиться к каталогу");
  await expect(page.locator("#programGrid")).toHaveAttribute("aria-busy", "false");
  expect(requestedCursors).toEqual([null, "repeat-me"]);
});

test("a stalled API request ends in a visible recoverable catalog error", async ({ page }) => {
  await page.addInitScript(() => {
    window.ACADEMIC_DATA_REQUEST_TIMEOUT_MS = 60;
  });
  await page.route("**/api/v1/programs**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: {
          items: [],
          page: { limit: 100, next_cursor: null, total_count: 0, release_key: "late-response" },
        },
      });
    } catch {
      // The browser request is expected to be aborted by the client deadline.
    }
  });

  await page.goto("programs.html?data=live");
  await expect(page.locator("#programGrid")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#programGrid .error-state")).toContainText("Не удалось подключиться к каталогу");
  await expect(page.locator("#programGrid .program-card")).toHaveCount(0);
});

test("comparison keeps curriculum usable when admission data fails and retries successfully", async ({ page, browserDiagnostics }) => {
  const programKey = "program:bmstu:01.03.02:ИУ9:01.03.02-01:source:1-1";
  let admissionSnapshotRequests = 0;
  browserDiagnostics.allowHttpStatus(503, "/data/admission.json");
  browserDiagnostics.allowConsoleError("status of 503");
  await page.addInitScript((key) => {
    localStorage.setItem("andromeda.compare.v1", JSON.stringify([key]));
  }, programKey);
  await page.route("**/data/admission.json", (route) => {
    admissionSnapshotRequests += 1;
    if (admissionSnapshotRequests === 1) {
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "fixture outage" }) });
    }
    return route.continue();
  });

  await page.goto("compare.html?data=demo");
  await expect(page.locator(".category-comparison-board")).toBeVisible();
  await expect(page.locator(".admission-error-note")).toBeVisible();
  await page.getByRole("button", { name: "Повторить загрузку" }).click();
  await expect(page.locator(".comparison-table")).toBeVisible();
  await expect(page.locator(".admission-error-note")).toHaveCount(0);
  await expect.poll(() => admissionSnapshotRequests).toBe(2);
});
