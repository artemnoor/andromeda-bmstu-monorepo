import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(appRoot, "app.js"), "utf8");

function loadAndromeda(academicData) {
  const window = { AcademicData: academicData, location: { href: "http://andromeda.test/" } };
  vm.runInNewContext(source, { window, document: {} }, { filename: "app.js" });
  return window.Andromeda;
}

test("live program department mapping uses only verified relationships", async () => {
  const academicData = {
    isDemoMode: () => false,
    async programs() {
      return [{
        external_key: "program:one",
        code: "01.03.02-01",
        name: "Program One",
        direction_key: "direction:one",
        department_relations: [{ department_key: "department:unverified", verification_status: "manual_review" }],
      }];
    },
    async list(route) {
      if (route === "/v1/directions") return [{ external_key: "direction:one", code: "01.03.02", name: "Direction One" }];
      if (route === "/v1/departments") return [{ external_key: "department:unverified", official_code: "ИУ99", name: "Unconfirmed Department" }];
      throw new Error(`Unexpected API route ${route}`);
    },
  };

  const result = await loadAndromeda(academicData).loadPrograms();
  assert.equal(result.data[0].direction_code, "01.03.02");
  assert.equal(result.data[0].department_code, "");
  assert.equal(result.data[0].department, "");
  assert.equal(result.data[0].department_status, "unresolved");
});

test("live curriculum loader does not fetch parsed plans without a verified program link", async () => {
  const calls = [];
  const requestedProgramKeys = [];
  const academicData = {
    isDemoMode: () => false,
    async list(route, params = {}) {
      calls.push(route);
      if (route === "/v1/study-plans") {
        requestedProgramKeys.push(params.program_key);
        return [
          {
            external_key: "plan:review",
            program_key: "program:one",
            profile_link_status: "manual_review",
            status: "parsed",
            item_count: 1,
          },
        ];
      }
      if (route.startsWith("/v1/study-plans/")) return [{ external_key: "item:wrong", discipline_name: "Wrongly linked course" }];
      throw new Error(`Unexpected API route ${route}`);
    },
  };

  const result = await loadAndromeda(academicData).loadCurriculumForPrograms(["program:one"]);
  assert.equal(result.data.length, 0);
  assert.equal(result.failedPlans, 1);
  assert.deepEqual(calls, ["/v1/study-plans"]);
  assert.deepEqual(requestedProgramKeys, ["program:one"]);
});

test("comparison selects one uniquely latest verified study plan per program", async () => {
  const requestedPlanItems = [];
  const plans = [
    { external_key: "plan:older", program_key: "program:one", academic_year: "2023-2024", status: "parsed", profile_link_status: "verified", item_count: 1 },
    { external_key: "plan:current", program_key: "program:one", academic_year: "2025-2026", status: "parsed", profile_link_status: "verified", item_count: 1 },
  ];
  const academicData = {
    isDemoMode: () => false,
    async list(route, params = {}) {
      if (route === "/v1/study-plans") return plans.filter((plan) => plan.program_key === params.program_key);
      if (route.startsWith("/v1/study-plans/")) {
        const key = decodeURIComponent(route.split("/").at(-2));
        requestedPlanItems.push(key);
        return [{ external_key: `item:${key}`, discipline_name: key, total_hours: 10 }];
      }
      throw new Error(`Unexpected API route ${route}`);
    },
  };

  const result = await loadAndromeda(academicData).loadCurriculumForPrograms(["program:one"]);

  assert.deepEqual(requestedPlanItems, ["plan:current"]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data.map((row) => row.curriculum_key))), ["plan:current"]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.selectedPlanKeys)), ["plan:current"]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.ambiguousProgramKeys)), []);
});

test("comparison refuses to merge equal-year verified curriculum versions", async () => {
  const requestedPlanItems = [];
  const academicData = {
    isDemoMode: () => false,
    async list(route, params = {}) {
      if (route === "/v1/study-plans") return [
        { external_key: "plan:a", program_key: params.program_key, academic_year: "2025-2026", status: "parsed", profile_link_status: "verified", item_count: 1 },
        { external_key: "plan:b", program_key: params.program_key, academic_year: "2025-2026", status: "parsed", profile_link_status: "verified", item_count: 1 },
      ];
      if (route.startsWith("/v1/study-plans/")) requestedPlanItems.push(route);
      else throw new Error(`Unexpected API route ${route}`);
      return [];
    },
  };

  const result = await loadAndromeda(academicData).loadCurriculumForPrograms(["program:one"]);

  assert.deepEqual(requestedPlanItems, []);
  assert.equal(result.data.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(result.ambiguousProgramKeys)), ["program:one"]);
});

