import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pages = (await readdir(appRoot)).filter((name) => name.endsWith(".html")).sort();

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

async function exists(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function loadAcademicDataClient({ query = "", initialLocal = {}, fetchImpl = async () => { throw new Error("Unexpected request"); } } = {}) {
  const source = await readFile(path.join(appRoot, "assets", "academic-data.js"), "utf8");
  const local = new Map(Object.entries(initialLocal));
  const session = new Map();
  const localStorage = {
    getItem: key => local.has(key) ? local.get(key) : null,
    setItem: (key, value) => local.set(key, String(value)),
    removeItem: key => local.delete(key),
  };
  const sessionStorage = {
    getItem: key => session.has(key) ? session.get(key) : null,
    setItem: (key, value) => session.set(key, String(value)),
  };
  const window = {
    location: { search: query, href: "http://localhost/profile.html" },
    dispatchEvent() {},
  };
  const context = vm.createContext({
    window,
    localStorage,
    sessionStorage,
    URL,
    URLSearchParams,
    CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    document: { readyState: "loading", addEventListener() {} },
    fetch: fetchImpl,
  });
  vm.runInContext(source, context, { filename: "academic-data.js" });
  return { api: window.AcademicData, state: window.AndromedaBrowserState, local };
}

const plain = value => JSON.parse(JSON.stringify(value));

test("the original nine HTML pages and their local references are present", async () => {
  assert.equal(pages.length, 9);
  for (const page of pages) {
    const content = await readFile(path.join(appRoot, page), "utf8");
    assert.match(content, /<title>[\s\S]+?<\/title>/i, page);
    for (const [, reference] of content.matchAll(/(?:src|href)=["']([^"']+)["']/gi)) {
      const localPath = reference.split(/[?#]/, 1)[0];
      if (!localPath || localPath.startsWith("/") || localPath.startsWith("#") || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(localPath)) continue;
      assert.equal(await exists(path.resolve(appRoot, localPath)), true, `${page} references missing ${localPath}`);
    }
  }
});

test("runtime JavaScript and inline page scripts parse without execution", async () => {
  const runtimeFiles = [
    path.join(appRoot, "app.js"),
    ...await filesUnder(path.join(appRoot, "assets")),
  ];
  for (const filePath of runtimeFiles.filter((name) => name.endsWith(".js"))) {
    new vm.Script(await readFile(filePath, "utf8"), { filename: filePath });
  }
  for (const page of pages) {
    const content = await readFile(path.join(appRoot, page), "utf8");
    for (const [, script] of content.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)) {
      new vm.Script(script, { filename: page });
    }
  }
});

test("live mode uses same-origin API and demo snapshots require explicit opt-in", async () => {
  const client = await readFile(path.join(appRoot, "assets", "academic-data.js"), "utf8");
  assert.match(client, /window\.ACADEMIC_DATA_API_BASE\s*\|\|\s*["']\/api\/v1["']/);
  assert.match(client, /query\.get\(["']data["']\)\s*===\s*["']demo["']/);
  assert.match(client, /ДЕМО-ДАННЫЕ/);
  assert.doesNotMatch(client, /d5dh12nf73n2fcovnq82\.4kscn31j\.apigw\.yandexcloud\.net/i);
});

test("all retained local JSON demo snapshots remain valid JSON", async () => {
  const dataFiles = (await filesUnder(path.join(appRoot, "data"))).filter((name) => name.endsWith(".json"));
  assert.equal(dataFiles.length, 5);
  for (const filePath of dataFiles) JSON.parse(await readFile(filePath, "utf8"));
});

test("workspace and standalone pages share canonical storage and reconcile legacy values", async () => {
  const app = await readFile(path.join(appRoot, "app.js"), "utf8");
  const workspace = await readFile(path.join(appRoot, "assets", "workspace.js"), "utf8");
  assert.match(app, /const browserState = window\.AndromedaBrowserState/);
  assert.match(app, /browserState\.readList/);
  assert.match(app, /AndromedaBrowserState\?\.readProfile/);
  assert.match(workspace, /AndromedaBrowserState\?\.readList/);
  assert.match(workspace, /AndromedaBrowserState\?\.readProfile/);
  assert.match(workspace, /andromeda\.applicant\.v1/);
  assert.match(workspace, /andromeda\.favorites\.v1/);
  assert.match(workspace, /andromeda\.compare\.v1/);
  assert.match(workspace, /achievementKeys: Array\.isArray\(value\.achievements\)/);
  assert.match(workspace, /achievements: state\.profile\.achievementKeys/);
  assert.match(workspace, /directionCode: typeof value\.targetDirection/);
  assert.match(workspace, /targetDirection: state\.profile\.directionCode/);

  const legacyOnly = await loadAcademicDataClient({ initialLocal: {
    "andromeda-applicant-profile-v1": JSON.stringify({
      scores: { mathematics: 88 },
      interests: ["systems"],
      achievementKeys: ["olympiad"],
      directionCode: "01.03.02",
    }),
    "andromeda-favorite-programs-v1": JSON.stringify(["program-a", "program-b"]),
    "andromeda-compare-programs-v1": JSON.stringify(["program-a", "program-b", "program-c", "program-d"]),
  } });
  assert.deepEqual(plain(legacyOnly.state.readProfile()), {
    scores: { mathematics: 88 },
    interests: ["systems"],
    achievements: ["olympiad"],
    targetDirection: "01.03.02",
    note: "",
  });
  assert.deepEqual(plain(legacyOnly.state.readList("favorites")), ["program-a", "program-b"]);
  assert.deepEqual(plain(legacyOnly.state.readList("compare")), ["program-a", "program-b", "program-c"]);
  assert.deepEqual(JSON.parse(legacyOnly.local.get("andromeda.compare.migration-overflow.v1")), ["program-d"]);
  assert.equal(legacyOnly.local.has("andromeda-applicant-profile-v1"), false);
  assert.equal(legacyOnly.local.has("andromeda-favorite-programs-v1"), false);
  assert.equal(legacyOnly.local.has("andromeda-compare-programs-v1"), false);
  assert.equal(legacyOnly.state.writeProfile({
    scores: { mathematics: 90 },
    interests: ["systems"],
    achievementKeys: ["medal"],
    directionCode: "11.03.04",
  }), true);
  assert.deepEqual(JSON.parse(legacyOnly.local.get("andromeda.applicant.v1")), {
    scores: { mathematics: 90 },
    interests: ["systems"],
    achievements: ["medal"],
    targetDirection: "11.03.04",
    note: "",
  });

  const both = await loadAcademicDataClient({ initialLocal: {
    "andromeda.applicant.v1": JSON.stringify({
      scores: { physics: 92 }, interests: ["robotics"], achievements: ["canonical-achievement"], targetDirection: "01.03.02",
    }),
    "andromeda-applicant-profile-v1": JSON.stringify({
      scores: { physics: 80, mathematics: 77 }, interests: ["materials"], achievementKeys: ["legacy-achievement"], directionCode: "02.03.02",
    }),
    "andromeda.favorites.v1": JSON.stringify(["program-a"]),
    "andromeda-favorite-programs-v1": JSON.stringify(["program-b"]),
    "andromeda.compare.v1": JSON.stringify(["program-a", "program-b"]),
    "andromeda-compare-programs-v1": JSON.stringify(["program-c", "program-d"]),
  } });
  assert.deepEqual(plain(both.state.readProfile()), {
    scores: { physics: 92, mathematics: 77 },
    interests: ["materials", "robotics"],
    achievements: ["legacy-achievement", "canonical-achievement"],
    targetDirection: "01.03.02",
    note: "",
  });
  assert.equal(both.local.has("andromeda-applicant-profile-v1"), true, "conflicting legacy profile values remain preserved");
  assert.equal(both.local.get("andromeda.applicant.migration.v1"), "true");
  assert.deepEqual(plain(both.state.readList("favorites")), ["program-a", "program-b"]);
  assert.deepEqual(plain(both.state.readList("compare")), ["program-a", "program-b", "program-c"]);
  assert.deepEqual(JSON.parse(both.local.get("andromeda.compare.migration-overflow.v1")), ["program-d"]);

  const preservedLegacyProfile = both.local.get("andromeda-applicant-profile-v1");
  assert.equal(both.state.writeProfile({
    scores: { physics: 92, mathematics: 77 },
    interests: ["robotics"],
    achievements: ["canonical-achievement"],
    targetDirection: "01.03.02",
  }), true);
  assert.deepEqual(plain(both.state.readProfile()), {
    scores: { physics: 92, mathematics: 77 },
    interests: ["robotics"],
    achievements: ["canonical-achievement"],
    targetDirection: "01.03.02",
    note: "",
  });
  assert.equal(both.local.get("andromeda-applicant-profile-v1"), preservedLegacyProfile, "the legacy copy remains intact for recovery");
  assert.equal(both.local.get("andromeda.applicant.migration.v1"), "true");

  assert.equal(both.state.clearProfile(), true);
  assert.equal(both.local.has("andromeda.applicant.v1"), false);
  assert.equal(both.local.has("andromeda-applicant-profile-v1"), false);
  assert.equal(both.local.has("andromeda.applicant.migration.v1"), false);
});

test("demo and current requirement trees normalize nested exam leaves", async () => {
  const admission = JSON.parse(await readFile(path.join(appRoot, "data", "admission.json"), "utf8"));
  const { api } = await loadAcademicDataClient({
    query: "?data=demo",
    fetchImpl: async () => ({ ok: true, json: async () => admission }),
  });
  const demoRules = await api.list("/v1/requirements", { campaign_key: "campaign:bmstu:2026:admission" });
  assert.equal(demoRules[0].root.kind, "operator");
  const subjects = [];
  const collectSubjects = rule => {
    if (rule.kind === "leaf") subjects.push(rule.subject_code);
    for (const child of rule.children || []) collectSubjects(child);
  };
  collectSubjects(demoRules[0].root);
  assert.deepEqual(subjects, ["russian_language", "mathematics", "physics", "informatics_and_ict"]);
  assert.equal(demoRules[0].root.children[2].threshold, 1);

  const currentRule = api.normalizeRequirementNode({
    kind: "operator",
    operator: "OR",
    threshold: 1,
    children: [
      { kind: "leaf", subject_code: "chemistry", minimum_score: 40 },
      { kind: "leaf", subject_code: "biology", minimum_score: 40 },
    ],
  });
  assert.equal(currentRule.children[0].kind, "leaf");
  assert.deepEqual(currentRule.children.map(rule => rule.subject_code), ["chemistry", "biology"]);
});
