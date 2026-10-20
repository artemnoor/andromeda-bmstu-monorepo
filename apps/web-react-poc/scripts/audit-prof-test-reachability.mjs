import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Run from any directory: node apps/web-react-poc/scripts/audit-prof-test-reachability.mjs
// Exercise the actual TypeScript model in memory, without copying its scoring,
// pair selection, stopping rules, or profile construction into this script.
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const seed = 271828;
const iterations = 10_000;
const paths = {
  model: "src/features/prof-test/model.ts",
  comparisonModel: "src/features/comparison/model.ts",
  snapshot: "public/data/prof-test-profile-snapshot.json",
};
const sources = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([key, path]) => [
  key, await readFile(resolve(appRoot, path), "utf8"),
])));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const moduleUrl = (source) => {
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return `data:text/javascript;base64,${Buffer.from(result.outputText).toString("base64")}`;
};
const comparisonUrl = moduleUrl(sources.comparisonModel);
assert.ok(sources.model.includes('from "@/features/comparison/model"'));
const model = await import(moduleUrl(sources.model.replace(
  'from "@/features/comparison/model"', `from "${comparisonUrl}"`,
)));
const snapshot = JSON.parse(sources.snapshot);
const categoryCodes = [...new Set(snapshot.profiles.flatMap((profile) => Object.keys(profile.category_hours)))].sort();
const categories = categoryCodes.map((code, index) => ({ code, name: code, definition: "", ordinal: index + 1 }));
const taxonomy = {
  ...snapshot.taxonomy,
  categories: categories.map(({ code, name, definition, ordinal }) => ({ category_code: code, name, definition, ordinal })),
};
const programs = snapshot.profiles.map((profile) => {
  const code = profile.program_key.match(/:(\d{2}\.\d{2}\.\d{2}(?:[-/][^:]+)?):source:/)?.[1];
  assert.ok(code, `Cannot extract exact program code: ${profile.program_key}`);
  return { external_key: profile.program_key, code };
});
// Only snapshot-included verified profiles are reconstructed. The 25 programs
// without verified plans cannot be independently evaluated from this file.
const plans = snapshot.profiles.map((profile) => ({
  external_key: profile.plan_key,
  program_key: profile.program_key,
  academic_year: "2026",
  status: "parsed",
  profile_link_status: "verified",
  item_count: profile.plan_item_count,
}));
const profiles = model.buildProgramProfilesFromSnapshot({
  programs, plans, taxonomy, snapshots: snapshot.profiles,
}).profiles;
assert.equal(profiles.length, snapshot.selected_plan_count);

let randomState = seed;
const random = () => {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  return randomState / 4294967296;
};
const shuffled = (values) => {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
};
const activityChoices = [model.NO_ACTIVITY, ...model.ACTIVITY_OPTIONS.map(({ key }) => key)];
const pairChoices = model.PAIR_CHOICES.map(({ value }) => value).sort((left, right) => left - right);
const thresholds = [1, 3, 5, 10];
const covered = new Map(thresholds.map((threshold) => [threshold, new Set()]));
const best = new Map();
const comparisonCounts = {};
const milestones = [];
let noSignalFlows = 0;

for (let iteration = 0; iteration < iterations; iteration += 1) {
  const interests = iteration < categoryCodes.length
    ? [categoryCodes[iteration]]
    : random() < 0.05
      ? [model.UNKNOWN_INTEREST]
      : shuffled(categoryCodes).slice(0, 1 + Math.floor(random() * model.MAX_INTERESTS));
  let answers = {
    interests,
    activity: activityChoices[Math.floor(random() * activityChoices.length)],
    // Avoid/interests contradictions are not sampled even though the old UI
    // permitted them. This is a documented subset of UI-allowed answers.
    avoid: shuffled(categoryCodes.filter((code) => !interests.includes(code)))
      .slice(0, Math.floor(random() * (model.MAX_AVOID + 1))),
    comparisons: [],
  };
  while (answers.comparisons.length < model.MAX_COMPARISONS) {
    const pair = model.selectAdaptivePair(profiles, categories, answers);
    if (!pair) break;
    const value = pairChoices[Math.floor(random() * pairChoices.length)];
    const finish = model.shouldFinishAfterComparison(profiles, answers, pair, value);
    answers = { ...answers, comparisons: [...answers.comparisons, { left: pair.left, right: pair.right, value }] };
    if (finish) break;
  }
  assert.ok(answers.interests.length <= model.MAX_INTERESTS);
  assert.ok(answers.avoid.length <= model.MAX_AVOID);
  assert.ok(answers.comparisons.length <= model.MAX_COMPARISONS);
  const ranking = model.rankPrograms(profiles, answers);
  assert.equal(new Set(ranking.map(({ profile }) => profile.program.external_key)).size, profiles.length);
  if (!ranking.some(({ score }) => score > 0)) noSignalFlows += 1;
  comparisonCounts[answers.comparisons.length] = (comparisonCounts[answers.comparisons.length] ?? 0) + 1;
  ranking.forEach(({ profile, score }, index) => {
    const key = profile.program.external_key;
    const rank = index + 1;
    for (const threshold of thresholds) if (rank <= threshold) covered.get(threshold).add(key);
    if (rank < (best.get(key)?.rank ?? Number.POSITIVE_INFINITY)) {
      best.set(key, { program_key: key, code: profile.program.code, rank, score, iteration: iteration + 1, answers });
    }
  });
  if ([1_000, 5_000, iterations].includes(iteration + 1)) {
    milestones.push({ iterations: iteration + 1, ...Object.fromEntries(thresholds.map((threshold) => [`top${threshold}`, covered.get(threshold).size])) });
  }
}