test("comparison does not fall back to an older verified plan when a newer version needs review", async () => {
  const requestedPlanItems = [];
  const academicData = {
    isDemoMode: () => false,
    async list(route, params = {}) {
      if (route === "/v1/study-plans") return [
        { external_key: "plan:older", program_key: params.program_key, academic_year: "2023-2024", status: "parsed", profile_link_status: "verified", item_count: 1 },
        { external_key: "plan:current", program_key: params.program_key, academic_year: "2025-2026", status: "unverified", profile_link_status: "manual_review", item_count: 1 },
      ];
      if (route.startsWith("/v1/study-plans/")) requestedPlanItems.push(route);
      else throw new Error(`Unexpected API route ${route}`);
      return [{ external_key: "item:old", discipline_name: "Historical curriculum" }];
    },
  };

  const result = await loadAndromeda(academicData).loadCurriculumForPrograms(["program:one"]);

  assert.deepEqual(requestedPlanItems, []);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(result.selectedPlanKeys)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(result.currentPlanKeys)), ["plan:current"]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.needsReviewProgramKeys)), ["program:one"]);
});

test("comparison admission loader scopes large facts to selected program directions", async () => {
  const calls = [];
  const academicData = {
    isDemoMode: () => false,
    async list(route, params = {}) {
      calls.push({ route, params });
      if (route === "/v1/campaigns") {
        return [{ external_key: "campaign:2026", year: 2026, campaign_kind: "admission" }];
      }
      if (route === "/v1/campaigns/campaign%3A2026/offerings") return [];
      if (route === "/v1/requirements") return [];
      if (route === "/v1/competition-pools") {
        return [{ external_key: "pool:one", direction_code: params.direction_code, funding_type: "budget", quota_type: "general_competition", places: 12 }];
      }
      if (route === "/api/v1/statistics" && params.kind === "historical") {
        return [{ external_key: `history:${params.direction_code}`, direction_code: params.direction_code, year: 2025, funding_type: "paid", minimum_score: 170 }];
      }
      if (route === "/api/v1/statistics" && params.kind === "admission") {
        return [{ external_key: `result:${params.direction_code}`, direction_code: params.direction_code, year: 2026, funding_type: "budget", competition_type: "general", status: "numeric", score: 240 }];
      }
      throw new Error(`Unexpected API route ${route}`);
    },
  };

  const result = await loadAndromeda(academicData).loadAdmissionForPrograms([
    { external_key: "program:one", direction_code: "09.03.01" },
    { external_key: "program:two", direction_code: "09.03.01" },
  ]);

  assert.equal(result.source, "api");
  assert.equal(result.data.pools.length, 1);
  assert.equal(result.data.pools[0].places, 12);
  assert.equal(result.data.history.length, 1);
  assert.equal(result.data.campaign_statistics[0].score, 240);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.filter((call) => call.route === "/v1/competition-pools").map((call) => call.params))), [
    { campaign_key: "campaign:2026", direction_code: "09.03.01" },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.filter((call) => call.route === "/api/v1/statistics").map((call) => call.params))), [
    { kind: "historical", direction_code: "09.03.01" },
    { kind: "admission", year: 2026, direction_code: "09.03.01" },
  ]);
  assert.equal(calls.some((call) => call.route === "/v1/tuition" || call.route.endsWith("/calendar")), false);
});

test("catalog admission loader omits campaign statistics when only card facts are needed", async () => {
  const calls = [];
  const academicData = {
    isDemoMode: () => false,
    async list(route, params = {}) {
      calls.push({ route, params });
      if (route === "/v1/campaigns") return [{ external_key: "campaign:2026", year: 2026, campaign_kind: "admission" }];
      if (route.endsWith("/offerings") || route === "/v1/requirements") return [];
      if (route === "/v1/competition-pools" || route === "/api/v1/statistics") return [];
      throw new Error(`Unexpected API route ${route}`);
    },
  };

  const result = await loadAndromeda(academicData).loadAdmissionForPrograms(
    [{ external_key: "program:one", direction_code: "09.03.01" }],
    { includeCampaignStatistics: false },
  );

  assert.equal(result.data.campaign_statistics.length, 0);
  assert.equal(calls.some((call) => call.route === "/api/v1/statistics" && call.params.kind === "admission"), false);
});

