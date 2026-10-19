import type { Page } from "@playwright/test";
import { clearPocStorage, expect, expectHealthyBrowser, test } from "./fixtures";

type PageEnvelope = {
  readonly items: readonly Record<string, unknown>[];
  readonly page: {
    readonly release_key: string;
    readonly next_cursor: string | null;
  };
};

async function getPages(
  page: Page,
  path: string,
  params: URLSearchParams = new URLSearchParams(),
): Promise<{ readonly items: readonly Record<string, unknown>[]; readonly releaseKey: string }> {
  const items: Record<string, unknown>[] = [];
  const cursors = new Set<string>();
  let cursor: string | null = null;
  let releaseKey: string | null = null;

  do {
    const query = new URLSearchParams(params);
    query.set("limit", "100");
    if (cursor) query.set("cursor", cursor);
    const response = await page.request.get(`${path}?${query.toString()}`);
    expect(response.status(), `${path} API status`).toBe(200);
    const body = await response.json() as PageEnvelope;
    expect(body.page.release_key).toBeTruthy();
    if (releaseKey === null) releaseKey = body.page.release_key;
    expect(body.page.release_key, `${path} release identity across pages`).toBe(releaseKey);
    items.push(...body.items);
    cursor = body.page.next_cursor;
    if (cursor !== null) {
      expect(cursors.has(cursor), `${path} cursor must not repeat`).toBe(false);
      cursors.add(cursor);
    }
  } while (cursor !== null);

  if (releaseKey === null) throw new Error(`${path} returned no release identity.`);
  return { items, releaseKey };
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-09T12:00:00+03:00") });
  await clearPocStorage(page);
});

