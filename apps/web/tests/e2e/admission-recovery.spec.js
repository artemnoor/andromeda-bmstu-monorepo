import { expect, test } from "./support.js";

const programKey = "educational_program:bmstu:01.03.02-01";
const directionKey = "direction:bmstu:01.03.02";
const departmentKey = "department:bmstu:iu1";
const campaignKey = "campaign:bmstu:2026:admission";
const offeringKey = "offering:bmstu:2026:01.03.02-01";

function pageResponse(items) {
  return {
    items,
    page: {
      limit: 100,
      next_cursor: null,
      total_count: items.length,
      release_key: "admission-recovery-fixture",
    },
  };
}

test("catalog admission details show an unavailable state and retry after reopening", async ({ page, browserDiagnostics }) => {
  let campaignRequests = 0;
  browserDiagnostics.allowHttpStatus(503, "/api/v1/campaigns");
  browserDiagnostics.allowConsoleError("503");
  browserDiagnostics.allowConsoleError("Не удалось отобразить условия приёма программы");

  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/v1/programs") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        json: pageResponse([{
          external_key: programKey,
          code: "01.03.02-01",
          name: "Тестовая программа",
          direction_key: directionKey,
          department_relations: [{ department_key: departmentKey, verification_status: "verified" }],
        }]),
      });
    }
    if (pathname === "/api/v1/directions") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        json: pageResponse([{ external_key: directionKey, code: "01.03.02", name: "Прикладная математика" }]),
      });
    }
    if (pathname === "/api/v1/departments") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        json: pageResponse([{ external_key: departmentKey, official_code: "ИУ1", name: "Системы управления" }]),
      });
    }
    if (pathname === "/api/v1/campaigns") {
      campaignRequests += 1;
      if (campaignRequests === 1) {
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          json: { error: { code: "fixture_unavailable", message: "Temporary fixture outage" } },
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        json: pageResponse([{
          external_key: campaignKey,
          year: 2026,
          campaign_kind: "admission",
        }]),
      });
    }
    if (pathname.endsWith("/calendar")) {
      return route.fulfill({ status: 200, contentType: "application/json", json: pageResponse([]) });
    }
    if (pathname.endsWith("/offerings")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        json: pageResponse([{
          external_key: offeringKey,
          direction_code: "01.03.02",
          department_code: "ИУ1",
          program_key: programKey,
          program_link_status: "exact",
          study_form: "очная",
          study_duration_label: "4 года",
        }]),
      });
    }
    if (pathname === "/api/v1/competition-pools") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        json: pageResponse([{
          external_key: "pool:bmstu:2026:01.03.02-01",
          direction_code: "01.03.02",
          department_code: "ИУ1",
          scope_level: "offering",
          offering_keys: [offeringKey],
          funding_type: "budget",
          quota_type: "general_competition",
          places: 18,
        }]),
      });
    }
    if (pathname === "/api/v1/requirements") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        json: pageResponse([{
          external_key: "requirements:bmstu:2026:01.03.02",
          direction_code: "01.03.02",
          root: { kind: "leaf", subject_code: "mathematics", minimum_score: 55, is_choice: false },
        }]),
      });
    }
    if (pathname === "/api/v1/individual-achievements" || pathname === "/api/v1/tuition" || pathname === "/api/v1/statistics") {
      return route.fulfill({ status: 200, contentType: "application/json", json: pageResponse([]) });
    }
    return route.fulfill({
      status: 404,
      contentType: "application/json",
      json: { error: { code: "unexpected_fixture_route", message: pathname } },
    });
  });

  await page.goto("programs.html?data=live");
  await expect(page.locator("#programGrid")).toHaveAttribute("aria-busy", "false");
  const details = page.locator("#programGrid .program-expander").first();
  const summary = details.locator("summary");
  const admissionPanel = details.locator(".admission-panel");

  await summary.click();
  await expect(admissionPanel).toContainText("Не удалось загрузить статистику поступления. Попробуйте открыть карточку ещё раз.");
  await expect(admissionPanel.locator(".admission-section")).toHaveCount(0);
  await expect(admissionPanel).not.toContainText(/не найдено в доступных источниках|не найдены в доступных данных|не найдена\./i);
  expect(campaignRequests).toBe(1);

  await summary.click();
  await expect.poll(() => details.evaluate((element) => element.open)).toBe(false);
  await summary.click();

  await expect(admissionPanel).toContainText("Места на приём 2026");
  await expect(admissionPanel.locator(".admission-metric strong").first()).toHaveText("18");
  await expect(admissionPanel).toContainText("Математика от 55");
  await expect.poll(() => campaignRequests).toBe(2);
});

