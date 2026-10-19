import { describe, expect, it } from "vitest";
import type { AdmissionCampaignResult, AdmissionSummary } from "@/features/catalog/admission-model";
import { SCORE_ROWS, enrollmentCell, scoreCell } from "@/features/catalog/admission-table-model";

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

  it("uses the EGE result when the same scope also has BVI, without an extra BVI row or count", () => {
    const value = scoreCell(summary({ campaignResults: [result(), result({ status: "bvi", competitionType: "bvi", stage: "first", score: null, admittedCount: 30 })] }), 2026, SCORE_ROWS[0]);
    expect(value.value).toBe("280 баллов");
    expect(value.note).not.toContain("БВИ");
    expect(SCORE_ROWS.map((row) => row.key)).toEqual(["budget", "paid", "targeted", "special", "separate"]);
  });

  it("marks BVI evidence without claiming every budget student was admitted without exams", () => {
    const value = scoreCell(summary({ campaignResults: [result({ competitionType: "bvi", status: "bvi", stage: "first", score: null })] }), 2026, SCORE_ROWS[0]);
    expect(value.value).toBe("БВИ");
    expect(value.note).toContain("Числовой проходной не опубликован");
  });

  it("does not replace a program BVI result with a broader numeric result", () => {
    const value = scoreCell(summary({ campaignResults: [result(), result({ status: "bvi", competitionType: "bvi", scopeType: "program", score: null })] }), 2026, SCORE_ROWS[0]);
    expect(value.kind).toBe("bvi");
  });

  it("keeps years, funding and quotas independent, including a real numeric zero", () => {
    const data = summary({ campaignResults: [result()], historicalResults: [
      result({ year: 2025, funding: "paid", score: 189 }),
      result({ year: 2025, competitionType: "targeted", score: 0 }),
    ] });
    expect(scoreCell(data, 2025, SCORE_ROWS[0]).value).toBe("Не опубликован");
    expect(scoreCell(data, 2025, SCORE_ROWS[1]).value).toBe("189 баллов");
    expect(scoreCell(data, 2025, SCORE_ROWS[2]).value).toBe("0 баллов");
    expect(scoreCell(data, 2025, SCORE_ROWS[3]).value).toBe("Не опубликован");
  });

  it("does not reuse current zero capacity for a historical year or contradict actual enrollment", () => {
    const data = summary({ seats: [{ label: "Бюджет", value: "0 мест", numericValue: 0, note: null, sourceUrl: null }] });
    expect(scoreCell(data, 2026, SCORE_ROWS[0]).kind).toBe("no-places");
    expect(scoreCell(data, 2025, SCORE_ROWS[0]).kind).toBe("unavailable");
    expect(scoreCell({ ...data, campaignResults: [result({ status: "count_only", stage: "first", score: null, admittedCount: 10 })] }, 2026, SCORE_ROWS[0]).kind).toBe("unavailable");
  });
});