test("catalog does not attribute a branch target quota through a broad link to a Moscow program", async ({ page, diagnostics }) => {
  const directions = await getPages(page, "/api/v1/directions");
  const direction = directions.items.find((item) => item.code === "09.03.01");
  expect(direction, "the live 2026 test release must contain direction 09.03.01").toBeDefined();
  if (!direction || typeof direction.external_key !== "string") {
    throw new Error("The live test release has no 09.03.01 direction identity.");
  }

  const programs = await getPages(page, "/api/v1/programs", new URLSearchParams({ direction_key: direction.external_key }));
  expect(programs.releaseKey).toBe(directions.releaseKey);

  const campaigns = await getPages(page, "/api/v1/campaigns", new URLSearchParams({ year: "2026" }));
  const campaign = campaigns.items.find((item) => (
    item.campaign_kind === "admission"
    && item.year === 2026
    && typeof item.external_key === "string"
  ));
  expect(campaign, "the live release must contain the 2026 admission campaign").toBeDefined();
  if (!campaign || typeof campaign.external_key !== "string") {
    throw new Error("The live test release has no 2026 admission campaign.");
  }
  expect(campaigns.releaseKey).toBe(programs.releaseKey);

  const offerings = await getPages(page, `/api/v1/campaigns/${encodeURIComponent(campaign.external_key)}/offerings`);
  expect(offerings.releaseKey).toBe(campaigns.releaseKey);

  const pools = await getPages(page, "/api/v1/competition-pools", new URLSearchParams({
    campaign_key: campaign.external_key,
    direction_code: "09.03.01",
  }));
  expect(pools.releaseKey).toBe(campaigns.releaseKey);
  const targetPool = pools.items.find((item) => (
    item.scope_level === "direction_and_target_organization"
    && item.direction_code === "09.03.01"
    && item.quota_type === "targeted"
    && typeof item.campus_label_in_document === "string"
    && item.campus_label_in_document.includes("КФ")
    && Array.isArray(item.offering_keys)
    && item.offering_keys.length > 0
    && typeof item.external_key === "string"
    && typeof item.target_organization === "string"
    && item.target_organization.trim().length > 0
    && typeof item.places === "number"
  ));
  test.skip(!targetPool, "The active read-only release has no Kaluga branch target-quota fixture; the scope rule is covered by deterministic admission-model tests.");
  expect(targetPool, "the release fixture must include an unlinked Kaluga-branch target quota").toBeDefined();
  if (
    !targetPool
    || typeof targetPool.external_key !== "string"
    || typeof targetPool.target_organization !== "string"
    || typeof targetPool.places !== "number"
    || !Array.isArray(targetPool.offering_keys)
  ) {
    throw new Error("No Kaluga-branch target quota was found for 09.03.01.");
  }

  const targetOfferingKeys = targetPool.offering_keys.filter((key): key is string => typeof key === "string");
  const program = programs.items.find((item) => {
    if (
      typeof item.external_key !== "string"
      || typeof item.code !== "string"
      || typeof item.name !== "string"
      || item.campus_scope !== "head_moscow"
      || item.campus_status !== "verified"
      || !Array.isArray(item.offering_keys)
    ) return false;
    const programOfferingKeys = item.offering_keys.filter((key): key is string => typeof key === "string");
    return targetOfferingKeys.some((key) => (
      programOfferingKeys.includes(key)
      && offerings.items.some((offering) => (
        offering.external_key === key
        && offering.program_key === item.external_key
        && offering.program_link_status === "exact"
      ))
    ));
  });
  expect(program, "the fixture must link a branch-scoped pool broadly to a verified Moscow program offer").toBeDefined();
  if (
    !program
    || typeof program.external_key !== "string"
    || typeof program.code !== "string"
    || typeof program.name !== "string"
  ) {
    throw new Error("No head-Moscow program was found through the broad branch pool relation.");
  }

  // These records share a direction and the pool-to-offering relation is
  // broader than a program-level association. With no normalized campus key
  // on the pool DTO, the branch target seats must not appear in a Moscow card.
  await page.goto(`/programs?q=${encodeURIComponent(program.code)}`);
  const logos = page.getByRole("link", { name: "Andromeda × МГТУ имени Баумана — главная" }).locator("img");
  await expect(logos).toHaveCount(2);
  for (const logo of await logos.all()) {
    await expect.poll(() => logo.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  const card = page.getByRole("article").filter({ hasText: program.code }).first();
  await expect(card.getByRole("heading", { level: 2, name: program.name, exact: true })).toBeVisible();
  await card.locator("summary").click();

  const quotaList = card.getByRole("list", { name: "Места по квотам" });
  await expect(quotaList).not.toContainText(targetPool.target_organization);
  await expect(card).toContainText("Целевые места указаны по направлению и заказчику, без распределения между профилями.");
  await card.getByText(/Целевые заказчики по направлению/).click();
  await expect(card).toContainText("Распределение по профилям не задано.");
  await expect(card).not.toContainText(targetPool.campus_label_in_document as string);
  expectHealthyBrowser(diagnostics);
});

test("comparison shows source-backed BVI, shared intake seats and zero seats distinctly", async ({ page, diagnostics }) => {
  const programs = await getPages(page, "/api/v1/programs");
  const selected = ["01.03.02-01", "09.03.04/01", "45.03.02"].map((prefix) => {
    const program = programs.items.find((item) => typeof item.code === "string" && item.code.startsWith(prefix));
    expect(program, `live fixture contains ${prefix}`).toBeDefined();
    if (!program || typeof program.external_key !== "string" || typeof program.code !== "string") throw new Error(`Missing ${prefix}`);
    return { key: program.external_key, code: program.code };
  });
  const campaigns = await getPages(page, "/api/v1/campaigns", new URLSearchParams({ year: "2026" }));
  const campaign = campaigns.items.find((item) => item.campaign_kind === "admission");
  if (!campaign || typeof campaign.external_key !== "string") throw new Error("Missing admission campaign");
  const offerings = await getPages(page, `/api/v1/campaigns/${encodeURIComponent(campaign.external_key)}/offerings`);
  const shared = offerings.items.find((item) => Array.isArray(item.shared_program_keys) && item.shared_program_keys.includes(selected[1]!.key));
  expect(shared?.program_key, "shared seats are not falsely attached to one scalar program").toBeNull();
  expect(shared?.shared_program_keys).toHaveLength(3);
  const pools = await getPages(page, "/api/v1/competition-pools", new URLSearchParams({ campaign_key: campaign.external_key }));
  const includesOffering = (item: Record<string, unknown>, key: unknown) => typeof key === "string" && (item.offering_key === key || (Array.isArray(item.offering_keys) && item.offering_keys.includes(key)));
  const sharedBudget = pools.items.find((item) => includesOffering(item, shared?.external_key) && item.quota_type === "general_competition" && item.funding_type === "budget");
  expect(sharedBudget?.places).toBe(84);
  const languageOffer = offerings.items.find((item) => item.program_key === selected[2]!.key && item.program_link_status === "exact");
  expect(languageOffer).toBeDefined();
  const languageBudget = pools.items.find((item) => includesOffering(item, languageOffer?.external_key) && item.quota_type === "general_competition" && item.funding_type === "budget");
  expect(languageBudget?.places).toBe(0);
  for (const collection of [campaigns, offerings, pools]) expect(collection.releaseKey).toBe(programs.releaseKey);

  await page.addInitScript((keys) => localStorage.setItem("andromeda.compare.v1", JSON.stringify(keys)), selected.map((program) => program.key));
  await page.goto("/compare");
  const table = page.getByRole("table", { name: "Сравнение мест и условий приёма в выбранные программы." });
  await expect(table).toBeVisible();
  const row = (label: string) => table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: label, exact: true }) });
  const cell = (label: string, index: number) => row(label).locator(`td[data-program-label="${selected[index]!.code}"]`);
  await expect(cell("Проходной балл · бюджет · основной конкурс", 0)).toContainText("Есть зачисление БВИ");
  await expect(cell("БВИ · без вступительных испытаний", 0)).toContainText("БВИ — без вступительных испытаний");
  await expect(cell("Бюджетные места · по плану", 1)).toContainText("84 места");
  await expect(cell("Бюджетные места · по плану", 1)).toContainText("единый приёмный план для нескольких программ");
  await expect(cell("Проходной балл · бюджет · основной конкурс", 2)).toContainText("Бюджетные места не предусмотрены");
  await expect(cell("Бюджетные места · по плану", 2)).toContainText("0 мест");
  for (const label of ["Отдельная квота", "Особая квота", "Целевая квота"]) await expect(row(label)).toHaveCount(1);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const showAdmissionHeading = () => page.locator("#admission").evaluate((element) => window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 110));
  await showAdmissionHeading();
  await page.screenshot({ path: "docs/screenshots/admission-repaired-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await showAdmissionHeading();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "docs/screenshots/admission-repaired-mobile.png" });
  expectHealthyBrowser(diagnostics);
});