const signatures = new Map();
for (const profile of profiles) {
  const signature = JSON.stringify([
    categoryCodes.map((code) => profile.categoryShares.get(code) ?? 0),
    model.ACTIVITY_OPTIONS.map(({ key }) => profile.activityShares[key] ?? null),
  ]);
  const keys = signatures.get(signature) ?? [];
  keys.push(profile.program.external_key);
  signatures.set(signature, keys);
}
const output = {
  schema_version: 1,
  environment: { node: process.version, platform: process.platform, arch: process.arch, typescript: ts.version, icu: process.versions.icu },
  sources: Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, { path, sha256: sha256(sources[key]) }])),
  academic_release: snapshot.release,
  seed,
  prng: "LCG uint32: state = 1664525 * state + 1013904223; divide by 2**32",
  iterations,
  sampling: {
    interests: `First ${categoryCodes.length} flows select each single category; subsequent flows use unknown with 5% probability, otherwise 1..${model.MAX_INTERESTS} distinct uniformly shuffled categories.`,
    activity: "Uniform among no preference and actual model activity options.",
    avoid: `0..${model.MAX_AVOID} shuffled categories excluding selected interests; empty avoid represents skipped question.`,
    comparisons: "Uniform among actual pair values sorted ascending; actual adaptive pair selection and early stopping.",
  },
  catalog_program_count: snapshot.program_count,
  verified_profile_count: profiles.length,
  unavailable_verified_plan_count: snapshot.unavailable_program_count,
  no_signal_flows: noSignalFlows,
  comparison_counts: comparisonCounts,
  coverage: Object.fromEntries(thresholds.map((threshold) => [`top${threshold}`, {
    count: covered.get(threshold).size,
    program_keys: [...covered.get(threshold)].sort(),
  }])),
  full_ranking_coverage: profiles.length,
  exact_duplicate_feature_vectors: [...signatures.values()].filter((keys) => keys.length > 1),
  milestones,
  best_observed_ranks: [...best.values()].sort((left, right) => left.program_key.localeCompare(right.program_key, "en")),
  cautions: [
    "Sampled coverage is a lower bound, not an exhaustive reachability proof. Missing top-k observations do not prove a program unreachable.",
    "All verified profiles are included in every full ranking; this does not guarantee that the browser UI exposes every ranked entry.",
    "The academic snapshot supplies profiles only. Synthetic program/plan identity records mirror calibration tests; live catalog/release/plan-selection verification is outside this audit.",
    "Category order is ascending snapshot category code, matching numeric taxonomy order; names and descriptions do not affect model scoring.",
    "No ranking, expected result, academic source, or UI has been changed by this script.",
    "This model audit does not replace keyboard, screen-reader, viewport, browser, or end-to-end tests.",
  ],
};
const outputPath = resolve(appRoot, "benchmarks/prof-test-reachability.json");
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({
  output: "benchmarks/prof-test-reachability.json",
  seed,
  iterations,
  profiles: profiles.length,
  ...Object.fromEntries(thresholds.map((threshold) => [`top${threshold}`, covered.get(threshold).size])),
  fullRanking: profiles.length,
  caution: "Sampled lower bounds; not proof of exhaustive top-k reachability.",
}, null, 2));
