import { describe, expect, it } from "vitest";
import type { AdmissionCampaignResult, AdmissionSummary } from "@/features/catalog/admission-model";
import { ENROLLMENT_ROWS, SCORE_ROWS, enrollmentCell, scoreCell } from "@/features/catalog/admission-table-model";

function result(overrides: Partial<AdmissionCampaignResult> = {}): AdmissionCampaignResult {
  return {
    year: 2026, funding: "budget", competitionType: "general", status: "numeric",
    score: 280, admittedCount: null, stage: "main", snapshotDate: null,
    scopeType: "direction", scopeLabel: "27.03.05", scopeNote: "по направлению 27.03.05",
    sourceUrl: "https://bmstu.ru/order", ...overrides,
  };
}

function summary(overrides: Partial<AdmissionSummary> = {}): AdmissionSummary {
  return {
    year: 2026, directionCode: "27.03.05", seats: [], seatScope: "направление", seatNote: null,
    relatedSeatFacts: [], quotas: [], directionQuotas: [], quotaNote: null, historyScope: "направление",
    history: [], historicalResults: [], campaignResults: [], requirements: [], requirementsNote: null,
    offers: [], tuition: [], dates: [], ...overrides,
  };
}

describe("admission score table", () => {
  it("separates direction budget and paid enrollment and shows quotas as part of the budget", () => {
    const data = summary({ campaignResults: [
      result({ admittedCount: 12 }),
      result({ admittedCount: 3, competitionType: "bvi", status: "bvi", stage: "first", score: null }),
      result({ admittedCount: 7, competitionType: "special_quota", stage: "first" }),
      result({ admittedCount: 7, competitionType: "special_quota", status: "bvi", stage: "first", score: null }),
      result({ admittedCount: 5, funding: "paid" }),
      result({ admittedCount: 999, scopeType: "program", scopeNote: "по программе" }),
    ] });
    expect(enrollmentCell(data, 2026, ENROLLMENT_ROWS[0])).toMatchObject({ value: "22", note: "Всё направление подготовки 27.03.05 · все профили" });
    expect(enrollmentCell(data, 2026, ENROLLMENT_ROWS[1]).value).toBe("5");
    expect(enrollmentCell(data, 2026, ENROLLMENT_ROWS[3]).value).toBe("7");
    expect(enrollmentCell(data, 2026, ENROLLMENT_ROWS[2]).value).toBe("Не опубликовано");
    expect(enrollmentCell(summary({ campaignResults: [result({ admittedCount: 8, scopeType: "program" })] }), 2026, ENROLLMENT_ROWS[0]).value).toBe("Не опубликовано");
  });

  it("totals enrollment across funding and quotas without multiplying shared BVI/numeric counts", () => {
    const data = summary({ campaignResults: [
      result({ admittedCount: 12 }),
      result({ admittedCount: 3, competitionType: "bvi", status: "bvi", stage: "first", score: null }),
      result({ admittedCount: 7, competitionType: "special_quota", stage: "first" }),
      result({ admittedCount: 7, competitionType: "special_quota", status: "bvi", stage: "first", score: null }),
      result({ admittedCount: 5, funding: "paid" }),
      result({ admittedCount: 500, year: 2025 }),
    ] });
    expect(enrollmentCell(data, 2026).value).toBe("27");
    expect(enrollmentCell(data, 2026).note).toBe("по направлению 27.03.05");
  });

  it("does not sum a profile count with direction totals, and preserves zero", () => {
    const data = summary({ campaignResults: [result({ admittedCount: 100 }), result({ admittedCount: 0, scopeType: "program", scopeNote: "по программе" })] });
    expect(enrollmentCell(data, 2026)).toMatchObject({ value: "0", note: "по программе" });
    expect(enrollmentCell(summary(), 2026).value).toBe("Не опубликовано");
  });

  it("uses the latest count per competition and rejects contradictory or incomplete groups", () => {
    const initial = result({ admittedCount: 20, snapshotDate: "2026-08-10" });
    const latest = result({ admittedCount: 18, snapshotDate: "2026-08-11" });
    expect(enrollmentCell(summary({ campaignResults: [initial, latest] }), 2026).value).toBe("18");
    expect(enrollmentCell(summary({ campaignResults: [latest, { ...latest, admittedCount: 19 }] }), 2026).value).toBe("Не опубликовано");
    expect(enrollmentCell(summary({ campaignResults: [latest, result({ funding: "paid", admittedCount: null })] }), 2026).value).toBe("Не опубликовано");
  });

  it("uses only official scores and never substitutes numeric or BVI order results", () => {
    const data = summary({ campaignResults: [result({ score: 193 }), result({ status: "bvi", score: null })], officialPassingScores: [
      { year: 2026, funding: "budget", score: null, sourceUrl: "https://api.www.bmstu.ru/majors/card", scopeNote: "Всё направление" },
      { year: 2026, funding: "paid", score: 259, sourceUrl: "https://api.www.bmstu.ru/majors/card", scopeNote: "Всё направление" },
    ] });
    expect(scoreCell(data, 2026, SCORE_ROWS[0])).toMatchObject({ value: "Не опубликован", kind: "unavailable" });
    expect(scoreCell(data, 2026, SCORE_ROWS[1])).toMatchObject({ value: "259 баллов", kind: "score" });
    expect(SCORE_ROWS.map((row) => row.key)).toEqual(["budget", "paid"]);
  });

  it("keeps exact years and funding independent and preserves a published numeric zero", () => {
    const data = summary({ officialPassingScores: [
      { year: 2025, funding: "paid", score: 254, sourceUrl: "https://api.www.bmstu.ru/majors/card", scopeNote: "Всё направление" },
      { year: 2026, funding: "budget", score: 0, sourceUrl: "https://api.www.bmstu.ru/majors/card", scopeNote: "Всё направление" },
    ] });
    expect(scoreCell(data, 2026, SCORE_ROWS[0]).value).toBe("0 баллов");
    expect(scoreCell(data, 2026, SCORE_ROWS[1]).value).toBe("Не опубликован");
    expect(scoreCell(data, 2025, SCORE_ROWS[1]).value).toBe("254 баллов");
  });

  it("does not infer a score or BVI from zero seats or missing official data", () => {
    const data = summary({ seats: [{ label: "Бюджет", value: "0 мест", numericValue: 0, note: null, sourceUrl: null }], campaignResults: [result()] });
    expect(scoreCell(data, 2026, SCORE_ROWS[0]).kind).toBe("unavailable");
    expect(scoreCell(undefined, 2026, SCORE_ROWS[0]).value).toBe("Не удалось загрузить");
  });

  it("rejects conflicting official values instead of selecting a minimum", () => {
    const source = { year: 2026, funding: "paid" as const, score: 259, sourceUrl: "https://api.www.bmstu.ru/majors/card", scopeNote: "Всё направление" };
    const data = summary({ officialPassingScores: [source, { ...source, score: 193 }] });
    expect(scoreCell(data, 2026, SCORE_ROWS[1]).kind).toBe("unavailable");
  });
});