test("admission page can retry initial program loading after an API outage", async ({ page, browserDiagnostics }) => {
  let programRequests = 0;
  browserDiagnostics.allowHttpStatus(503, "/api/v1/programs");
  browserDiagnostics.allowConsoleError("503");
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/v1/programs") {
      programRequests += 1;
      if (programRequests === 1) {
        return route.fulfill({ status: 503, json: { error: { code: "fixture_unavailable", message: "Temporary fixture outage" } } });
      }
      return route.fulfill({ json: pageResponse([{
        external_key: programKey,
        code: "01.03.02-01",
        name: "Тестовая программа",
        direction_key: directionKey,
        department_relations: [],
      }]) });
    }
    if (pathname === "/api/v1/directions") return route.fulfill({ json: pageResponse([{ external_key: directionKey, code: "01.03.02", name: "Прикладная математика" }]) });
    if (pathname === "/api/v1/departments") return route.fulfill({ json: pageResponse([]) });
    if (pathname === "/api/v1/campaigns") return route.fulfill({ json: pageResponse([{ external_key: campaignKey, year: 2026, campaign_kind: "admission" }]) });
    return route.fulfill({ json: pageResponse([]) });
  });

  await page.goto("admission.html?data=live");
  await expect(page.locator("#dataStatus")).toContainText("API каталога временно недоступен");
  await expect(page.locator("#retryAdmission")).toBeVisible();
  expect(programRequests).toBe(1);

  await page.getByRole("button", { name: "Повторить загрузку" }).click();
  await expect(page.locator("#dataStatus")).toContainText("Актуальные данные через API каталога");
  await expect(page.locator("#dataStatus")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#retryAdmission")).toBeHidden();
  await expect(page.locator('#directionFilter option[value="01.03.02"]')).toBeAttached();
  expect(programRequests).toBe(2);
});