test("profile achievements loader requests only the campaign and achievement facts", async () => {
  const calls = [];
  const academicData = {
    isDemoMode: () => false,
    async list(route, params = {}) {
      calls.push({ route, params });
      if (route === "/v1/campaigns") return [{ external_key: "campaign:2026", year: 2026, campaign_kind: "admission" }];
      if (route === "/v1/individual-achievements") return [{
        external_key: "achievement:olympiad",
        name: "Олимпиада",
        points: 10,
        description: "Победа в заключительном этапе",
        required_document: "Диплом",
        sources: [{ source_url: "https://example.test/olympiad" }],
      }];
      throw new Error(`Unexpected API route ${route}`);
    },
  };

  const result = await loadAndromeda(academicData).loadAdmissionAchievements();

  assert.equal(result.source, "api");
  assert.equal(result.data[0].achievement_name, "Олимпиада");
  assert.equal(result.data[0].description, "Победа в заключительном этапе");
  assert.equal(result.data[0].additional_points, 10);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.map((call) => call.route))), ["/v1/campaigns", "/v1/individual-achievements"]);
  assert.equal(calls[1].params.campaign_key, "campaign:2026");
});

test("direction admission loader keeps page details while scoping pools, tuition, and statistics", async () => {
  const calls = [];
  const academicData = {
    isDemoMode: () => false,
    async list(route, params = {}) {
      calls.push({ route, params });
      if (route === "/v1/campaigns") return [{ external_key: "campaign:2026", year: 2026, campaign_kind: "admission" }];
      if (route.endsWith("/calendar")) return [{ external_key: "date:one", label: "Подача документов", date_value: "2026-06-20" }];
      if (route.endsWith("/offerings") || route === "/v1/requirements") return [];
      if (route === "/v1/individual-achievements") return [{ external_key: "achievement:one", name: "Олимпиада", points: 10 }];
      if (route === "/v1/competition-pools") return [{ external_key: "pool:one", direction_code: params.direction_code, places: 14 }];
      if (route === "/v1/tuition") return [{ external_key: "tuition:one", direction_code: params.direction_code, amount: 250000, currency: "RUB" }];
      if (route === "/api/v1/statistics") return [];
      throw new Error(`Unexpected API route ${route}`);
    },
  };

  const result = await loadAndromeda(academicData).loadAdmissionForDirection("09.03.01");

  assert.equal(result.source, "api");
  assert.equal(result.data.dates[0].date, "2026-06-20");
  assert.equal(result.data.achievements[0].achievement_name, "Олимпиада");
  assert.equal(result.data.pools[0].places, 14);
  assert.equal(result.data.tuition[0].annual_amount_rub, 250000);
  assert.equal(calls.filter((call) => call.route === "/v1/competition-pools")[0].params.direction_code, "09.03.01");
  assert.equal(calls.filter((call) => call.route === "/v1/tuition")[0].params.direction_code, "09.03.01");
  assert.equal(calls.filter((call) => call.route === "/api/v1/statistics").every((call) => call.params.direction_code === "09.03.01"), true);
});

test("subject categories with review_status=needs_review are not reported as confirmed", () => {
  const api = loadAndromeda({ isDemoMode: () => false });
  assert.equal(api.getSubjectClassification({
    subject_classification: {
      taxonomy_key: "bmstu-subject-domain-16",
      taxonomy_version: "v1",
      category_code: "03",
      category_name: "Computer Science",
      review_status: "needs_review",
    },
  }), null);
  assert.deepEqual(
    { ...api.getSubjectClassification({
      subject_classification: {
        category_code: "03",
        category_name: "Computer Science",
        review_status: "classified",
      },
    }) },
    { name: "Computer Science", code: "03" },
  );
  assert.deepEqual(
    { ...api.getSubjectClassification({ subject_classification: { category_code: "03", category_name: "Demo category" } }) },
    { name: "Demo category", code: "03" },
  );
});
