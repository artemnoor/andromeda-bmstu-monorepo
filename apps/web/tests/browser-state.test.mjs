import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(appRoot, "assets", "academic-data.js"), "utf8");

function mapStorage(seed = new Map(), failures = {}) {
  return {
    getItem(key) {
      if (failures.get) throw new Error("storage read denied");
      return seed.has(key) ? seed.get(key) : null;
    },
    setItem(key, value) {
      if (failures.set) throw new Error("storage write denied");
      seed.set(key, String(value));
    },
    removeItem(key) {
      if (failures.remove) throw new Error("storage removal denied");
      seed.delete(key);
    },
  };
}

function seedMap(entries = {}) {
  return new Map(Object.entries(entries));
}

function loadBrowserState({ storage = seedMap(), failures = {} } = {}) {
  const session = new Map();
  const localStorage = mapStorage(storage, failures);
  const sessionStorage = mapStorage(session);
  const window = {
    location: { search: "", href: "http://localhost/profile.html" },
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
    fetch: async () => { throw new Error("Unexpected network request in storage test"); },
  });
  vm.runInContext(source, context, { filename: "academic-data.js" });
  return { state: window.AndromedaBrowserState, storage };
}

const plain = value => JSON.parse(JSON.stringify(value));

test("legacy favorites and comparison migrate once and persist across page contexts", () => {
  const storage = seedMap({
    "andromeda.favorites.v1": JSON.stringify(["program-a", "shared"]),
    "andromeda-favorite-programs-v1": JSON.stringify(["shared", "program-b"]),
    "andromeda.compare.v1": JSON.stringify(["program-a", "program-b"]),
    "andromeda-compare-programs-v1": JSON.stringify(["program-b", "program-c", "program-d", "program-e"]),
  });
  const firstPage = loadBrowserState({ storage });

  assert.deepEqual(plain(firstPage.state.readList("favorites")), ["program-a", "shared", "program-b"]);
  assert.deepEqual(plain(firstPage.state.readList("compare")), ["program-a", "program-b", "program-c"]);
  assert.deepEqual(JSON.parse(storage.get("andromeda.compare.migration-overflow.v1")), ["program-d", "program-e"]);
  assert.equal(storage.has("andromeda-favorite-programs-v1"), false);
  assert.equal(storage.has("andromeda-compare-programs-v1"), false);

  const secondPage = loadBrowserState({ storage });
  assert.deepEqual(plain(secondPage.state.readList("favorites")), ["program-a", "shared", "program-b"]);
  assert.deepEqual(plain(secondPage.state.readList("compare")), ["program-a", "program-b", "program-c"]);
  assert.deepEqual(plain(secondPage.state.writeList("favorites", ["program-z", "program-z", ""])), ["program-z"]);
  assert.deepEqual(plain(loadBrowserState({ storage }).state.readList("favorites")), ["program-z"]);
});

test("conflicting canonical and legacy profile data merges once, preserves recovery copy, and does not resurrect deletions", () => {
  const legacyProfile = JSON.stringify({
    scores: { mathematics: 80, physics: 75 },
    interests: ["legacy-interest", "shared-interest"],
    achievementKeys: ["legacy-award"],
    directionCode: "01.03.02",
    note: "legacy note",
  });
  const storage = seedMap({
    "andromeda.applicant.v1": JSON.stringify({
      scores: { mathematics: 92 },
      interests: ["canonical-interest", "shared-interest"],
      achievements: ["canonical-award"],
      targetDirection: "09.03.01",
      note: "canonical note",
    }),
    "andromeda-applicant-profile-v1": legacyProfile,
  });
  const firstPage = loadBrowserState({ storage });

  assert.deepEqual(plain(firstPage.state.readProfile()), {
    scores: { mathematics: 92, physics: 75 },
    interests: ["legacy-interest", "shared-interest", "canonical-interest"],
    achievements: ["legacy-award", "canonical-award"],
    targetDirection: "09.03.01",
    note: "canonical note",
  });
  assert.equal(storage.get("andromeda.applicant.migration.v1"), "true");
  assert.equal(storage.get("andromeda-applicant-profile-v1"), legacyProfile, "conflicting legacy values remain available for recovery");

  assert.equal(firstPage.state.writeProfile({
    scores: { mathematics: 92, physics: 75 },
    interests: ["canonical-interest"],
    achievements: ["canonical-award"],
    targetDirection: "09.03.01",
    note: "canonical note",
  }), true);

  const nextPage = loadBrowserState({ storage });
  assert.deepEqual(plain(nextPage.state.readProfile()), {
    scores: { mathematics: 92, physics: 75 },
    interests: ["canonical-interest"],
    achievements: ["canonical-award"],
    targetDirection: "09.03.01",
    note: "canonical note",
  });
  assert.equal(storage.get("andromeda-applicant-profile-v1"), legacyProfile);

  assert.equal(nextPage.state.clearProfile(), true);
  assert.equal(storage.has("andromeda.applicant.v1"), false);
  assert.equal(storage.has("andromeda-applicant-profile-v1"), false);
  assert.equal(storage.has("andromeda.applicant.migration.v1"), false);
  assert.deepEqual(plain(loadBrowserState({ storage }).state.readProfile()), {
    scores: {}, interests: [], achievements: [], targetDirection: "", note: "",
  });
});

test("storage failures are contained and failed migration does not erase legacy values", () => {
  const storage = seedMap({
    "andromeda-applicant-profile-v1": JSON.stringify({ scores: { mathematics: 88 }, interests: ["math"] }),
    "andromeda-favorite-programs-v1": JSON.stringify(["program-a"]),
  });
  const writeDenied = loadBrowserState({ storage, failures: { set: true } });

  assert.deepEqual(plain(writeDenied.state.readProfile()), {
    scores: { mathematics: 88 }, interests: ["math"], achievements: [], targetDirection: "", note: "",
  });
  assert.equal(writeDenied.state.writeProfile({ scores: { mathematics: 90 } }), false);
  assert.deepEqual(plain(writeDenied.state.readList("favorites")), ["program-a"]);
  assert.equal(storage.has("andromeda-applicant-profile-v1"), true);
  assert.equal(storage.has("andromeda-favorite-programs-v1"), true);

  const unavailable = loadBrowserState({ failures: { get: true, set: true, remove: true } });
  assert.doesNotThrow(() => unavailable.state.readProfile());
  assert.deepEqual(plain(unavailable.state.readProfile()), {
    scores: {}, interests: [], achievements: [], targetDirection: "", note: "",
  });
  assert.deepEqual(plain(unavailable.state.readList("favorites")), []);
  assert.deepEqual(plain(unavailable.state.readList("compare")), []);
  assert.equal(unavailable.state.writeProfile({ scores: { mathematics: 90 } }), false);
  assert.equal(unavailable.state.writeList("compare", ["program-a"]), null);
  assert.equal(unavailable.state.clearProfile(), false);
});
