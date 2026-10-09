import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(appRoot, "assets", "prof-test.js"), "utf8");

function element() {
  return {
    hidden: false,
    disabled: false,
    textContent: "",
    dataset: {},
    style: { setProperty() {} },
    addEventListener() {},
    append() {},
    appendChild() {},
    replaceChildren() {},
    setAttribute() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    scrollIntoView() {},
  };
}

function loadScoringFunctions() {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    createElement: element,
    createTextNode(value) { return { textContent: String(value) }; },
  };
  const window = { AcademicData: { isDemoMode: () => false } };
  const Andromeda = {
    text(value) { return value == null ? "" : String(value).trim(); },
    getSubjectClassification(item) {
      const classification = item?.subject_classification || item?.subjectClassification || null;
      if (classification?.review_status && classification.review_status !== "classified") return null;
      const code = classification?.category_code;
      const name = classification?.category_name;
      return code || name ? { code: code || "", name: name || "" } : null;
    },
    loadPrograms: async () => { throw new Error("No app initialization in a pure algorithm test"); },
  };
  const injection = `
    window.__qa = {
      configure({ categoryCodes, profileRows, answers = {} }) {
        categories = categoryCodes.map((code) => ({ code, name: code, definition: "" }));
        profiles = setProfileMaxima(profileRows.map((row) => ({
          program: { code: row.code },
          categoryShares: new Map(Object.entries(row.categoryShares)),
          activityShares: { ...(row.activityShares || {}) },
          totalHours: row.totalHours || 0,
          classifiedHours: row.classifiedHours || 0,
          plan: null,
        })));
        state = { ...freshState(), ...answers };
      },
      configureCurriculum({ categoryCodes, programRows, planRows, curriculumRows }) {
        categories = categoryCodes.map((code) => ({ code, name: code, definition: "" }));
        programs = programRows;
        const built = buildProgramProfiles({ plans: planRows, data: curriculumRows });
        return built.map((profile) => ({
          code: profile.program.code,
          totalHours: profile.totalHours,
          classifiedHours: profile.classifiedHours,
          categoryShares: Object.fromEntries(profile.categoryShares),
        }));
      },
      rankedPrograms,
      fitFor,
      preferenceWeights,
      selectAdaptivePair,
    };
  `;
  const bootMarker = /  initialize\(\);\r?\n\}\)\(\);\s*$/;
  const bootMatch = source.match(bootMarker);
  assert.ok(bootMatch, "test harness must inject before the app's real initialization call");
  const bootIndex = bootMatch.index;
  const instrumented = `${source.slice(0, bootIndex)}${injection}\n${source.slice(bootIndex)}`;
  const context = vm.createContext({ window, document, Andromeda, console });
  vm.runInContext(instrumented, context, { filename: "prof-test.js" });
  return window.__qa;
}

const closeTo = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-10, `${message}: ${actual} != ${expected}`);

function oracleScore(profile, profiles, answers) {
  const weights = new Map();
  for (const code of answers.interests || []) {
    if (code !== "__unknown__") weights.set(code, 1);
  }
  for (const choice of answers.comparisons || []) {
    const delta = choice.value * 0.45;
    weights.set(choice.left, (weights.get(choice.left) || 0) + delta);
    weights.set(choice.right, (weights.get(choice.right) || 0) - delta);
  }
  const categoryMaximum = new Map();
  const activityMaximum = {};
  for (const other of profiles) {
    for (const [code, share] of Object.entries(other.categoryShares)) {
      categoryMaximum.set(code, Math.max(categoryMaximum.get(code) || 0, share));
    }
    for (const [key, share] of Object.entries(other.activityShares || {})) {
      activityMaximum[key] = Math.max(activityMaximum[key] || 0, share);
    }
  }
  const normalized = code => {
    const maximum = categoryMaximum.get(code) || 0;
    return maximum > 0 ? (profile.categoryShares[code] || 0) / maximum : 0;
  };
  const positive = [...weights].filter(([, weight]) => weight > 0.04);
  const denominator = positive.reduce((sum, [, weight]) => sum + weight, 0);
  const subject = denominator
    ? positive.reduce((sum, [code, weight]) => sum + weight * normalized(code), 0) / denominator
    : 0;
  const activityShare = answers.activity ? profile.activityShares?.[answers.activity] : null;
  const activityMax = answers.activity ? activityMaximum[answers.activity] || 0 : 0;
  const activityFit = activityShare !== null && activityShare !== undefined && activityMax > 0
    ? activityShare / activityMax
    : null;
  const blend = activityFit === null ? subject : subject * 0.82 + activityFit * 0.18;
  const avoided = (answers.avoid || []).filter(code => code !== "__none__");
  const anti = avoided.length ? avoided.reduce((sum, code) => sum + normalized(code), 0) / avoided.length : 0;
  return Math.max(0, Math.min(100, blend * 100 - anti * 12));
}