test("conflicting quota rows and nullable exam requirements remain unknown in the UI", async ({ page, browserDiagnostics }) => {
  const campaignSource = "https://example.test/admission/campaign";
  const requirementSource = "https://example.test/admission/requirements";
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/v1/programs") return route.fulfill({
      status: 200,
      contentType: "application/json",
      json: pageResponse([{
        external_key: "educational_program:bmstu:01.03.03-01",
        code: "01.03.03-01",
        name: "Прикладная математика и информатика",
        direction_key: "direction:bmstu:01.03.03",
        department_relations: [{ department_key: "department:bmstu:iu2", verification_status: "verified" }],
      }]),
    });
    if (pathname === "/api/v1/directions") return route.fulfill({
      status: 200,
      contentType: "application/json",
      json: pageResponse([{ external_key: "direction:bmstu:01.03.03", code: "01.03.03", name: "Прикладная математика и информатика" }]),
    });
    if (pathname === "/api/v1/departments") return route.fulfill({
      status: 200,
      contentType: "application/json",
      json: pageResponse([{ external_key: "department:bmstu:iu2", official_code: "ИУ2", name: "Информатика и системы управления" }]),
    });
    if (pathname === "/api/v1/campaigns") return route.fulfill({
      status: 200,
      contentType: "application/json",
      json: pageResponse([{ external_key: "campaign:bmstu:2026:admission", year: 2026, campaign_kind: "admission", sources: [{ source_url: campaignSource }] }]),
    });
    if (pathname.endsWith("/calendar") || pathname.endsWith("/offerings")) {
      return route.fulfill({ status: 200, contentType: "application/json", json: pageResponse([]) });
    }
    if (pathname === "/api/v1/competition-pools") return route.fulfill({
      status: 200,
      contentType: "application/json",
      json: pageResponse([
        { external_key: "pool:general", campaign_key: campaignKey, direction_code: "01.03.03", campaign_year: 2026, scope_level: "direction", funding_type: "budget", quota_type: "general_competition", places: 20, sources: [{ source_url: campaignSource }] },
        { external_key: "pool:special", campaign_key: campaignKey, direction_code: "01.03.03", campaign_year: 2026, scope_level: "direction", funding_type: "budget", quota_type: "special", places: null, places_by_source_row: [{ places: 2 }, { places: 4 }], sources: [] },
        { external_key: "pool:separate", campaign_key: campaignKey, direction_code: "01.03.03", campaign_year: 2026, scope_level: "direction", funding_type: "budget", quota_type: "separate", places: null, places_by_source_row: [{ places: 3 }, { places: 5 }], sources: [] },
      ]),
    });
    if (pathname === "/api/v1/requirements") return route.fulfill({
      status: 200,
      contentType: "application/json",
      json: pageResponse([{
        external_key: "requirements:bmstu:2026:01.03.03",
        direction_code: "01.03.03",
        root: { kind: "leaf", subject_code: "mathematics", minimum_score: null, is_choice: null },
        sources: [{ source_url: requirementSource }],
      }]),
    });
    if (["/api/v1/individual-achievements", "/api/v1/tuition", "/api/v1/statistics"].includes(pathname)) {
      return route.fulfill({ status: 200, contentType: "application/json", json: pageResponse([]) });
    }
    return route.fulfill({ status: 404, contentType: "application/json", json: { error: { code: "unexpected_fixture_route", message: pathname } } });
  });

  await page.goto("programs.html?data=live");
  await expect(page.locator("#programGrid")).toHaveAttribute("aria-busy", "false");
  const card = page.locator("#programGrid .program-card").filter({ hasText: "01.03.03-01" });
  await card.locator(".program-summary").click();
  const panel = card.locator(".admission-panel");
  await expect(panel).toContainText("Особая квота · бюджет: Значение не подтверждено: в исходных строках 2 и 4");
  await expect(panel).toContainText("Отдельная квота · бюджет: Значение не подтверждено: в исходных строках 3 и 5");
  await expect(panel).not.toContainText("Особая квота · бюджет: 0 мест");
  await expect(panel).toContainText("Тип условия не указан");
  await expect(panel).not.toContainText("от 0 баллов");

  await page.evaluate(() => localStorage.setItem("andromeda.applicant.v1", JSON.stringify({ scores: { mathematics: 100 } })));
  await page.goto("admission.html?data=live&direction=01.03.03");
  await expect(page.locator("#dataStatus")).toContainText("Актуальные данные через API каталога");
  await expect(page.locator("#pools .pool-row").filter({ hasText: "Особая квота" }).locator(".pool-places")).toHaveText("Значение не подтверждено");
  await expect(page.locator("#pools .pool-row").filter({ hasText: "Особая квота" }).locator(".pool-warning")).toContainText("2 и 4");
  await expect(page.locator("#requirements .exam-rule .exam-score")).toHaveText("Минимум не указан");
  await expect(page.locator("#requirements .exam-rule")).toContainText("Минимальный порог не указан в источнике");
  await expect(page.locator("#scoreEvaluation")).toContainText("эти условия нельзя проверить");
  await expect(page.locator("#requirements")).not.toContainText("минимум пройден");
});

