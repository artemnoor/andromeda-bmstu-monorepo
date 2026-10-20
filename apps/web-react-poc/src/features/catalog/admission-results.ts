import type { AdmissionCampaignResult, AdmissionSummary } from "./admission-model";

export type AdmissionCompetition = "general" | "separate_quota" | "special_quota" | "targeted" | "bvi";

export const COMPETITION_LABELS: Readonly<Record<string, string>> = {
  general: "Общий конкурс", other: "Конкурс, указанный в источнике",
  separate_quota: "Отдельная квота", special_quota: "Особая квота",
  targeted: "Целевая квота", bvi: "БВИ — без вступительных испытаний",
};

export function admissionResultValue(result: AdmissionCampaignResult): string {
  if (result.status === "bvi") return COMPETITION_LABELS.bvi!;
  if (result.status === "numeric" && result.score !== null) {
    return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(result.score)} баллов`;
  }
  return "Результат не опубликован";
}

export function competitionResults(summary: AdmissionSummary, funding: "budget" | "paid", competition: AdmissionCompetition): readonly AdmissionCampaignResult[] {
  const types: readonly string[] = [competition];
  return summary.campaignResults.filter((result) => result.year === summary.year
    && result.funding === funding && types.includes(result.competitionType ?? "")
    && (competition !== "general" || result.stage === "main")
    && (result.status === "bvi" || (result.status === "numeric" && result.score !== null)))
    .sort((left, right) => {
      const specificity = (result: AdmissionCampaignResult) => result.scopeType === "program" ? 2 : result.scopeType === "department" ? 1 : 0;
      return specificity(right) - specificity(left)
        || (right.snapshotDate ?? "").localeCompare(left.snapshotDate ?? "");
    });
}

export function presentCompetition(summary: AdmissionSummary | undefined, funding: "budget" | "paid", competition: AdmissionCompetition): {
  value: string; note: string; sourceUrl: string | null;
} {
  if (!summary) return { value: "Не удалось загрузить", note: "Повторите загрузку сравнения.", sourceUrl: null };
  const seat = summary.seats[funding === "budget" ? 0 : 1];
  if (competition === "general" && seat?.numericValue === 0) {
    return { value: funding === "budget" ? "Бюджетные места не предусмотрены" : "Платные места не предусмотрены", note: `В приёмном плане ${summary.year} указано 0 мест.`, sourceUrl: seat.sourceUrl };
  }
  const results = competitionResults(summary, funding, competition);
  // A broader direction result must not replace an exact program's BVI result.
  const scope = results[0]?.scopeType;
  const sameScope = results.filter((result) => result.scopeType === scope);
  const numeric = sameScope.find((result) => result.status === "numeric");
  const bvi = sameScope.find((result) => result.status === "bvi");
  const selected = numeric ?? bvi;
  if (selected) return {
    value: admissionResultValue(selected),
    note: `${selected.year} · ${selected.scopeNote} · ${selected.stage === "first" ? "приоритетный этап" : selected.stage === "main" ? "основной этап" : "этап в источнике не указан"}.${numeric ? " Минимум в опубликованном списке зачисленных." : " Числовой балл для зачисления БВИ не применяется."}${numeric && bvi ? " Также есть зачисленные БВИ." : ""}`,
    sourceUrl: selected.sourceUrl,
  };
  if (competition === "general") {
    const bviEvidence = competitionResults(summary, funding, "bvi")[0];
    if (bviEvidence) return {
      value: "Есть зачисление БВИ",
      note: `${bviEvidence.year} · ${bviEvidence.scopeNote}. Подтверждён приём без вступительных испытаний; числовой результат общего конкурса в доступном приказе не опубликован. Это не означает, что все места заняты БВИ.`,
      sourceUrl: bviEvidence.sourceUrl,
    };
  }
  return {
    value: competition === "bvi" ? "В приказах не указано" : "Результат не опубликован",
    note: `В доступных приказах ${summary.year} нет результата этого конкурса. Это не нулевой балл.`, sourceUrl: null,
  };
}
