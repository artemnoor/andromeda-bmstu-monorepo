import { createHash } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(scriptDirectory, "../public/data/prof-test-profile-snapshot.json");
const apiBaseUrl = (process.env.ACADEMIC_DATA_API_BASE_URL ?? "http://127.0.0.1:8000/api/v1").replace(/\/$/, "");
const PAGE_SIZE = 100;
const CONCURRENCY = 4;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function finiteNumber(value) {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function academicYearEnd(value) {
  const years = value?.match(/(?:19|20)\d{2}/g)?.map(Number) ?? [];
  return years.length ? Math.max(...years) : null;
}

function selectLatestVerifiedPlans(programs, plans) {
  const selected = [];
  const unavailable = new Set();
  for (const program of programs) {
    const candidates = plans.filter((plan) => plan.program_key === program.external_key);
    if (!candidates.length) {
      unavailable.add(program.external_key);
      continue;
    }
    let latest = candidates;
    if (candidates.length > 1) {
      const years = candidates.map((plan) => academicYearEnd(plan.academic_year));
      if (years.some((year) => year === null)) {
        unavailable.add(program.external_key);
        continue;
      }
      const latestYear = Math.max(...years);
      latest = candidates.filter((_, index) => years[index] === latestYear);
    }
    const plan = latest[0];
    if (latest.length !== 1 || !plan || plan.status !== "parsed" || plan.profile_link_status !== "verified") {
      unavailable.add(program.external_key);
      continue;
    }
    selected.push(plan);
  }
  return { selected, unavailable };
}

async function requestJson(path, signal) {
  const response = await fetch(`${apiBaseUrl}${path}`, { signal, headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Academic API returned HTTP ${response.status} for ${path}.`);
  return response.json();
}

async function collectPages(path, expectedReleaseKey, signal) {
  const items = [];
  const seenCursors = new Set();
  let cursor = null;
  let totalCount = null;
  do {
    const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (cursor) query.set("cursor", cursor);
    const page = await requestJson(`${path}?${query}`, signal);
    assert(page.page?.release_key === expectedReleaseKey, `Release changed while reading ${path}.`);
    if (totalCount === null) totalCount = page.page.total_count;
    else assert(page.page.total_count === totalCount, `Record count changed while reading ${path}.`);
    items.push(...page.items);
    const next = page.page.next_cursor;
    assert(!next || (next !== cursor && !seenCursors.has(next)), `The API repeated a cursor for ${path}.`);
    if (next) seenCursors.add(next);
    cursor = next;
  } while (cursor);
  assert(totalCount === null || items.length === totalCount, `Incomplete collection for ${path}.`);
  return items;
}

async function loadPlanItems(plan, releaseKey, signal) {
  const rows = await collectPages(`/study-plans/${encodeURIComponent(plan.external_key)}/items`, releaseKey, signal);
  assert(plan.item_count === null || plan.item_count === undefined || rows.length === plan.item_count,
    `Study plan ${plan.external_key} returned a different item count.`);
  assert(rows.every((row) => row.study_plan_key === plan.external_key),
    `Study plan ${plan.external_key} returned rows owned by another plan.`);
  return rows;
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const output = new Array(values.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      output[index] = await mapper(values[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return output;
}

function profileForPlan(plan, items, taxonomy) {
  const categoryHours = new Map();
  const activityTotals = {};
  const knownActivities = new Set();
  let totalHours = 0;
  let assignedHours = 0;
  let classifiedRows = 0;
  let assignedRows = 0;
  let reviewRows = 0;

  for (const item of items) {
    const hours = finiteNumber(item.total_hours ?? item.hours);
    if (hours !== null && hours > 0) totalHours += hours;
    const assignment = item.subject_classification;
    const categoryCode = assignment?.category_code;
    const belongsToTaxonomy = assignment?.taxonomy_key === taxonomy.taxonomy_key
      && assignment?.taxonomy_version === taxonomy.taxonomy_version;
    assert(categoryCode && belongsToTaxonomy && taxonomy.categoryCodes.has(categoryCode),
      `Academic API returned no valid category for curriculum item ${item.external_key}.`);
    assert(assignment.category_name === taxonomy.categoryNames.get(categoryCode),
      `Academic API returned a mismatched category name for curriculum item ${item.external_key}.`);
    assert(assignment.review_status === "classified" || assignment.review_status === "needs_review",
      `Academic API returned an unsupported category review status for curriculum item ${item.external_key}.`);
    assignedRows += 1;
    if (assignment.review_status === "classified") classifiedRows += 1;
    else reviewRows += 1;
    if (hours !== null && hours > 0) {
      categoryHours.set(categoryCode, (categoryHours.get(categoryCode) ?? 0) + hours);
      assignedHours += hours;
    }

    for (const field of ["lecture_hours", "practice_hours", "lab_hours", "self_study_hours"]) {
      const value = finiteNumber(item[field]);
      assert(value !== null && value >= 0,
        `Academic API returned incomplete ${field} data for curriculum item ${item.external_key}.`);
      knownActivities.add(field);
      activityTotals[field] = (activityTotals[field] ?? 0) + value;
    }
  }

  const activityTotal = Object.values(activityTotals).reduce((sum, value) => sum + value, 0);
  const activityShares = {};
  if (activityTotal > 0) {
    for (const field of knownActivities) activityShares[field] = (activityTotals[field] ?? 0) / activityTotal;
  }

  return {
    program_key: plan.program_key,
    plan_key: plan.external_key,
    plan_item_count: items.length,
    total_hours: totalHours,
    assigned_hours: assignedHours,
    classified_rows: classifiedRows,
    assigned_rows: assignedRows,
    review_rows: reviewRows,
    category_hours: Object.fromEntries([...categoryHours].sort(([left], [right]) => left.localeCompare(right, "en"))),
    activity_shares: activityShares,
  };
}

async function main() {
  const controller = new AbortController();
  const activeBefore = await requestJson("/release", controller.signal);
  const [programs, plans, taxonomyRecord] = await Promise.all([
    collectPages("/programs", activeBefore.release_key, controller.signal),
    collectPages("/study-plans", activeBefore.release_key, controller.signal),
    requestJson("/subject-taxonomies/bmstu-subject-domain-16/v1", controller.signal),
  ]);
  const taxonomy = {
    taxonomy_key: taxonomyRecord.taxonomy_key,
    taxonomy_version: taxonomyRecord.taxonomy_version,
    categories: taxonomyRecord.categories,
    categoryCodes: new Set(taxonomyRecord.categories.map((category) => category.category_code)),
    categoryNames: new Map(taxonomyRecord.categories.map((category) => [category.category_code, category.name])),
  };
  assert(taxonomy.taxonomy_key === "bmstu-subject-domain-16" && taxonomy.taxonomy_version === "v1",
    "The active user taxonomy does not match the legacy assignments.");
  assert(taxonomy.categoryCodes.size >= 2, "The active user taxonomy contains too few categories.");

  const selection = selectLatestVerifiedPlans(programs, plans);
  const rowsByPlan = await mapWithConcurrency(selection.selected, CONCURRENCY,
    (plan) => loadPlanItems(plan, activeBefore.release_key, controller.signal));
  const profiles = selection.selected.map((plan, index) => profileForPlan(plan, rowsByPlan[index] ?? [], taxonomy));
  const totalCurriculumRows = rowsByPlan.reduce((sum, rows) => sum + rows.length, 0);
  const classifiedRows = profiles.reduce((sum, profile) => sum + profile.classified_rows, 0);
  const assignedRows = profiles.reduce((sum, profile) => sum + profile.assigned_rows, 0);
  const reviewRows = profiles.reduce((sum, profile) => sum + profile.review_rows, 0);
  assert(profiles.length === selection.selected.length, "A selected verified plan produced no category profile.");
  assert(assignedRows === totalCurriculumRows, "Some selected curriculum rows have no assigned taxonomy category.");
  assert(classifiedRows + reviewRows === assignedRows, "Some assigned categories have no supported review status.");

  const sourceRows = rowsByPlan.flat().map((item) => ({
    external_key: item.external_key,
    study_plan_key: item.study_plan_key,
    discipline_name: item.discipline_name,
    total_hours: item.total_hours,
    hours: item.hours,
    lecture_hours: item.lecture_hours,
    practice_hours: item.practice_hours,
    lab_hours: item.lab_hours,
    self_study_hours: item.self_study_hours,
    subject_classification: {
      taxonomy_key: item.subject_classification.taxonomy_key,
      taxonomy_version: item.subject_classification.taxonomy_version,
      category_code: item.subject_classification.category_code,
      category_name: item.subject_classification.category_name,
      confidence: item.subject_classification.confidence,
      review_status: item.subject_classification.review_status,
    },
  })).sort((left, right) => left.external_key.localeCompare(right.external_key, "en"));
  const sourceCurriculumSha256 = createHash("sha256").update(JSON.stringify(sourceRows)).digest("hex");
  const activeAfter = await requestJson("/release", controller.signal);
  assert(activeAfter.release_key === activeBefore.release_key, "The active release changed during snapshot generation.");

  const snapshot = {
    schema_version: 2,
    release: activeBefore,
    taxonomy: {
      taxonomy_key: taxonomy.taxonomy_key,
      taxonomy_version: taxonomy.taxonomy_version,
    },
    generated_at: new Date().toISOString(),
    source_curriculum_sha256: sourceCurriculumSha256,
    program_count: programs.length,
    selected_plan_count: selection.selected.length,
    unavailable_program_count: selection.unavailable.size,
    total_curriculum_rows: totalCurriculumRows,
    classified_rows: classifiedRows,
    assigned_rows: assignedRows,
    review_rows: reviewRows,
    profiles,
  };

  const bytes = `${JSON.stringify(snapshot)}\n`;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, bytes, "utf8");
  console.log(JSON.stringify({
    outputPath,
    releaseKey: activeBefore.release_key,
    programs: programs.length,
    selectedPlans: selection.selected.length,
    rankedProfiles: profiles.length,
    curriculumRows: totalCurriculumRows,
    assignedRows,
    classifiedRows,
    reviewRows,
    snapshotBytes: Buffer.byteLength(bytes),
  }, null, 2));
}

main().catch((error) => {
  console.error(`Profile snapshot generation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
