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
  const logo = page.getByRole("link", { name: "Andromeda × BMSTU — главная" }).locator("img");
  await expect.poll(() => logo.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const card = page.getByRole("article").filter({ hasText: program.code }).first();
  await expect(card.getByRole("heading", { level: 2, name: program.name, exact: true })).toBeVisible();
  await card.locator("summary").click();

  const quotaList = card.getByRole("list", { name: "Места по квотам" });
  await expect(quotaList).not.toContainText(targetPool.target_organization);
  await expect(card).toContainText("На этом направлении есть целевые квоты уровня «направление и организация»");
  await expect(card).toContainText("Эти места не приписываются программе.");
  expectHealthyBrowser(diagnostics);
});
