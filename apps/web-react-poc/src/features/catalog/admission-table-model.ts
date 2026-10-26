import type { AdmissionCampaignResult, AdmissionSummary } from "./admission-model";

export const SCORE_ROWS = [
  { key: "budget", label: "Бюджет", funding: "budget", competition: "general" },
  { key: "paid", label: "Платное обучение", funding: "paid", competition: "general" },
] as const;

type ScoreRow = typeof SCORE_ROWS[number];

const VERIFIED_MAIN_ORDER_SOURCES: Readonly<Record<string, { year: number; funding: "budget" | "paid"; url: string }>> = {
  "bba340a47c433e4d54fa2d1223ecdcde1ed535089a85c6e003d680a6ac29aa6b": {
    year: 2026,
    funding: "budget",
    url: "https://priem.bmstu.ru/lists/upload/orders/first_msk_main.pdf",
  },
  "73fd699df0a1cc44967acb96d99a0d76f6dafa20f7dc1c57fffff11a0e55ce2d": {
    year: 2026,
    funding: "paid",
    url: "https://priem.bmstu.ru/lists/upload/orders/first_msk_paid.pdf",
  },
};

function verifiedMainOrderUrl(result: AdmissionCampaignResult, funding: "budget" | "paid"): string | null {
  const verified = result.sourceSha256 ? VERIFIED_MAIN_ORDER_SOURCES[result.sourceSha256] : undefined;
  if (verified?.year === result.year && verified.funding === funding
    && (!result.sourceArtifactUrl || result.sourceArtifactUrl === verified.url)) {
    return verified.url;
  }

  // New API releases can expose the official PDF URL directly. Legacy rows
  // omit it, so those are accepted only through the exact hashes above.
  if (!result.sourceArtifactUrl) return null;
  try {
    const url = new URL(result.sourceArtifactUrl);
    const filename = funding === "budget" ? "first_msk_main.pdf" : "first_msk_paid.pdf";
    if (url.origin !== "https://priem.bmstu.ru"
      || url.pathname !== `/lists/upload/orders/${filename}`
      || url.search || url.hash) return null;
    return url.toString();
  } catch {
    return null;
  }
}

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
  readonly bviSourceUrl?: string;
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
  if (values.size > 1) return {
    value: "Требует проверки",
    note: "В официальной карточке найдены противоречащие друг другу значения; балл нужно проверить по источнику.",
    sourceUrl: null,
    kind: "unavailable",
  };
  if (values.size <= 1 && summary.orderScoreFallbackAllowed === true) {
    const orderResults = (summary.year === year ? summary.campaignResults : summary.historicalResults).flatMap((result) => {
      if (result.year !== year || result.funding !== row.funding || result.competitionType !== "general"
        || result.stage !== "main" || result.status !== "numeric"
        || (result.scopeType !== null && result.scopeType !== "direction")
        || (result.scopeLabel != null && result.scopeLabel !== summary.directionCode)
        || result.score === null || !Number.isFinite(result.score) || result.score < 0 || result.score > 400) return [];
      const sourceUrl = verifiedMainOrderUrl(result, row.funding);
      return sourceUrl ? [{ result, sourceUrl }] : [];
    });
    const orderScores = new Set(orderResults.map(({ result }) => result.score));
    if (orderScores.size === 1) {
      const { result: orderResult, sourceUrl } = orderResults[0]!;
      return {
        value: `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(orderResult.score!)} баллов`,
        note: `Минимальная сумма баллов в основном приказе · всё направление ${summary.directionCode ?? ""}, все профили`,
        sourceUrl,
        kind: "score",
      };
    }
    if (orderScores.size > 1) return {
      value: "Требует проверки",
      note: "В основном приказе найдены противоречащие друг другу числовые результаты; балл нужно проверить по источнику.",
      sourceUrl: null,
      kind: "unavailable",
    };
  }
  const bvi = summary.budgetBviEvidence;
  if (selected?.score === null && row.funding === "budget" && bvi?.year === year) return {
    value: "БВИ вне квот", kind: "bvi", sourceUrl: selected.sourceUrl, bviSourceUrl: bvi.sourceUrl,
    note: `По опубликованному приказу — ${bvi.admittedCount} зачисленных без вступительных испытаний вне квот. Числовой проходной в карточке не указан. Зачисление по квотам учитывается отдельно.`,
  };
  return { value: "Не опубликован", note: "Числового значения нет ни в официальной карточке, ни в основном приказе о зачислении.", sourceUrl: selected?.sourceUrl ?? null, kind: "unavailable" };
}
