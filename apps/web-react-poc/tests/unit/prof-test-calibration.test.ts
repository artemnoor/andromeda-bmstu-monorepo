import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { CatalogProgram } from "@/features/catalog/model";
import type { SubjectTaxonomyDto, StudyPlanDto } from "@/shared/api/client";
import {
  buildProgramProfilesFromSnapshot,
  emptyAnswers,
  rankPrograms,
  NO_ACTIVITY,
  selectAdaptivePair,
  shouldFinishAfterComparison,
  type CareerTestAnswers,
  type CareerTestProfileSnapshotRecord,
} from "@/features/prof-test/model";
import { matchesProgramSearch } from "@/features/prof-test/presentation";

interface ProfileSnapshotFile {
  readonly release: { readonly release_key: string };
  readonly taxonomy: { readonly taxonomy_key: string; readonly taxonomy_version: string };
  readonly total_curriculum_rows: number;
  readonly assigned_rows: number;
  readonly classified_rows: number;
  readonly review_rows: number;
  readonly profiles: readonly CareerTestProfileSnapshotRecord[];
}

const snapshot = JSON.parse(readFileSync(
  resolve(process.cwd(), "public/data/prof-test-profile-snapshot.json"),
  "utf8",
)) as ProfileSnapshotFile;

function programForProfile(profile: CareerTestProfileSnapshotRecord): CatalogProgram {
  const code = profile.program_key
    .match(/:(\d{2}\.\d{2}\.\d{2}(?:[-/][^:]+)?):source:/)?.[1]
    ?.replace(/\([^)]*\)$/, "");
  if (!code) throw new Error(`Cannot extract the exact program code from ${profile.program_key}.`);
  return { external_key: profile.program_key, code } as CatalogProgram;
}

const programRecords = snapshot.profiles.map(programForProfile);
const planRecords = snapshot.profiles.map((profile) => ({
  external_key: profile.plan_key,
  program_key: profile.program_key,
  academic_year: "2026",
  status: "parsed",
  profile_link_status: "verified",
  item_count: profile.plan_item_count,
}) as StudyPlanDto);
const categoryCodes = [...new Set(snapshot.profiles.flatMap((profile) => Object.keys(profile.category_hours)))].sort();
const taxonomy = {
  taxonomy_key: snapshot.taxonomy.taxonomy_key,
  taxonomy_version: snapshot.taxonomy.taxonomy_version,
  categories: categoryCodes.map((category_code, index) => ({
    category_code,
    name: category_code,
    definition: "",
    ordinal: index + 1,
  })),
} as SubjectTaxonomyDto;
const profiles = buildProgramProfilesFromSnapshot({
  programs: programRecords,
  plans: planRecords,
  taxonomy,
  snapshots: snapshot.profiles,
}).profiles;

