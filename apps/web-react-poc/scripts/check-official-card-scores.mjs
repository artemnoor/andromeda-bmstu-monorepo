import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const { values } = parseArgs({ options: {
  "base-url": { type: "string", default: "http://127.0.0.1:4181" },
  expected: { type: "string", default: "docs/data/official-card-scores-20261020.json" },
  output: { type: "string", default: "test-results/official-card-scores.json" },
} });
const base = new URL(values["base-url"]);
const expected = JSON.parse(await readFile(values.expected, "utf8"));
// Independent full-PDF section census, including directions where a dash
// coexists with main-competition admits and must NOT be called BVI-only.
const bviReview = JSON.parse(await readFile("docs/data/bvi-orders-20261020.json", "utf8"));
const cards = new Map(expected.cards.map((card) => [card.url, card]));
const fetchJson = async (path) => {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(20_000) });
  assert(response.ok, `HTTP ${response.status} for ${path}`);
  return response.json();
};
const release = await fetchJson("/api/v1/release");
async function collection(path) {
  const items = [];
  let cursor;
  do {
    const url = new URL(path, base);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const data = await fetchJson(url);
    assert.equal(data.page.release_key, release.release_key, "Cross-release collection");
    items.push(...data.items);
    cursor = data.page.next_cursor;
  } while (cursor);
  return items;
}
const programs = await collection("/api/v1/programs");
const statistics = (await collection("/api/v1/statistics?kind=historical&year=2026"))
  .filter((record) => record.statistic_kind === "official_program_card_passing_score");
assert.equal(statistics.length, cards.size * 2);
const jobs = programs.map((program) => {
  const url = program.sources.map((source) => source.source_url).find((url) => cards.has(url));
  assert(url, `No exact official card for ${program.external_key}`);
  const card = cards.get(url);
  for (const funding of ["budget", "paid"]) {
    const rows = statistics.filter((row) => row.direction_key === program.direction_key && row.funding_type === funding);
    assert.equal(rows.length, 1, `Nonunique score ${program.external_key}/${funding}`);
    const raw = card.year2026[funding];
    const score = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : null;
    assert.equal(rows[0].minimum_score === null ? null : Number(rows[0].minimum_score), score);
    assert(rows[0].sources.some((source) => source.source_url === url && source.sha256 === card.sha256));
  }
  const bvi = bviReview.directions.find((item) => item.directionCode === card.code
    && item.verdict === "bvi_outside_quotas" && program.campus_scope === "head_moscow");
  return { program, url, card, bvi };
});
const browser = await chromium.launch();
const report = { capturedAt: new Date().toISOString(), releaseKey: release.release_key, expectedSourceCapture: expected.fetchedAt,
  browser: browser.version(), complete: false, apiPrograms: programs.length, apiScoreFacts: statistics.length, checkedPrograms: [] };
try {
  // Each worker keeps a catalog context: same-direction admission requests reuse
  // the application's normal release-scoped cache. No source API browser bypass.
  await Promise.all(Array.from({ length: 4 }, async (_, worker) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(new URL("/programs", base).href);
      await page.locator("article[data-program-key]").nth(programs.length - 1).waitFor();
      for (const { program, url, card, bvi } of jobs.filter((_, index) => index % 4 === worker)) {
        const article = page.locator(`article[data-program-key=${JSON.stringify(program.external_key)}]`);
        await article.getByRole("button", { name: "Подробнее", exact: true }).click();
        const table = article.getByRole("table", { name: "Проходные баллы по официальной карточке и сведения БВИ по приказам за 2026 год" });
        await table.waitFor();
        const rows = table.locator("tbody tr");
        assert.equal(await rows.count(), 2);
        const displayed = {};
        for (const [index, funding] of ["budget", "paid"].entries()) {
          const raw = card.year2026[funding];
          const numeric = typeof raw === "number" || (typeof raw === "string" && /^\d+$/.test(raw));
          const isBvi = !numeric && funding === "budget" && bvi;
          const wanted = numeric ? `${Number(raw)} баллов` : isBvi ? "БВИ вне квот" : "Не опубликован";
          const cell = rows.nth(index).locator("td");
          displayed[funding] = await cell.locator("strong").textContent();
          assert.equal(displayed[funding], wanted, `Wrong displayed score for ${program.external_key}/${funding}`);
          const publicUrl = `https://bmstu.ru/bachelor/majors/${new URL(url).pathname.split("/").at(-1)}`;
          assert.equal(await cell.getByRole("link", { name: "Источник ↗" }).getAttribute("href"), publicUrl);
          if (isBvi) {
            assert((await cell.textContent()).includes(`${bvi.bviAdmitted} зачисленных`));
            assert.equal(await cell.getByRole("link", { name: "Приказ о зачислении БВИ ↗" }).getAttribute("href"), bvi.bviSource);
          }
        }
        assert.equal(await article.locator("footer").getByRole("link", { name: "Источник" }).getAttribute("href"),
          `https://bmstu.ru/bachelor/majors/${new URL(url).pathname.split("/").at(-1)}`);
        const apiLinks = await article.locator('a[href^="https://api.www.bmstu.ru/"]').evaluateAll((links) => links.map((link) => link.href));
        // Official document downloads also use this host; they open the actual
        // document and must keep their exact source address.
        assert.deepEqual(apiLinks.filter((href) => !/^\/file\/\d+\/download$/.test(new URL(href).pathname)), [], program.code);
        report.checkedPrograms.push({ key: program.external_key, code: program.code, cardUrl: url, displayed });
        await article.getByRole("button", { name: "Скрыть", exact: true }).click();
      }
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }));
  assert.equal(report.checkedPrograms.length, programs.length);
  assert.equal((await fetchJson("/api/v1/release")).release_key, release.release_key);
  report.complete = true;
  console.log(JSON.stringify({ releaseKey: report.releaseKey, programs: programs.length, scoreFacts: statistics.length, checked: report.checkedPrograms.length }));
} finally {
  await browser.close();
  report.checkedPrograms.sort((a, b) => a.key.localeCompare(b.key));
  await mkdir(dirname(values.output), { recursive: true });
  await writeFile(values.output, JSON.stringify(report, null, 2) + "\n");
}