test("admission hides the previous direction while the selected direction is still loading", async ({ page, browserDiagnostics }) => {
  const directionA = "01.03.02";
  const directionB = "01.03.03";
  let beginBPoolRequest;
  let releaseBPoolRequest;
  let bPoolRequests = 0;
  const bPoolRequested = new Promise((resolve) => { beginBPoolRequest = resolve; });
  const bPoolGate = new Promise((resolve) => { releaseBPoolRequest = resolve; });
  browserDiagnostics.allowHttpStatus(503, "/api/v1/competition-pools");
  browserDiagnostics.allowConsoleError("status of 503");
  await page.addInitScript(() => {
    localStorage.setItem("andromeda.applicant.v1", JSON.stringify({ scores: { mathematics: 90, physics: "not-a-score" } }));
  });
  const programRows = [
    { external_key: "program:a", code: "01.03.02-A", name: "Направление А", direction_key: "direction:a", department_relations: [] },
    { external_key: "program:b", code: "01.03.03-B", name: "Направление Б", direction_key: "direction:b", department_relations: [] },
  ];
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    if (pathname === "/api/v1/programs") return route.fulfill({ json: pageResponse(programRows) });
    if (pathname === "/api/v1/directions") return route.fulfill({ json: pageResponse([
      { external_key: "direction:a", code: directionA, name: "Направление А" },
      { external_key: "direction:b", code: directionB, name: "Направление Б" },
    ]) });
    if (pathname === "/api/v1/departments") return route.fulfill({ json: pageResponse([]) });
    if (pathname === "/api/v1/campaigns") return route.fulfill({ json: pageResponse([{ external_key: campaignKey, year: 2026, campaign_kind: "admission" }]) });
    if (pathname.endsWith("/calendar") || pathname.endsWith("/offerings")) return route.fulfill({ json: pageResponse([]) });
    if (pathname === "/api/v1/competition-pools") {
      const code = url.searchParams.get("direction_code");
      if (code === directionB) {
        bPoolRequests += 1;
        if (bPoolRequests === 1) {
          beginBPoolRequest();
          await bPoolGate;
          return route.fulfill({ status: 503, json: { error: { code: "fixture_unavailable", message: "Temporary fixture outage" } } });
        }
      }
      return route.fulfill({ json: pageResponse([{
        external_key: `pool:${code}`,
        direction_code: code,
        campaign_year: 2026,
        scope_level: "direction",
        funding_type: "budget",
        quota_type: "general_competition",
        places: code === directionA ? 18 : 7,
      }]) });
    }
    if (pathname === "/api/v1/requirements") return route.fulfill({ json: pageResponse([
      { external_key: "requirements:a", direction_code: directionA, root: { kind: "leaf", subject_code: "mathematics", minimum_score: 55, is_choice: false } },
      { external_key: "requirements:b", direction_code: directionB, root: { kind: "leaf", subject_code: "physics", minimum_score: 60, is_choice: false } },
    ]) });
    if (["/api/v1/individual-achievements", "/api/v1/tuition", "/api/v1/statistics"].includes(pathname)) return route.fulfill({ json: pageResponse([]) });
    return route.fulfill({ status: 404, json: { error: { code: "unexpected_fixture_route", message: pathname } } });
  });

  await page.goto(`admission.html?data=live&direction=${directionA}`);
  await expect(page.locator("#pools .pool-places")).toHaveText("18");
  await expect(page.locator("#requirements .exam-score")).toHaveText("от 55 баллов");
  await expect(page.locator("#requirements .exam-rule")).toContainText("Твой балл 90 · минимум пройден");
  await expect(page.locator("#scoreEvaluation")).toContainText("подтверждён допустимый вариант условий");
  await page.locator("#directionFilter").selectOption(directionB);
  await bPoolRequested;
  await expect(page.locator("#dataStatus")).toHaveAttribute("aria-busy", "true");
  await expect(page.locator("#scoreEvaluation")).toBeEmpty();
  await expect(page.locator("#pools")).toHaveAttribute("aria-busy", "true");
  await expect(page.locator("#pools .pool-places")).toHaveCount(0);
  await expect(page.locator("#pools")).toContainText("Загружаем данные выбранного направления");
  await expect(page.locator("#requirements")).not.toContainText("Математика от 55");

  releaseBPoolRequest();
  await expect(page.locator("#retryAdmission")).toBeVisible();
  await expect(page.locator("#scoreEvaluation")).toBeEmpty();
  await expect(page.locator("#pools .pool-places")).toHaveCount(0);
  await page.getByRole("button", { name: "Повторить загрузку" }).click();
  await expect(page.locator("#pools .pool-places")).toHaveText("7");
  await expect(page.locator("#requirements .exam-score")).toHaveText("от 60 баллов");
  await expect(page.locator("#requirements .exam-rule")).toContainText("Добавь балл в профиле для сверки");
  await expect(page.locator("#requirements")).not.toContainText(/NaN|ниже минимума/);
  await expect(page.locator("#requirements")).not.toContainText("Математика от 55");
  await expect(page.locator("#dataStatus")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#retryAdmission")).toBeHidden();
  expect(bPoolRequests).toBe(2);
});

