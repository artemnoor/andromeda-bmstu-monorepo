import { describe, expect, it } from "vitest";
import type { AdmissionCampaignResult, AdmissionSummary } from "@/features/catalog/admission-model";
import { SCORE_ROWS, scoreCell } from "@/features/catalog/admission-table-model";

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
