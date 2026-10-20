import assert from "node:assert/strict";

const origin = (process.argv[2] ?? "http://127.0.0.1:4181").replace(/\/$/, "");
async function read(path) {
  const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(20000), cache: "no-store" });
  assert(response.ok, `${path}: HTTP ${response.status}`);
  return response.json();
}

const release = await read("/api/v1/release");
const snapshot = await read("/data/prof-test-profile-snapshot.json");
assert.equal(snapshot.release.release_key, release.release_key, "Profile snapshot belongs to another release");
assert(snapshot.total_curriculum_rows > 0, "Profile snapshot contains no curriculum rows");
assert.equal(snapshot.assigned_rows, snapshot.total_curriculum_rows, "Profile snapshot has missing categories");
assert.equal(snapshot.profiles.length, snapshot.selected_plan_count, "Profile coverage is incomplete");
const plans = await read("/api/v1/study-plans?limit=100");
assert.equal(plans.page.release_key, release.release_key, "Plans came from another release");
const plan = plans.items.find((entry) => entry.status === "parsed" && entry.profile_link_status === "verified" && entry.item_count > 0);
assert(plan, "No verified nonempty study plan is available for the live category check");
const items = await read(`/api/v1/study-plans/${encodeURIComponent(plan.external_key)}/items?limit=100`);
assert.equal(items.page.release_key, release.release_key, "Curriculum came from another release");
assert(items.items.length > 0, "The live curriculum sample is empty");
assert(items.items.every((entry) => entry.subject_classification), "Live API lost release-scoped subject categories");
const after = await read("/api/v1/release");
assert.equal(after.release_key, release.release_key, "Active release changed during verification");
console.log(JSON.stringify({
  releaseKey: release.release_key,
  snapshotAssignedRows: snapshot.assigned_rows,
  snapshotPlans: snapshot.selected_plan_count,
  sampledLiveRows: items.items.length,
  sampledClassifiedRows: items.items.filter((entry) => entry.subject_classification).length,
}, null, 2));