test("admission history displays valid zero statistics instead of treating them as missing", async ({ page }) => {
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    if (pathname === "/api/v1/programs") return route.fulfill({ json: pageResponse([{
      external_key: programKey,
      code: "01.03.02-01",
      name: "Программа с нулевыми историческими значениями",
      direction_key: directionKey,
      department_relations: [],
    }]) });
    if (pathname === "/api/v1/directions") return route.fulfill({ json: pageResponse([{
      external_key: directionKey,
      code: "01.03.02",
      name: "Информатика и вычислительная техника",
    }]) });
    if (pathname === "/api/v1/departments") return route.fulfill({ json: pageResponse([]) });
    if (pathname === "/api/v1/campaigns") return route.fulfill({ json: pageResponse([{
      external_key: campaignKey,
      year: 2026,
      campaign_kind: "admission",
    }]) });
    if (pathname.endsWith("/calendar") || pathname.endsWith("/offerings")) {
      return route.fulfill({ json: pageResponse([]) });
    }
    if (pathname === "/api/v1/statistics" && url.searchParams.get("kind") === "historical") {
      return route.fulfill({ json: pageResponse([{
        external_key: "statistic:zero-history",
        year: 2025,
        direction_code: "01.03.02",
        funding_type: "budget",
        scope_type: "direction",
        minimum_score: 0,
        average_score: 0,
        admitted_count: 0,
      }]) });
    }
    if (["/api/v1/competition-pools", "/api/v1/requirements", "/api/v1/individual-achievements", "/api/v1/tuition", "/api/v1/statistics"].includes(pathname)) {
      return route.fulfill({ json: pageResponse([]) });
    }
    return route.fulfill({ status: 404, json: { error: { code: "unexpected_fixture_route", message: pathname } } });
  });

  await page.goto(`admission.html?data=live&direction=01.03.02`);
  const row = page.locator("#history .history-row").first();
  await expect(row).toContainText("Минимум: 0");
  await expect(row).toContainText("Средний: 0");
  await expect(row).toContainText("Зачислено: 0");
  await expect(row).not.toContainText("Подробности не извлечены");
});

test("live targeted-quota details preserve organization identity and unresolved department status", async ({ page }) => {
  const organization = "Тестовый научный центр";
  const sourceUrl = "https://example.test/target-quotas.pdf";
  const targetPool = {
    external_key: "pool:target:fixture",
    campaign_key: campaignKey,
    campaign_year: 2026,
    direction_code: "01.03.02",
    department_code: "ИУ99",
    department_status: "unresolved",
    scope_level: "direction_and_target_organization",
    funding_type: "budget",
    quota_type: "targeted",
    places: 3,
    target_organization: organization,
    target_organization_inn: "0012345678",
    target_organization_kpp: "001234001",
    target_organization_ogrn: "0012345678901",
    target_region: "Москва",
    campus_label_in_document: "Главный кампус",
    sources: [{ source_url: sourceUrl }],
  };

  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    if (pathname === "/api/v1/programs") return route.fulfill({ json: pageResponse([{
      external_key: programKey,
      code: "01.03.02-01",
      name: "Программа с целевыми местами",
      direction_key: directionKey,
      department_relations: [],
    }]) });
    if (pathname === "/api/v1/directions") return route.fulfill({ json: pageResponse([{
      external_key: directionKey,
      code: "01.03.02",
      name: "Информатика и вычислительная техника",
    }]) });
    if (pathname === "/api/v1/departments") return route.fulfill({ json: pageResponse([]) });
    if (pathname === "/api/v1/campaigns") return route.fulfill({ json: pageResponse([{
      external_key: campaignKey,
      year: 2026,
      campaign_kind: "admission",
    }]) });
    if (pathname.endsWith("/calendar") || pathname.endsWith("/offerings")) return route.fulfill({ json: pageResponse([]) });
    if (pathname === "/api/v1/competition-pools") return route.fulfill({ json: pageResponse([targetPool]) });
    if (["/api/v1/requirements", "/api/v1/individual-achievements", "/api/v1/tuition", "/api/v1/statistics"].includes(pathname)) {
      return route.fulfill({ json: pageResponse([]) });
    }
    return route.fulfill({ status: 404, json: { error: { code: "unexpected_fixture_route", message: pathname } } });
  });

  await page.goto(`admission.html?data=live&direction=01.03.02`);
  const poolRow = page.locator("#pools .pool-row").filter({ hasText: organization });
  await expect(poolRow).toContainText("Код кафедры ИУ99 · связь не подтверждена");
  await expect(poolRow).not.toContainText("Кафедра ИУ99");
  await expect(poolRow).toContainText("0012345678");
  await expect(poolRow).toContainText("001234001");
  await expect(poolRow).toContainText("0012345678901");
  await expect(poolRow).toContainText("Москва");
  await expect(poolRow).toContainText("Главный кампус");
  await expect(poolRow.getByRole("link", { name: "Источник ↗" })).toHaveAttribute("href", sourceUrl);

  await page.goto("programs.html?data=live");
  const card = page.locator("#programGrid .program-card").first();
  await card.locator(".program-summary").click();
  const panel = card.locator(".admission-panel");
  const targetDetails = panel.locator(".admission-expand").filter({ hasText: organization });
  await expect(targetDetails).toContainText("0012345678");
  await expect(targetDetails).toContainText("001234001");
  await expect(targetDetails).toContainText("0012345678901");
  await expect(targetDetails).toContainText("Главный кампус");
});