describe("live academic snapshot relevance calibration", () => {
  const categories = categoryCodes.map((code, ordinal) => ({ code, name: code, definition: "", ordinal }));
  function completedAnswers(interest: string): CareerTestAnswers {
    let answers: CareerTestAnswers = { ...emptyAnswers(), interests: [interest], activity: NO_ACTIVITY };
    for (let index = 0; index < 4; index += 1) {
      const pair = selectAdaptivePair(profiles, categories, answers);
      if (!pair) break;
      const finish = shouldFinishAfterComparison(profiles, answers, pair, 0);
      answers = { ...answers, comparisons: [...answers.comparisons, { left: pair.left, right: pair.right, value: 0 }] };
      if (finish) break;
    }
    return answers;
  }

  it.each([
    ["03", /^09\.03\.04/],
    ["06", /^10\.05\.03/],
    ["12", /^54\.03\.01/],
    ["13", /^38\.03/],
  ])("returns relevant directions for completed category %s journeys", (code, expectedDirection) => {
    const result = rankPrograms(profiles, completedAnswers(code));
    expect(result[0]?.profile.program.code).toMatch(expectedDirection);
    expect(result[0]?.score).toBeGreaterThan(0);
  });

  it("preserves every verified program in every single-interest journey and supports exact-code discovery", () => {
    const expectedKeys = profiles.map(({ program }) => program.external_key).sort();
    for (const categoryCode of categoryCodes) {
      const results = rankPrograms(profiles, completedAnswers(categoryCode));
      expect(results.map(({ profile }) => profile.program.external_key).sort()).toEqual(expectedKeys);
      for (const { profile } of results) {
        expect(matchesProgramSearch(profile.program, profile.program.code)).toBe(true);
      }
    }
  });

  it("accounts for every PDF row while keeping general and additional subjects outside recommendation weights", () => {
    expect(snapshot.total_curriculum_rows).toBe(snapshot.profiles.reduce((sum, profile) => sum + profile.plan_item_count, 0));
    const excludedRows = snapshot.profiles.reduce((sum, profile) => sum + (profile.excluded_rows ?? 0), 0);
    expect(excludedRows).toBeGreaterThan(0);
    expect(snapshot.assigned_rows + excludedRows).toBe(snapshot.total_curriculum_rows);
    expect(snapshot.classified_rows + snapshot.review_rows).toBe(snapshot.assigned_rows);
    for (const profile of snapshot.profiles) {
      expect(profile.assigned_rows + (profile.excluded_rows ?? 0)).toBe(profile.plan_item_count);
      expect(profile.classified_rows + profile.review_rows).toBe(profile.assigned_rows);
      expect(Object.values(profile.category_hours).reduce((sum, hours) => sum + hours, 0)).toBe(profile.assigned_hours);
    }
    expect(profiles).toHaveLength(snapshot.profiles.length);
    const recovered = snapshot.profiles.find((profile) => profile.program_key === "program:bmstu:01.03.04:ФН2:01.03.04-05:source:2-1");
    expect(recovered?.assigned_rows).toBeGreaterThan(0);
    expect(profiles.some(({ program }) => program.external_key === "program:bmstu:09.03.03:СГН3:09.03.03/01:source:1-1")).toBe(false);
  });

  it("ranks IBM programs for matching technology and business interests", () => {
    const business = rankPrograms(profiles, { ...emptyAnswers(), interests: ["13"] })
      .slice(0, 10)
      .map(({ profile }) => profile.program.external_key);
    const informationSystems = rankPrograms(profiles, { ...emptyAnswers(), interests: ["05"] })
      .slice(0, 3)
      .map(({ profile }) => profile.program.external_key);

    expect(business).toContain("program:bmstu:38.03.02:ИБМ4:38.03.02/04:source:1-1");
    expect(business).toContain("program:bmstu:38.03.05:ИБМ3:38.03.05/02:source:1-1");
    expect(informationSystems.every(key => key.startsWith("program:bmstu:09."))).toBe(true);
  });

  it("does not invent a verified plan profile for an IBM3 program whose plan is unavailable", () => {
    expect(profiles.some(({ program }) => program.external_key === "program:bmstu:27.03.05:ИБМ3:27.03.05/03:source:2-1")).toBe(false);
  });

  it("keeps IBM3 recommendation signals visible for their actual plan mix", () => {
    const matches = rankPrograms(profiles, { ...emptyAnswers(), interests: ["05"] });
    const key = "program:bmstu:09.03.03:ИБМ3:09.03.03/10:source:1-1";
    const source = snapshot.profiles.find(profile => profile.program_key === key)!;
    const maximumShare = Math.max(...snapshot.profiles.map(profile => (profile.category_hours["05"] ?? 0) / profile.assigned_hours));
    const expectedScore = 100 * (source.category_hours["05"] ?? 0) / source.assigned_hours / maximumShare;
    expect(expectedScore).toBeGreaterThan(0);
    expect(matches.find(({ profile }) => profile.program.external_key === key)?.score).toBeCloseTo(expectedScore);
  });
});