function oracleAdaptivePair(profiles, categoryCodes, answers) {
  const used = new Set((answers.comparisons || []).flatMap(item => [item.left, item.right]));
  const available = categoryCodes.filter(code => !used.has(code));
  if (available.length < 2 || profiles.length < 2) return null;
  const ordered = [...profiles].sort((a, b) => b.score - a.score || a.code.localeCompare(b.code, "ru"));
  const leaders = ordered.slice(0, 12);
  let winner = null;
  for (let leftIndex = 0; leftIndex < available.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < available.length; rightIndex += 1) {
      const left = available[leftIndex];
      const right = available[rightIndex];
      const deltas = leaders.map(profile => (profile.categoryShares[left] || 0) - (profile.categoryShares[right] || 0));
      const mean = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
      const variance = deltas.reduce((sum, value) => sum + (value - mean) ** 2, 0) / deltas.length;
      const separation = Math.sqrt(variance) + Math.abs(mean) * 0.1;
      if (!winner || separation > winner.score) winner = { left, right, score: separation };
    }
  }
  return winner && { left: winner.left, right: winner.right };
}

test("program scores and ordering match an independent formula across interests, activity, comparisons, and avoids", () => {
  const qa = loadScoringFunctions();
  const profileRows = [
    { code: "P01", categoryShares: { A: 0.8, B: 0.15, C: 0.05 }, activityShares: { lecture_hours: 0.4 } },
    { code: "P02", categoryShares: { A: 0.2, B: 0.7, C: 0.1 }, activityShares: { lecture_hours: 0.8 } },
    { code: "P03", categoryShares: { A: 0.1, B: 0.2, C: 0.7 }, activityShares: { lecture_hours: 0.2 } },
  ];
  const answers = {
    interests: ["A", "B"],
    activity: "lecture_hours",
    avoid: ["C"],
    comparisons: [{ left: "A", right: "C", value: 1 }],
  };
  qa.configure({ categoryCodes: ["A", "B", "C"], profileRows, answers });

  const actual = qa.rankedPrograms().map(item => ({ code: item.profile.program.code, score: item.score }));
  const expected = profileRows
    .map(profile => ({ code: profile.code, score: oracleScore(profile, profileRows, answers) }))
    .sort((left, right) => right.score - left.score || left.code.localeCompare(right.code, "ru"));
  assert.deepEqual(actual.map(item => item.code), expected.map(item => item.code));
  for (let index = 0; index < actual.length; index += 1) closeTo(actual[index].score, expected[index].score, actual[index].code);
});

test("adaptive question selection matches an independent variance oracle and excludes already-used categories", () => {
  const qa = loadScoringFunctions();
  const profileRows = [
    { code: "P01", categoryShares: { A: 0.75, B: 0.15, C: 0.05, D: 0.05 } },
    { code: "P02", categoryShares: { A: 0.05, B: 0.75, C: 0.15, D: 0.05 } },
    { code: "P03", categoryShares: { A: 0.1, B: 0.1, C: 0.1, D: 0.7 } },
    { code: "P04", categoryShares: { A: 0.25, B: 0.25, C: 0.25, D: 0.25 } },
  ];
  const answers = {
    interests: [],
    activity: "",
    avoid: [],
    comparisons: [{ left: "A", right: "D", value: 0 }],
  };
  qa.configure({ categoryCodes: ["A", "B", "C", "D"], profileRows, answers });

  const ranked = profileRows.map(profile => ({
    ...profile,
    score: oracleScore(profile, profileRows, answers),
  }));
  const selected = qa.selectAdaptivePair();
  assert.deepEqual({ left: selected?.left, right: selected?.right }, oracleAdaptivePair(ranked, ["A", "B", "C", "D"], answers));
  assert.deepEqual({ left: selected?.left, right: selected?.right }, { left: "B", right: "C" });
});

test("prof-test recommendations exclude subject classifications awaiting review", () => {
  const qa = loadScoringFunctions();
  const results = qa.configureCurriculum({
    categoryCodes: ["A"],
    programRows: [{ external_key: "program:p", code: "P" }],
    planRows: [{ external_key: "plan:p", program_key: "program:p", profile_link_status: "verified", status: "parsed" }],
    curriculumRows: [
      {
        program_key: "program:p",
        hours: 100,
        subject_classification: { category_code: "A", category_name: "A", review_status: "needs_review" },
      },
      {
        program_key: "program:p",
        hours: 40,
        subject_classification: { category_code: "A", category_name: "A", review_status: "classified" },
      },
    ],
  });

  assert.deepEqual(JSON.parse(JSON.stringify(results)), [{
    code: "P",
    totalHours: 140,
    classifiedHours: 40,
    categoryShares: { A: 1 },
  }]);
});
