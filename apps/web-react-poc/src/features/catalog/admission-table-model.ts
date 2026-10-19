import type { AdmissionCampaignResult, AdmissionSummary } from "./admission-model";

export const SCORE_ROWS = [
  { key: "budget", label: "Бюджет · общий конкурс", funding: "budget", competition: "general" },
  { key: "paid", label: "Платное обучение", funding: "paid", competition: "general" },
  { key: "targeted", label: "Целевая квота", funding: "budget", competition: "targeted" },
  { key: "special", label: "Особая квота", funding: "budget", competition: "special_quota" },
  { key: "separate", label: "Отдельная квота", funding: "budget", competition: "separate_quota" },
] as const;

type ScoreRow = typeof SCORE_ROWS[number];
export interface ScoreCell {
  readonly value: string;
  readonly note: string | null;
  readonly sourceUrl: string | null;
  readonly kind: "score" | "bvi" | "unavailable" | "no-places";
}

function specificity(result: AdmissionCampaignResult): number {
  return result.scopeType === "program" ? 2 : result.scopeType === "department" ? 1 : 0;
}

export function scoreCell(summary: AdmissionSummary | undefined, year: number, row: ScoreRow): ScoreCell {
  if (!summary) return { value: "Не удалось загрузить", note: null, sourceUrl: null, kind: "unavailable" };
  const current = summary.year === year;
  const records = (current ? summary.campaignResults : summary.historicalResults).filter((result) => (
    result.year === year && result.funding === row.funding
    && (result.competitionType === row.competition
      || (row.competition === "general" && row.funding === "budget" && result.competitionType === "bvi"))
  ));
  const usable = records.filter((result) => (result.status === "bvi"
    || (result.status === "numeric" && result.score !== null))
    && (row.competition !== "general" || !current || result.stage === "main" || result.status === "bvi"));
  const bestScope = Math.max(-1, ...usable.map(specificity));
  const scoped = usable.filter((result) => specificity(result) === bestScope);
  // A numeric result wins over BVI only within the same verified scope.
  const numeric = scoped.filter((result) => result.status === "numeric")
    .sort((a, b) => Number(b.stage === "main") - Number(a.stage === "main")
      || (b.snapshotDate ?? "").localeCompare(a.snapshotDate ?? ""));
  const selected = numeric[0] ?? scoped.find((result) => result.status === "bvi");
  if (selected) return {
    value: selected.status === "bvi" ? "БВИ" : `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(selected.score!)} баллов`,
    note: selected.status === "bvi"
      ? `${selected.scopeNote}. Числовой проходной не опубликован.`
      : selected.scopeNote,
    sourceUrl: selected.sourceUrl,
    kind: selected.status === "bvi" ? "bvi" : "score",
  };
  // A current plan cannot establish capacity in a different admission year.
  const seats = summary.seats[row.funding === "budget" ? 0 : 1];
  if (current && row.competition === "general" && seats?.numericValue === 0
    && !records.some((result) => (result.admittedCount ?? 0) > 0)) {
    return { value: "Нет мест", note: `Общий конкурс · план ${year}`, sourceUrl: seats.sourceUrl, kind: "no-places" };
  }
  return { value: "Не опубликован", note: null, sourceUrl: null, kind: "unavailable" };
}
