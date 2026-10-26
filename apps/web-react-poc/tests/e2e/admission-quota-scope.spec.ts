import type { Page } from "@playwright/test";
import bviReview from "../../docs/data/bvi-orders-20261020.json" with { type: "json" };
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
  await card.getByRole("link", { name: "Подробнее ↗" }).click();
  await expect(page).toHaveURL(/\/programs\/[\w.-]+$/);

  await expect(page.locator("#admission summary")).toContainText("Зачислено на всё направление");
  await expect(page.getByRole("heading", { name: /Проходные баллы/ })).toBeVisible();
  // The direction/organization pool remains API evidence, never a profile's
  // enrollment count or an official-card passing score.
  await expect(page.locator("main")).not.toContainText(targetPool.target_organization);
  await expect(page.locator("main")).not.toContainText(targetPool.campus_label_in_document as string);
  expectHealthyBrowser(diagnostics);
});

test("comparison keeps shared plans independent from official scores and direction enrollment", async ({ page, diagnostics }, testInfo) => {
  // This scenario independently reads paginated offerings/pools and three
  // score sources, then captures two widths. Keep a finite integration budget.
  test.setTimeout(60_000);
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
  const admission = page.locator('[data-qa="admission-summary"]');
  await expect(admission).toHaveAttribute("data-unavailable-count", "0");
  const enrollment = admission.getByRole("table", { name: /Зачислено на всё направление подготовки/ });
  const scores = admission.getByRole("table", { name: /Проходные баллы по официальной карточке/ });
  const departments = await getPages(page, "/api/v1/departments");
  expect(departments.releaseKey).toBe(programs.releaseKey);
  for (const item of selected) {
    const program = programs.items.find((row) => row.external_key === item.key)!;
    const relations = program.department_relations as { department_key: string; verification_status: string }[];
    const relation = relations.find((row) => row.verification_status === "verified");
    const department = departments.items.find((row) => row.external_key === relation?.department_key);
    expect(department).toBeDefined();
    for (const table of [enrollment, scores]) {
      const heading = table.getByRole("columnheader").filter({ hasText: item.code });
      await expect(heading).toContainText(String(program.name));
      await expect(heading).toContainText(String(department!.official_code));
      await expect(heading).toContainText(String(department!.name));
    }
  }
  await expect(enrollment.locator("tbody tr")).toHaveCount(5);
  await expect(scores.locator("tbody tr")).toHaveCount(2);
  const directions = await getPages(page, "/api/v1/directions");
  expect(directions.releaseKey).toBe(programs.releaseKey);
  for (const [index, selectedProgram] of selected.entries()) {
    const raw = programs.items.find((item) => item.external_key === selectedProgram.key)!;
    const direction = directions.items.find((item) => item.external_key === raw.direction_key);
    if (!direction || typeof direction.code !== "string") throw new Error("Missing exact direction code");
    const statistics = await getPages(page, "/api/v1/statistics", new URLSearchParams({ kind: "historical", year: "2026", direction_code: direction.code }));
    expect(statistics.releaseKey).toBe(programs.releaseKey);
    const official = statistics.items.filter((item) => item.statistic_kind === "official_program_card_passing_score");
    expect(official).toHaveLength(2);
    for (const [funding, label] of [["budget", "Бюджет"], ["paid", "Платное обучение"]] as const) {
      const fact = official.find((item) => item.funding_type === funding)!;
      expect(fact.scope_type).toBe("direction");
      expect(fact.scope_label).toBe(direction.code);
      const row = scores.getByRole("row").filter({ has: page.getByRole("rowheader", { name: label, exact: true }) });
      const cell = row.locator(`td[data-program-label="${selectedProgram.code}"]`);
      const bvi = funding === "budget" && fact.minimum_score == null
        ? bviReview.directions.find((item) => item.directionCode === direction.code && item.verdict === "bvi_outside_quotas") : undefined;
      const expected = fact.minimum_score == null ? bvi ? "БВИ вне квот" : "Не опубликован" : `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(Number(fact.minimum_score))} баллов`;
      await expect(cell.locator("strong")).toHaveText(expected);
      const sources = fact.sources as { source_url: string }[];
      const source = sources.find((item) => item.source_url.startsWith("https://api.www.bmstu.ru/majors/"));
      expect(source).toBeDefined();
      await expect(cell.getByRole("link", { name: "Источник" })).toHaveAttribute("href",
        `https://bmstu.ru/bachelor/majors/${new URL(source!.source_url).pathname.split("/").at(-1)}`);
      if (bvi) {
        await expect(cell).toContainText(`${bvi.bviAdmitted} зачисленных`);
        await expect(cell.getByRole("link", { name: "Приказ о зачислении БВИ" })).toHaveAttribute("href", bvi.bviSource!);
      } else await expect(cell).not.toContainText("БВИ");
    }
    const budget = enrollment.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Бюджет · всего", exact: true }) }).getByRole("cell").nth(index);
    // Planned84/0 seats are checked independently above, never reinterpreted
    // as enrolled people or as permission to invent a zero passing score.
    await expect(budget).not.toContainText("мест");
    if (await budget.locator("strong").innerText() !== "Не опубликовано") await expect(budget).toContainText(`Всё направление подготовки ${direction.code} · все профили`);
  }
  await expect(scores.getByRole("rowheader", { name: /квота|БВИ/ })).toHaveCount(0);
  for (const label of ["В том числе · отдельная квота", "В том числе · особая квота", "В том числе · целевая квота"]) {
    await expect(enrollment.getByRole("rowheader", { name: label, exact: true })).toBeVisible();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const showAdmissionHeading = () => page.locator("#admission").evaluate((element) => window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 110));
  await showAdmissionHeading();
  await page.screenshot({ path: testInfo.outputPath("admission-official-card-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileIdentity = scores.locator(`td[data-program-label="${selected[1]!.code}"]`).first();
  expect(await mobileIdentity.getAttribute("data-program-details")).toContain("ИУ7");
  expect(await mobileIdentity.evaluate((element) => getComputedStyle(element, "::before").content)).toContain("ИУ7");
  await showAdmissionHeading();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("admission-official-card-mobile.png") });
  expectHealthyBrowser(diagnostics);
});
