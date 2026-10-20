import type { AdmissionCampaignResult, AdmissionSummary } from "./admission-model";

export const SCORE_ROWS = [
  { key: "budget", label: "Бюджет", funding: "budget", competition: "general" },
  { key: "paid", label: "Платное обучение", funding: "paid", competition: "general" },
] as const;

type ScoreRow = typeof SCORE_ROWS[number];
export const ENROLLMENT_ROWS = [
  { key: "budget", label: "Бюджет · всего", funding: "budget", competition: null },
  { key: "paid", label: "Платное обучение", funding: "paid", competition: null },
  { key: "targeted", label: "В том числе · целевая квота", funding: "budget", competition: "targeted" },
  { key: "special", label: "В том числе · особая квота", funding: "budget", competition: "special_quota" },
  { key: "separate", label: "В том числе · отдельная квота", funding: "budget", competition: "separate_quota" },
] as const;

export interface EnrollmentCell {
  readonly value: string;
  readonly note: string | null;
  readonly sourceUrls: readonly string[];
}

export function enrollmentCell(summary: AdmissionSummary | undefined, year: number, row?: typeof ENROLLMENT_ROWS[number]): EnrollmentCell {
  const unavailable = { value: summary ? "Не опубликовано" : "Не удалось загрузить", note: null, sourceUrls: [] };
  if (!summary) return unavailable;
  const records = (summary.year === year ? summary.campaignResults : summary.historicalResults).filter((result) => (
    result.year === year && (result.funding === "budget" || result.funding === "paid")
    && (!row || (result.funding === row.funding
      && (row.competition === null || result.competitionType === row.competition)
      && (!result.scopeType || result.scopeType === "direction")))
  ));
  const bestScope = Math.max(-1, ...records.map(specificity));
  const scoped = records.filter((result) => specificity(result) === bestScope);
  if (!scoped.length) return unavailable;
  const groups = new Map<string, AdmissionCampaignResult[]>();
  for (const result of scoped) {
    // Counts describe the whole competition group, including numeric and BVI
    // observations. Repeated score observations must never multiply enrollment.
    const key = `${result.funding}:${result.competitionType}:${result.stage ?? "unknown"}`;
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }
  let count = 0;
  const notes = new Set<string>();
  const sources = new Set<string>();
  for (const group of groups.values()) {
    const latestDate = group.map((result) => result.snapshotDate ?? "").sort().at(-1) ?? "";
    const latest = group.filter((result) => (result.snapshotDate ?? "") === latestDate);
    const counts = new Set(latest.flatMap((result) => result.admittedCount !== null
      && Number.isSafeInteger(result.admittedCount) && result.admittedCount >= 0 ? [result.admittedCount] : []));
    // Conflicting counts cannot be reconciled from aggregate API records.
    if (counts.size !== 1) return unavailable;
    count += [...counts][0]!;
    latest.forEach((result) => {
      if (result.scopeNote) notes.add(result.scopeNote);
      if (result.sourceUrl) sources.add(result.sourceUrl);
    });
  }
  return {
    value: new Intl.NumberFormat("ru-RU").format(count),
    note: row ? `Всё направление подготовки ${summary.directionCode ?? ""} · все профили` : [...notes].join("; ") || null,
    sourceUrls: [...sources],
  };
}

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
  const records = (summary.officialPassingScores ?? []).filter((result) => result.year === year && result.funding === row.funding);
  // Conflicting versions are a data error, not permission to choose a convenient minimum.
  const values = new Set(records.map((result) => `${result.score}:${result.sourceUrl}`));
  const selected = values.size === 1 ? records[0] : undefined;
  if (selected?.score !== null && selected?.score !== undefined) return {
    value: `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(selected.score)} баллов`,
    note: selected.scopeNote, sourceUrl: selected.sourceUrl, kind: "score",
  };
  return { value: "Не опубликован", note: "В официальной карточке нет числового значения за этот год.", sourceUrl: selected?.sourceUrl ?? null, kind: "unavailable" };
}
