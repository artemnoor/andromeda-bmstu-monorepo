import { Profiler, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ProfilerOnRenderCallback, type ReactNode } from "react";
import { Link } from "react-router";
import { Bar, BarChart, Pie, PieChart, ResponsiveContainer, Sector, Tooltip, XAxis, YAxis, type PieSectorShapeProps, type TooltipContentProps } from "recharts";
import { AndromedaHeader } from "@/widgets/andromeda-navigation/andromeda-header";
import { useComparisonSelection } from "@/shared/browser-state/hooks";
import { comparisonSelection } from "@/shared/browser-state/hooks";
import { loadProgramComparison, type ComparisonOverview, type ComparisonSelection, type LoadedProgramComparison } from "@/features/comparison/api";
import { buildDonutSegments } from "@/features/comparison/chart-data";
import type { CategoryWorkload, ComparisonCurriculumItem, NullableMetric, ProgramComparisonModel } from "@/features/comparison/model";
import type { AdmissionCampaignResult, AdmissionMetric, AdmissionSummary } from "@/features/catalog/admission-model";
import { AcademicReleaseMismatchError } from "@/shared/api/client";
import styles from "@/features/comparison/comparison.module.css";

type ComparisonLoadState =
  | { readonly signature: string; readonly kind: "ready"; readonly data: LoadedProgramComparison }
  | { readonly signature: string; readonly kind: "preview"; readonly data: ComparisonOverview }
  | { readonly signature: string; readonly kind: "selection"; readonly data: ComparisonSelection }
  | {
      readonly signature: string;
      readonly kind: "error";
      readonly message: string;
      readonly recovery: "retry" | "reload";
    };

const SERIES_COLORS = ["#006cdc", "#26364a", "#68798e"] as const;
const CATEGORY_COLORS = [
  "#006cdc", "#497b5f", "#b77b2f", "#8165a7", "#b75b64", "#3f8190", "#65738b", "#789546",
  "#bc6a37", "#4f68a6", "#a24f89", "#7a8b41", "#527b9f", "#b17d5c", "#77708f", "#467a70",
] as const;

const recordComparisonProfile: ProfilerOnRenderCallback = (
  id,
  phase,
  actualDuration,
  baseDuration,
  startTime,
  commitTime,
) => {
  const samples = window.__andromedaReactProfileSamples ??= [];
  samples.push({ id, phase, actualDuration, baseDuration, startTime, commitTime });
};

function colorFor(index: number): string {
  return CATEGORY_COLORS[index % CATEGORY_COLORS.length] ?? "#006cdc";
}

function formatMetric(metric: NullableMetric, unit: string): string {
  if (metric.count === 0) return "—";
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: unit === "з.е." ? 1 : 0 }).format(metric.value)} ${unit}`;
}

function planStatusMessage(program: ProgramComparisonModel): string {
  if (program.itemsStatus === "unavailable") return "Состав подтверждённого плана не удалось полностью загрузить.";
  switch (program.planSelection.status) {
    case "ready": return program.items.length ? "Используется последняя однозначно подтверждённая версия." : "В доступной версии плана нет позиций.";
    case "missing": return "Учебный план не опубликован для этой программы.";
    case "ambiguous": return "Найдено несколько версий или год версии не указан; состав плана не сопоставлен.";
    case "needs-review": return "Актуальная версия или связь учебного плана требует проверки; старую версию не подставляем.";
  }
}

function SourceLink({ href }: { href: string | null | undefined }) {
  if (!href) return null;
  return <a className={styles.sourceLink} href={href} target="_blank" rel="noopener noreferrer">Источник ↗</a>;
}

function OverviewValue({
  value,
  note,
  sourceUrl,
}: {
  value: string;
  note?: string | null;
  sourceUrl?: string | null;
}) {
  return (
    <div className={styles.overview}>
      <strong>{value}</strong>
      {note ? <span>{note}</span> : null}
      <SourceLink href={sourceUrl} />
    </div>
  );
}

function StudyOfferOverview({ summary }: { summary: AdmissionSummary | undefined }) {
  if (!summary) return <OverviewValue value="Не удалось загрузить" note="Повторите загрузку сравнения." />;
  if (!summary.offers.length) {
    return <OverviewValue value="Точное предложение не найдено" note="Связь с программой не подтверждена." />;
  }

  const valueFor = (prefix: string) => summary.offers
    .filter((offer) => offer.startsWith(prefix))
    .map((offer) => offer.slice(prefix.length).trim())
    .filter(Boolean);
  const forms = valueFor("Форма обучения:");
  const durations = valueFor("Срок обучения:");

  return (
    <OverviewValue
      value={forms.join(", ") || "Форма не указана"}
      note={durations.length ? `срок обучения · ${durations.join(", ")}` : "Срок обучения не указан."}
    />
  );
}

function MetricOverview({ summary, index }: { summary: AdmissionSummary | undefined; index: number }) {
  if (!summary) return <OverviewValue value="Не удалось загрузить" />;
  const metric: AdmissionMetric | undefined = summary.seats[index];
  if (!metric) return <OverviewValue value="Не указано" />;
  const fundingType = index === 0 ? "budget" : "paid";
  const relatedFacts = summary.relatedSeatFacts.filter((fact) => fact.fundingType === fundingType);
  if (metric.value === "—" && relatedFacts.length) {
    return (
      <div className={styles.overview}>
        <OverviewValue value="Не подтверждено" note="В источнике есть места, но их связь с выбранной программой требует проверки." />
        <details className={styles.relatedFacts}>
          <summary>Посмотреть сведения из источника</summary>
          {relatedFacts.map((fact) => (
          <div className={styles.overview} key={fact.key}>
            <strong>{fact.value}</strong>
            <span>
              {fact.note ? `${fact.note} ` : ""}
              Предложение из источника «{fact.sourceProgramName}»
              {fact.departmentCode ? ` · кафедра ${fact.departmentCode}` : ""}.
              Связь с выбранной программой не подтверждена.
            </span>
            <SourceLink href={fact.sourceUrl} />
          </div>
          ))}
        </details>
      </div>
    );
  }
  return <OverviewValue value={metric.value === "—" ? "Количество не указано" : metric.value} note={metric.note ?? (metric.value === "—" ? summary.seatNote : `Уровень данных: ${summary.seatScope}`)} sourceUrl={metric.sourceUrl} />;
}

function latestNumericCampaignResult(
  summary: AdmissionSummary,
  options: { funding: "budget" | "paid"; stage: string; competitionTypes: readonly string[] },
): AdmissionCampaignResult | null {
  return summary.campaignResults
    .filter((result) => result.year === summary.year
      && result.funding === options.funding
      && result.stage === options.stage
      && result.status === "numeric"
      && options.competitionTypes.includes(result.competitionType ?? "")
      && result.score !== null)
    .sort((left, right) => {
      const rank = (result: AdmissionCampaignResult) => (
        result.scopeType === "program" ? 2 : result.scopeType === "department" ? 1 : 0
      );
      return rank(right) - rank(left)
        || (right.snapshotDate ?? "").localeCompare(left.snapshotDate ?? "");
    })[0] ?? null;
}

function scoreText(score: number): string {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(score)} баллов`;
}

function CampaignScoreOverview({
  summary,
  funding,
  competitionTypes,
  fallbackToPaidHistory = false,
}: {
  summary: AdmissionSummary | undefined;
  funding: "budget" | "paid";
  competitionTypes: readonly string[];
  fallbackToPaidHistory?: boolean;
}) {
  if (!summary) return <OverviewValue value="Не удалось загрузить" />;
  const result = latestNumericCampaignResult(summary, { funding, stage: "main", competitionTypes });
  if (result?.score !== null && result?.score !== undefined) {
    return <OverviewValue value={scoreText(result.score)} note={`${result.year} · ${result.scopeNote} · минимум в списке зачисленных`} sourceUrl={result.sourceUrl} />;
  }
  if (fallbackToPaidHistory) {
    const historical = summary.history.find((item) => item.funding === "Платное" && item.minimum !== "—");
    if (historical) {
      return <OverviewValue value={`${historical.minimum} баллов`} note={`платное · минимум зачисленных · ${historical.year} · ${summary.historyScope}`} sourceUrl={historical.sourceUrl} />;
    }
  }
  const hasBudgetQuotaScores = funding === "budget" && summary.campaignResults.some((candidate) => (
    candidate.year === summary.year
    && candidate.funding === "budget"
    && candidate.stage === "first"
    && candidate.status === "numeric"
    && candidate.score !== null
    && ["separate_quota", "special_quota", "targeted"].includes(candidate.competitionType ?? "")
  ));
  return <OverviewValue
    value="Нет данных"
    note={`Числовой балл ${funding === "budget" ? "бюджетного" : "платного"} конкурса не опубликован для приёма ${summary.year ?? ""}.${hasBudgetQuotaScores ? " Баллы по отдельным квотам показаны в строке ниже." : ""}`}
  />;
}

function QuotaScoreOverview({ summary }: { summary: AdmissionSummary | undefined }) {
  if (!summary) return <OverviewValue value="Не удалось загрузить" />;
  const labels: Readonly<Record<string, string>> = {
    separate_quota: "Отдельная",
    special_quota: "Особая",
    targeted: "Целевая",
  };
  const results = summary.campaignResults
    .filter((result) => result.year === summary.year
      && result.funding === "budget"
      && result.stage === "first"
      && result.status === "numeric"
      && result.score !== null
      && labels[result.competitionType ?? ""] !== undefined)
    .sort((left, right) => (right.snapshotDate ?? "").localeCompare(left.snapshotDate ?? ""));
  const byType = new Map<string, AdmissionCampaignResult>();
  for (const result of results) {
    if (result.competitionType && !byType.has(result.competitionType)) byType.set(result.competitionType, result);
  }
  if (!byType.size) {
    return <OverviewValue value="Нет данных" note="Числовые результаты бюджетных квот не опубликованы в доступном архиве." />;
  }
  const entries = [...byType.entries()];
  const value = entries.map(([type, result]) => `${labels[type]} — ${result.score}`).join(" · ") + " баллов";
  const sourceUrl = entries.map(([, result]) => result.sourceUrl).find(Boolean) ?? null;
  const scopes = [...new Set(entries.map(([, result]) => result.scopeNote))].join("; ");
  return <OverviewValue value={value} note={`Списки зачисленных ${summary.year} · ${scopes} · отдельные квоты, не общий конкурс.`} sourceUrl={sourceUrl} />;
}

function SelectionCards({
  selectedKeys,
  data,
}: {
  selectedKeys: readonly string[];
  data: ComparisonSelection | null;
}) {
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const found = data?.programs ?? [];

  function saveSelection(nextKeys: readonly string[]) {
    setStorageUnavailable(comparisonSelection.set(nextKeys) === "unavailable");
  }

  function removeProgram(programKey: string, code: string) {
    const aliases = new Set([programKey, code]);
    saveSelection(selectedKeys.filter((key) => !aliases.has(key)));
  }

  return (
    <section className={styles.selection} aria-labelledby="selection-title">
      <div className={styles.selectionHead}>
        <div>
          <h2 id="selection-title">Выбранные программы</h2>
          <p className={styles.selectionCount}>{selectedKeys.length} из 3 можно сравнить одновременно</p>
        </div>
        <div className={styles.selectionActions}>
          <Link className={styles.button} to="/programs">Изменить выбор</Link>
        </div>
      </div>
      {storageUnavailable ? <p className={styles.warning} role="alert">Не удалось сохранить выбор в хранилище браузера. Список не изменён.</p> : null}
      <div className={styles.selectionList}>
        {found.map((program, index) => (
          <article className={styles.selectionCard} key={program.external_key} style={{ "--program-color": SERIES_COLORS[index % SERIES_COLORS.length] } as CSSProperties}>
            <div className={styles.selectionCopy}>
              <span>{program.code || "Код не указан"}</span>
              <strong>{program.name || "Название не указано"}</strong>
            </div>
            <button className={styles.removeButton} type="button" aria-label={`Убрать программу ${program.code} из сравнения`} onClick={() => removeProgram(program.external_key, program.code)}>×</button>
          </article>
        ))}
        {data?.invalidSelectionKeys.map((key) => (
          <article className={styles.selectionCard} key={`missing:${key}`}>
            <div className={styles.selectionCopy}><span>Сохранённый ключ</span><strong>{key} · отсутствует в активном выпуске</strong></div>
            <button className={styles.removeButton} type="button" aria-label={`Убрать отсутствующий ключ ${key}`} onClick={() => saveSelection(selectedKeys.filter((entry) => entry !== key))}>×</button>
          </article>
        ))}
        {!selectedKeys.length ? <p className={styles.selectionEmpty}>Добавьте программы в каталоге, чтобы сравнить поступление и подтверждённые учебные планы.</p> : null}
      </div>
    </section>
  );
}

function AdmissionComparison({ data }: { data: ComparisonOverview }) {
  const years = [...new Set([...data.admission.values()].flatMap((summary) => summary.year === null ? [] : [summary.year]))];
  const campaignLabel = years.length === 1
    ? `Данные приёмной кампании ${years[0]} года`
    : years.length
      ? `Данные приёмных кампаний ${years.join(" / ")}`
      : "Данные приёмной кампании";
  const rows: { label: string; value: (key: string, summary: AdmissionSummary | undefined) => ReactNode }[] = [
    { label: "Бюджетные места · общий конкурс", value: (_key, summary) => <MetricOverview summary={summary} index={0} /> },
    { label: "Платные места · общий конкурс", value: (_key, summary) => <MetricOverview summary={summary} index={1} /> },
    {
      label: "Проходной балл · бюджет · основной конкурс",
      value: (_key, summary) => <CampaignScoreOverview summary={summary} funding="budget" competitionTypes={["general", "other"]} />,
    },
    {
      label: "Проходные баллы · бюджетные квоты",
      value: (_key, summary) => <QuotaScoreOverview summary={summary} />,
    },
    {
      label: "Проходной балл · платное",
      value: (_key, summary) => <CampaignScoreOverview summary={summary} funding="paid" competitionTypes={["general", "other"]} fallbackToPaidHistory />,
    },
    {
      label: "Минимальные баллы ЕГЭ",
      value: (_key, summary) => summary?.requirements.length
        ? <OverviewValue value={summary.requirements.map((item) => `${item.category}: ${item.text}`).join("; ")} note={`Требования указаны для направления ${summary.directionCode ?? "не указано"}.`} sourceUrl={summary.requirements.find((item) => item.sourceUrl)?.sourceUrl ?? null} />
        : <OverviewValue value={summary ? "Нет данных" : "Не удалось загрузить"} note="Минимальные баллы не найдены в архиве." />,
    },
    {
      label: "Форма и срок обучения",
      value: (_key, summary) => <StudyOfferOverview summary={summary} />,
    },
  ];

  return (
    <section
      className={styles.section}
      id="admission"
      aria-labelledby="admission-title"
      data-qa="admission-summary"
      data-unavailable-count={data.admissionUnavailable.size}
    >
      <div className={styles.sectionHeading}>
        <div><p className={styles.kicker}>{campaignLabel}</p><h2 id="admission-title">Места и проходные баллы</h2><p>Сравнивай один и тот же конкурс. Баллы квот показаны отдельно; балл прошлых зачислений не гарантирует поступление.</p></div>
      </div>
      <div className={styles.tableWrap}>
        <table className={`${styles.table} ${styles.comparisonTable}`}>
          <caption className={styles.srOnly}>Сравнение мест и условий приёма в выбранные программы.</caption>
          <thead><tr><th scope="col">Показатель</th>{data.programs.map((program) => <th scope="col" key={program.external_key}><div className={styles.programHead}><span className={styles.programCode}>{program.code}</span><h3 className={styles.programName}>{program.name}</h3></div></th>)}</tr></thead>
          <tbody>{rows.map((row) => <tr key={row.label}><th scope="row">{row.label}</th>{data.programs.map((program, index) => <td key={program.external_key} data-program-label={program.code || program.name} style={{ "--program-color": SERIES_COLORS[index % SERIES_COLORS.length] } as CSSProperties}>{row.value(program.external_key, data.admission.get(program.external_key))}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

interface WorkloadTooltipRow {
  readonly label: string;
  readonly color: string;
  readonly value: number | null;
  readonly text: string;
}

interface WorkloadChartPoint {
  [key: string]: unknown;
  readonly semester: string;
  readonly tooltipRows: readonly WorkloadTooltipRow[];
}

function WorkloadTooltip(props: TooltipContentProps) {
  const point = props.payload?.[0]?.payload as WorkloadChartPoint | undefined;
  if (!props.active || !point) return null;
  return (
    <div className={styles.workloadTooltip} role="status">
      <strong>{point.semester}</strong>
      {point.tooltipRows.map((row) => (
        <div className={styles.workloadTooltipRow} key={row.label}>
          <span className={styles.workloadTooltipSwatch} style={{ "--series-color": row.color } as CSSProperties} aria-hidden="true" />
          <span>{row.label}</span>
          <strong>{row.text}</strong>
        </div>
      ))}
    </div>
  );
}

function WorkloadChart({ data }: { data: LoadedProgramComparison }) {
  const unit = "ч.";
  const semesters = [...new Map(data.curriculum.programs.flatMap((program) => program.semesters).map((semester) => [semester.key, semester])).values()]
    .sort((left, right) => {
      if (left.semester === null) return right.semester === null ? 0 : 1;
      if (right.semester === null) return -1;
      return left.semester - right.semester;
    });
  const chartData = semesters.map((semester): WorkloadChartPoint => {
    const tooltipRows = data.curriculum.programs.map((program, index): WorkloadTooltipRow => {
      const value = program.semesters.find((item) => item.key === semester.key)?.hours;
      const hasValue = (value?.count ?? 0) > 0;
      return {
        label: data.programs[index]?.code || program.programKey,
        color: SERIES_COLORS[index % SERIES_COLORS.length] ?? SERIES_COLORS[0],
        value: hasValue && value ? value.value : null,
        text: hasValue && value ? formatMetric(value, unit) : "Нет данных",
      };
    });
    const point: WorkloadChartPoint = {
      semester: semester.semester === null ? "Семестр не указан" : `${semester.semester} семестр`,
      tooltipRows,
    };
    tooltipRows.forEach((row, index) => { point[`series-${index}`] = row.value; });
    return point;
  });
  const chartHeight = Math.max(260, semesters.length * (data.programs.length * 18 + 18) + 64);

  return (
    <section className={styles.section} id="workload" aria-labelledby="workload-title">
      <div className={styles.workloadPanel}>
        <div className={styles.panelHead}>
          <div><h2 className={styles.workloadTitle} id="workload-title">Нагрузка по семестрам</h2><p>Часы по семестрам для выбранных программ.</p></div>
        </div>
        <div className={styles.workloadLegend}>
          {data.programs.map((program, index) => <span className={styles.legendItem} key={program.external_key}><span className={styles.legendDot} style={{ "--series-color": SERIES_COLORS[index % SERIES_COLORS.length] } as CSSProperties} aria-hidden="true" /><strong>{program.code || program.name}</strong></span>)}
        </div>
        {chartData.length ? (
          <div className={styles.workloadChart} role="group" aria-label="Сравнение нагрузки по семестрам">
            <ResponsiveContainer width="100%" height={chartHeight}>
              <BarChart accessibilityLayer data={chartData} layout="vertical" margin={{ left: 0, right: 16, top: 8, bottom: 8 }} barGap={4} barCategoryGap="22%">
                <YAxis dataKey="semester" type="category" tickLine={false} tickMargin={10} axisLine={false} width={132} interval={0} tick={{ fill: "#5e6570", fontSize: 11 }} />
                <XAxis type="number" domain={[0, "dataMax"]} hide />
                <Tooltip cursor={false} content={WorkloadTooltip} />
                {data.programs.map((program, index) => (
                  <Bar key={program.external_key} dataKey={`series-${index}`} name={program.code || program.name} fill={SERIES_COLORS[index % SERIES_COLORS.length]} radius={5} maxBarSize={16} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <p className={styles.workloadEmpty}>В выбранных программах нет доступных данных о семестрах.</p>}
      </div>
    </section>
  );
}

interface ComparisonCategory {
  readonly key: string;
  readonly categoryCode: string | null;
  readonly name: string;
  readonly color: string;
  readonly workloads: ReadonlyMap<string, CategoryWorkload>;
}

interface DonutChartDatum {
  readonly key: string;
  readonly name: string;
  readonly categoryCode: string | null;
  readonly hours: number;
  readonly plotValue: number;
  readonly color: string;
  readonly kind: "category" | "remainder" | "empty";
}

function percentage(value: number, total: number, hasData: boolean): string {
  if (!hasData || total <= 0) return "—";
  if (value === 0) return "0%";
  const rounded = Math.round(value / total * 100);
  return rounded < 1 ? "<1%" : String(rounded) + "%";
}

function wrapCenterLabel(value: string): readonly string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of value.split(/\s+/)) {
    const next = line ? line + " " + word : word;
    if (next.length > 16 && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= 3) return lines;
  return [lines[0] ?? "", lines[1] ?? "", (lines[2] ?? "").slice(0, 13) + "…"];
}

function classificationIsComplete(program: ProgramComparisonModel, taxonomyUnavailable: boolean): boolean {
  return !taxonomyUnavailable
    && program.itemsStatus === "loaded"
    && program.items.length > 0
    && program.items.every((item) => item.classification !== null);
}

function CategoryChart({
  program,
  programCode,
  programName,
  programIndex,
  categories,
  activeKey,
  taxonomyUnavailable,
  onSelect,
}: {
  program: ProgramComparisonModel;
  programCode: string;
  programName: string;
  programIndex: number;
  categories: readonly ComparisonCategory[];
  activeKey: string | null;
  taxonomyUnavailable: boolean;
  onSelect: (key: string) => void;
}) {
  const total = program.total.hours;
  const circumference = 2 * Math.PI * 75;
  const programComplete = classificationIsComplete(program, taxonomyUnavailable);
  const segments = buildDonutSegments(
    categories,
    (category) => category.workloads.get(program.programKey)?.hours,
    total.value,
    circumference,
  );
  const activeCategory = categories.find((category) => category.key === activeKey);
  const activeWorkload = activeCategory?.workloads.get(program.programKey);
  const knownZero = Boolean(activeCategory && !activeWorkload && programComplete && total.count > 0);
  const activeValue = activeWorkload?.hours.value ?? 0;
  const hasActiveValue = Boolean(activeWorkload?.hours.count) || knownZero;
  const chartData = useMemo<readonly DonutChartDatum[]>(() => {
    const classifiedHours = segments.reduce((sum, segment) => sum + segment.value.value, 0);
    const scale = classifiedHours > total.value && classifiedHours > 0 ? total.value / classifiedHours : 1;
    const entries: DonutChartDatum[] = segments.map(({ category, value }) => ({
      key: category.key,
      name: category.name,
      categoryCode: category.categoryCode,
      hours: value.value,
      plotValue: value.value * scale,
      color: category.color,
      kind: "category",
    }));
    const plottedHours = entries.reduce((sum, entry) => sum + entry.plotValue, 0);
    const remainder = Math.max(0, total.value - plottedHours);
    if (remainder > 0) {
      entries.push({
        key: "remainder",
        name: "Часы вне подтверждённых категорий",
        categoryCode: null,
        hours: remainder,
        plotValue: remainder,
        color: "#e7ebf0",
        kind: "remainder",
      });
    }
    if (!entries.some((entry) => entry.plotValue > 0)) {
      return [{
        key: "empty",
        name: total.count ? "Нет подтверждённых часов по категориям" : "Нет числовых данных",
        categoryCode: null,
        hours: 0,
        plotValue: 1,
        color: "#e7ebf0",
        kind: "empty",
      }];
    }
    return entries;
  }, [segments, total.count, total.value]);

  function activate(event: KeyboardEvent<SVGPathElement>, categoryKey: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(categoryKey);
    }
  }

  function renderSector(props: PieSectorShapeProps) {
    const datum = props.payload as DonutChartDatum;
    const isCategory = datum.kind === "category";
    const isSelected = isCategory && datum.key === activeKey;
    const isExpanded = isSelected || props.isActive;
    const chartEvents = {
      ...(props.onMouseEnter ? { onMouseEnter: props.onMouseEnter } : {}),
      ...(props.onMouseLeave ? { onMouseLeave: props.onMouseLeave } : {}),
      ...(props.onMouseMove ? { onMouseMove: props.onMouseMove } : {}),
      ...(props.onMouseOver ? { onMouseOver: props.onMouseOver } : {}),
      ...(props.onMouseOut ? { onMouseOut: props.onMouseOut } : {}),
    };
    const activeExpansion = Math.min(4, (props.outerRadius ?? 0) * 0.06);
    return (
      <Sector
        cx={props.cx}
        cy={props.cy}
        innerRadius={props.innerRadius}
        startAngle={props.startAngle}
        endAngle={props.endAngle}
        fill={datum.color}
        {...chartEvents}
        className={styles.donutSector + (isSelected ? " " + styles.donutSectorSelected : "")}
        outerRadius={(props.outerRadius ?? 0) + (isExpanded ? activeExpansion : 0)}
        cornerRadius={0}
        stroke="none"
        strokeWidth={0}
        role={isCategory ? "button" : "presentation"}
        tabIndex={isCategory ? 0 : -1}
        aria-label={isCategory ? `${datum.name}: ${formatMetric({ value: datum.hours, count: 1 }, "ч.")}, ${percentage(datum.hours, total.value, true)}` : undefined}
        aria-pressed={isCategory ? isSelected : undefined}
        data-chart-category-code={isCategory ? datum.categoryCode ?? "unclassified" : undefined}
        data-chart-hours={isCategory ? String(datum.hours) : undefined}
        data-chart-start-angle={props.startAngle}
        data-chart-end-angle={props.endAngle}
        data-chart-padding-angle={props.paddingAngle ?? 0}
        data-chart-slice-count={chartData.length}
        {...(isCategory ? {
          onKeyDown: (event: KeyboardEvent<SVGPathElement>) => activate(event, datum.key),
          onClick: () => onSelect(datum.key),
        } : {})}
      />
    );
  }

  return (
    <article
      className={styles.categoryCard}
      data-qa="category-chart-card"
      data-program-key={program.programKey}
      data-plan-key={program.planSelection.currentPlan?.external_key ?? ""}
      data-item-count={program.items.length}
      data-total-hours={total.count ? String(total.value) : ""}
      data-total-credits={program.total.credits.count ? String(program.total.credits.value) : ""}
    >
      <header className={styles.chartCardHeader} style={{ "--program-color": SERIES_COLORS[programIndex % SERIES_COLORS.length] } as CSSProperties}>
        <span className={styles.chartCardCode} data-qa="category-program-code">{programCode || "Код не указан"}</span>
        <h3 className={styles.chartCardTitle}>{programName}</h3>
        <p className={styles.chartCardDescription}>Структура учебной нагрузки по предметным категориям</p>
      </header>
      <div className={styles.chartCardContent}>
        <div className={styles.donutWrap} role="group" aria-label={"Распределение программы " + (programCode || programName) + " по категориям" + (total.count ? ", " + formatMetric(total, "ч.") : "")}>
          <ResponsiveContainer className={styles.donut ?? ""} width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                dataKey="plotValue"
                nameKey="name"
                innerRadius="58%"
                outerRadius="82%"
                paddingAngle={0}
                strokeWidth={0}
                cornerRadius={0}
                shape={renderSector}
                isAnimationActive={false}
              >
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className={styles.donutCenter} aria-live="polite">
            <strong className={styles.donutCenterValue} data-qa="category-chart-center-value">
              {percentage(activeValue, total.value, hasActiveValue && total.count > 0)}
            </strong>
            <span className={styles.donutCenterLabel} data-qa="category-chart-center-label">
              {wrapCenterLabel(activeCategory?.name ?? (total.count ? "Выберите категорию" : "Нет числовых данных")).map((line, index) => <span key={index}>{line}</span>)}
            </span>
          </div>
        </div>
      </div>
      {program.items.length > 0 && program.total.hours.count < program.items.length
        ? <p className={styles.categoryFootnote}>У части дисциплин часы не указаны. Доли рассчитаны по опубликованным значениям.</p>
        : null}
    </article>
  );
}

function CategoryComparison({ data }: { data: LoadedProgramComparison }) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const categories = useMemo(() => {
    const found = new Map<string, { key: string; categoryCode: string | null; name: string }>();
    for (const category of data.curriculum.taxonomyCategories) {
      found.set("code:" + category.category_code, {
        key: "code:" + category.category_code,
        categoryCode: category.category_code,
        name: category.name,
      });
    }
    for (const program of data.curriculum.programs) {
      for (const category of program.categories) {
        if (!found.has(category.key)) found.set(category.key, {
          key: category.key,
          categoryCode: category.categoryCode,
          name: category.name,
        });
      }
    }
    const ordered = [...found.values()].sort((left, right) => {
      if (left.categoryCode === null) return right.categoryCode === null ? 0 : 1;
      if (right.categoryCode === null) return -1;
      const codeOrder = (Number(left.categoryCode) || 0) - (Number(right.categoryCode) || 0);
      return codeOrder || left.name.localeCompare(right.name, "ru");
    });
    return ordered.map((category, index) => ({
      ...category,
      color: category.categoryCode === null ? "#b9c3cf" : colorFor(index),
      workloads: new Map(data.curriculum.programs.flatMap((program) => {
        const workload = program.categories.find((candidate) => candidate.key === category.key);
        return workload ? [[program.programKey, workload] as const] : [];
      })),
    }));
  }, [data.curriculum.programs, data.curriculum.taxonomyCategories]);
  const defaultCategoryKey = useMemo(() => {
    const aggregate = (category: ComparisonCategory) => [...category.workloads.values()]
      .reduce((sum, workload) => sum + workload.hours.value, 0);
    return [...categories]
      .filter((category) => category.categoryCode !== null)
      .sort((left, right) => aggregate(right) - aggregate(left))
      .find((category) => aggregate(category) > 0)?.key
      ?? categories[0]?.key
      ?? null;
  }, [categories]);
  const selectedCategoryKey = categories.some((category) => category.key === activeKey) ? activeKey : defaultCategoryKey;
  const selectedCategory = categories.find((category) => category.key === selectedCategoryKey) ?? null;
  const displayCategories = useMemo(() => [...categories].sort((left, right) => {
    const aggregate = (category: ComparisonCategory) => [...category.workloads.values()]
      .reduce((sum, workload) => sum + workload.hours.value, 0);
    return aggregate(right) - aggregate(left) || left.name.localeCompare(right.name, "ru");
  }), [categories]);
  const taxonomyCategoryCount = data.curriculum.taxonomyCategories.length;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (detailKey && !dialog.open) dialog.showModal();
    else if (!detailKey && dialog.open) dialog.close();
  }, [detailKey]);

  return (
    <section className={styles.section} id="curriculum" aria-labelledby="category-title">
      <div className={styles.categoryBoard}>
        <header className={styles.categoryHead}>
          <div>
            <h2 className={styles.categoryTitle} id="category-title">Куда уходит учебное время</h2>
            <p className={styles.categoryCopy}>Сектора показывают долю учебных часов в каждой предметной категории.</p>
            <span className={styles.categoryCount}>В классификаторе: {new Intl.NumberFormat("ru-RU").format(taxonomyCategoryCount)} категорий</span>
          </div>
        </header>
        {data.taxonomyUnavailable ? <p className={styles.warning}>Для этих классификаций не удалось подтвердить одну версию таксономии. Дисциплины сохранены в таблице, но сравнимые категории не рассчитываются.</p> : null}
        <div className={styles.categoryGrid}>
          {data.curriculum.programs.map((program, index) => (
            <CategoryChart
              key={program.programKey}
              program={program}
              programCode={data.programs.find((candidate) => candidate.external_key === program.programKey)?.code ?? ""}
              programName={data.programs.find((candidate) => candidate.external_key === program.programKey)?.name ?? "Программа"}
              programIndex={index}
              categories={categories}
              activeKey={selectedCategoryKey}
              taxonomyUnavailable={data.taxonomyUnavailable}
              onSelect={setActiveKey}
            />
          ))}
        </div>
        <section className={styles.categoryShared} aria-labelledby="category-shared-title">
          <div className={styles.categorySharedHead}>
            <div>
              <h3 className={styles.categorySharedTitle} id="category-shared-title">Одна категория — один цвет</h3>
              <p className={styles.categorySharedCopy}>Нажмите на категорию, чтобы выделить её на всех диаграммах и сравнить дисциплины.</p>
            </div>
          </div>
          <div className={styles.categorySharedGrid}>
            {categories.map((category) => (
              <div className={styles.categorySharedItem + (selectedCategoryKey === category.key ? " " + styles.categorySharedItemActive : "")} key={category.key} data-qa="category-legend-item" data-category={category.name} style={{ "--category-color": category.color } as CSSProperties}>
                <button className={styles.categorySharedSelect + (selectedCategoryKey && selectedCategoryKey !== category.key ? " " + styles.categorySharedSelectDimmed : "")} type="button" aria-pressed={selectedCategoryKey === category.key} onClick={() => setActiveKey(category.key)}>
                  <span className={styles.categorySharedDot} aria-hidden="true" />
                  <span className={styles.categorySharedName}>{category.name}</span>
                </button>
                <button className={styles.categoryDetailsTrigger} type="button" aria-label={"Подробнее о категории «" + category.name + "»"} onClick={() => { setActiveKey(category.key); setDetailKey(category.key); }}>Подробнее</button>
              </div>
            ))}
          </div>
        </section>
        <section className={styles.categoryDistribution} aria-labelledby="category-distribution-title">
          <div className={styles.categoryDistributionHeading}>
            <h3 id="category-distribution-title">Часы по категориям</h3>
          </div>
          <div className={styles.categoryDistributionWrap}>
            <table className={styles.table + " " + styles.categoryDistributionTable}>
              <caption className={styles.srOnly}>Сравнение учебных часов по категориям предметов.</caption>
              <thead><tr><th scope="col">Категория предмета</th>{data.programs.map((program) => <th scope="col" key={program.external_key}><div className={styles.categoryProgramHead}><span className={styles.categoryProgramCode}>{program.code || "Код не указан"}</span><span className={styles.categoryProgramName}>{program.name || "Название не указано"}</span></div></th>)}</tr></thead>
              <tbody>{displayCategories.length ? displayCategories.map((category) => (
                <tr key={category.key} data-qa="category-distribution-row" data-category={category.name} style={{ "--category-color": category.color } as CSSProperties}>
                  <th scope="row"><span className={styles.categoryRowName}><span className={styles.categoryRowDot} aria-hidden="true" />{category.name}</span></th>
                  {data.curriculum.programs.map((program) => {
                    const workload = category.workloads.get(program.programKey);
                    const complete = classificationIsComplete(program, data.taxonomyUnavailable);
                    const knownZero = !workload && complete && program.total.hours.count > 0;
                    const hasValue = Boolean(workload?.hours.count) || knownZero;
                    const value = workload?.hours.value ?? 0;
                    const total = program.total.hours.value;
                    if (program.itemsStatus === "unavailable" || program.planSelection.status !== "ready") {
                      return <td key={program.programKey} data-program-code={data.programs.find((candidate) => candidate.external_key === program.programKey)?.code ?? ""}><span className={styles.categoryDistributionEmpty}>{planStatusMessage(program)}</span></td>;
                    }
                    if (!hasValue) {
                      const programCode = data.programs.find((candidate) => candidate.external_key === program.programKey)?.code ?? "";
                      const unknownLabel = workload ? "Для категории не указаны числовые часы" : "Для категории нет подтверждённых дисциплин";
                      return <td key={program.programKey} data-program-code={programCode} aria-label={`${category.name}, ${programCode}: ${unknownLabel}`}>
                        <div className={styles.categoryDistributionCell}>
                          <div className={styles.categoryDistributionValues}><strong data-semantic-state="unknown" title={unknownLabel}>—</strong><span>—</span></div>
                          <span className={styles.categoryDistributionTrack} aria-hidden="true"><span className={styles.categoryDistributionFill} style={{ "--bar-width": "0%" } as CSSProperties} /></span>
                        </div>
                      </td>;
                    }
                    const width = total > 0 ? Math.min(100, value / total * 100) : 0;
                    const numericMetric = { value, count: workload?.hours.count ?? (knownZero ? 1 : 0) };
                    return <td key={program.programKey} data-program-code={data.programs.find((candidate) => candidate.external_key === program.programKey)?.code ?? ""}>
                      <div className={styles.categoryDistributionCell}>
                        <div className={styles.categoryDistributionValues}><strong>{formatMetric(numericMetric, "ч.")}</strong><span>{percentage(value, total, true)}</span></div>
                        <span className={styles.categoryDistributionTrack} aria-hidden="true"><span className={styles.categoryDistributionFill} style={{ "--bar-width": String(width) + "%" } as CSSProperties} /></span>
                      </div>
                    </td>;
                  })}
                </tr>
              )) : <tr><td colSpan={data.programs.length + 1}>Категории не указаны в данных выбранных программ.</td></tr>}</tbody>
            </table>
          </div>
        </section>
      </div>
      <dialog
        ref={dialogRef}
        className={styles.categoryDialog}
        aria-labelledby="category-dialog-title"
        aria-describedby="category-dialog-description"
        onClose={() => setDetailKey(null)}
        onCancel={() => setDetailKey(null)}
      >
        {selectedCategory ? <div className={styles.categoryDialogShell}>
          <header className={styles.categoryDialogHead}>
            <div><p className={styles.kicker}>СОСТАВ КАТЕГОРИИ</p><h2 className={styles.categoryDialogTitle} id="category-dialog-title">{selectedCategory.name}</h2><p className={styles.categoryDialogDescription} id="category-dialog-description">Дисциплины по каждой выбранной программе и подтверждённой версии учебного плана.</p></div>
            <button className={styles.categoryDialogClose} type="button" aria-label="Закрыть подробности категории" onClick={() => dialogRef.current?.close()}>×</button>
          </header>
          <div className={styles.categoryDialogGrid}>
            {data.curriculum.programs.map((program, index) => {
              const workload = selectedCategory.workloads.get(program.programKey);
              const programData = data.programs.find((candidate) => candidate.external_key === program.programKey);
              const items = workload?.items ?? [];
              return <section className={styles.categoryDialogColumn} key={program.programKey} style={{ "--category-color": SERIES_COLORS[index % SERIES_COLORS.length] } as CSSProperties}>
                <header className={styles.categoryDialogColumnHead}><span className={styles.categoryDialogDirectionCode}>{programData?.code || "Код не указан"}</span><h3 className={styles.categoryDialogDirection}>{programData?.directionName || programData?.directionCode || "Направление не указано"}</h3><p className={styles.categoryDialogProgram}>{programData?.name || "Название не указано"}</p><span className={styles.categoryDialogTotal}>{items.length ? formatMetric(workload?.hours ?? { value: 0, count: 0 }, "ч.") + " · " + items.length + " дисциплин" : "Дисциплин нет в выбранной категории"}</span></header>
                {items.length ? <ul className={styles.categoryDialogSubjects}>{items.map((item) => <li key={item.externalKey}><strong className={styles.categoryDialogSubjectName}>{item.displayName}</strong><span className={styles.categoryDialogSubjectMeta}>{item.semester === null ? "Семестр не указан" : String(item.semester) + " семестр"} · {item.hours === null ? "часы не указаны" : new Intl.NumberFormat("ru-RU").format(item.hours) + " ч."}{item.assessmentType ? " · " + item.assessmentType : ""}</span></li>)}</ul> : <p className={styles.categoryDialogEmpty}>{planStatusMessage(program)}</p>}
              </section>;
            })}
          </div>
        </div> : null}
      </dialog>
    </section>
  );
}
function MatrixCourseEntry({ item }: { item: ComparisonCurriculumItem }) {
  const category = item.classification?.categoryName ?? "Категория не указана";
  const details = [
    item.semester === null ? "Семестр не указан" : `${item.semester} семестр`,
    item.credits === null ? null : `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(item.credits)} з.е.`,
    item.hours === null ? null : `${new Intl.NumberFormat("ru-RU").format(item.hours)} ч.`,
    item.assessmentType,
  ].filter((value): value is string => Boolean(value));
  return <div className={styles.courseEntry}><span className={styles.courseCategory}>{category}</span><span className={styles.courseMeta}>{details.join(" · ")}</span></div>;
}

function MatrixMissingCell({ program }: { program: ProgramComparisonModel }) {
  const status = program.itemsStatus === "unavailable" ? "Состав плана недоступен"
    : program.planSelection.status === "ready" ? "Нет позиции с таким названием в подтверждённом плане"
      : program.planSelection.status === "ambiguous" ? "Версия учебного плана не сопоставлена"
        : program.planSelection.status === "needs-review" ? "Текущая версия требует проверки"
          : "Учебный план не опубликован";
  return <span className={styles.matrixMissing}>{status}</span>;
}

function CurriculumMatrix({ data }: { data: LoadedProgramComparison }) {
  const [query, setQuery] = useState("");
  const [semester, setSemester] = useState("");
  const [category, setCategory] = useState("");
  const semesterOptions = useMemo(() => [...new Set(data.curriculum.matrixRows.flatMap((row) => (
    [...row.itemsByProgram.values()].flat().map((item) => item.semesterKey)
  )))].sort((left, right) => {
    if (left === "unknown") return right === "unknown" ? 0 : 1;
    if (right === "unknown") return -1;
    return Number(left) - Number(right);
  }), [data.curriculum.matrixRows]);
  const categoryOptions = useMemo(() => [...new Set(data.curriculum.matrixRows.flatMap((row) => (
    [...row.itemsByProgram.values()].flat().map((item) => item.classification?.categoryName ?? "Категория не указана")
  )))].sort((left, right) => left.localeCompare(right, "ru")), [data.curriculum.matrixRows]);
  const visibleRows = data.curriculum.matrixRows.filter((row) => {
    const items = [...row.itemsByProgram.values()].flat();
    const text = [row.title, ...items.map((item) => item.classification?.categoryName ?? "")].join(" ").toLocaleLowerCase("ru-RU");
    if (query.trim() && !text.includes(query.trim().toLocaleLowerCase("ru-RU"))) return false;
    if (semester && !items.some((item) => item.semesterKey === semester)) return false;
    if (category && !items.some((item) => (item.classification?.categoryName ?? "Категория не указана") === category)) return false;
    return true;
  });

  return (
    <section className={styles.section} aria-labelledby="matrix-title">
      <div className={styles.sectionHeading}><div><p className={styles.kicker}>ДИСЦИПЛИНЫ</p><h2 id="matrix-title">Матрица предметов</h2><p>{data.curriculum.matrixRows.length} названий · совпадения по названию используются только для отображения.</p></div></div>
      <details className={styles.matrixDetails}>
        <summary>Открыть таблицу и фильтры</summary>
        <p className={styles.matrixIdentityNote}>{data.curriculum.matrixIdentityNote} Категория без подтверждённой таксономии остаётся «не указана».</p>
        <div className={styles.matrixControls}>
          <label className={styles.matrixField} htmlFor="curriculum-search"><span>Найти дисциплину или категорию</span><input id="curriculum-search" type="search" placeholder="Например, алгоритмы" value={query} onChange={(event) => setQuery(event.currentTarget.value)} /></label>
          <label className={styles.matrixField} htmlFor="curriculum-semester"><span>Семестр</span><select id="curriculum-semester" value={semester} onChange={(event) => setSemester(event.currentTarget.value)}><option value="">Все семестры</option>{semesterOptions.map((value) => <option key={value} value={value}>{value === "unknown" ? "Семестр не указан" : `${value} семестр`}</option>)}</select></label>
          <label className={styles.matrixField} htmlFor="curriculum-category"><span>Категория</span><select id="curriculum-category" value={category} onChange={(event) => setCategory(event.currentTarget.value)}><option value="">Все категории</option>{categoryOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        </div>
        <p className={styles.matrixResult} aria-live="polite">Показано {visibleRows.length} из {data.curriculum.matrixRows.length} названий.</p>
        <p className={styles.tableNote}>Под каждой дисциплиной указаны программа, семестр и нагрузка.</p>
        <div className={styles.tableWrap}>
          <table className={`${styles.table} ${styles.matrixTable}`}>
            <caption className={styles.srOnly}>Матрица дисциплин по выбранным образовательным программам.</caption>
            <thead><tr><th scope="col">Дисциплина</th>{data.programs.map((program) => <th scope="col" key={program.external_key}><span className={styles.programCode}>{program.code}</span><span className={styles.programName}>{program.name}</span></th>)}</tr></thead>
            <tbody>{visibleRows.length ? visibleRows.map((row) => (
              <tr key={row.visualKey}>
                <th scope="row"><span className={styles.matrixTitle}>{row.title}</span>{row.itemsByProgram.size === data.programs.length ? <span className={styles.commonTag}>Название встречается во всех</span> : null}</th>
                {data.curriculum.programs.map((program) => {
                  const items = [...(row.itemsByProgram.get(program.programKey) ?? [])].sort((left, right) => (
                    (left.semester ?? Number.POSITIVE_INFINITY) - (right.semester ?? Number.POSITIVE_INFINITY)
                  ));
                  return <td key={program.programKey} data-program-label={data.programs.find((entry) => entry.external_key === program.programKey)?.code ?? program.programKey}>{items.length ? items.map((item, index) => <MatrixCourseEntry item={item} key={`${item.externalKey}:${index}`} />) : <MatrixMissingCell program={program} />}</td>;
                })}
              </tr>
            )) : <tr><td colSpan={data.programs.length + 1}>По этим фильтрам дисциплин нет.</td></tr>}</tbody>
          </table>
        </div>
        <p className={styles.matrixFootnote}>«Нет позиции с таким названием» формируется только для загруженного подтверждённого плана. При неоднозначной, непроверенной или недоступной версии отсутствие не выводится.</p>
      </details>
    </section>
  );
}

function CurriculumStatus({ data }: { data: LoadedProgramComparison }) {
  const unavailable = data.curriculum.programs.filter((program) => (
    program.planSelection.status !== "ready" || program.itemsStatus === "unavailable"
  ));
  if (!unavailable.length) return null;
  return (
    <section className={styles.section} aria-labelledby="plan-status-title">
      <div className={styles.sectionHeading}><div><p className={styles.kicker}>УЧЕБНЫЕ ПЛАНЫ</p><h2 id="plan-status-title">Статус данных</h2><p>Для непроверенных или неоднозначных версий таблица показывает причину и не подставляет прежний план.</p></div></div>
      <div className={styles.selectionList}>{unavailable.map((entry, index) => {
        const program = data.programs.find((candidate) => candidate.external_key === entry.programKey);
        return <article className={styles.selectionCard} key={entry.programKey} style={{ "--program-color": SERIES_COLORS[index % SERIES_COLORS.length] } as CSSProperties}><div className={styles.selectionCopy}><span>{program?.code ?? entry.programKey}</span><strong>{planStatusMessage(entry)}</strong></div></article>;
      })}</div>
    </section>
  );
}

export default function CompareRoute() {
  const selectedKeys = useComparisonSelection();
  const selectionSignature = selectedKeys.join("\u001f");
  const [retryCount, setRetryCount] = useState(0);
  const signature = `${selectionSignature}\u001e${retryCount}`;
  const [loadState, setLoadState] = useState<ComparisonLoadState | null>(null);
  const matchingState = loadState?.signature === signature ? loadState : null;

  useEffect(() => {
    if (!selectedKeys.length) return;
    const controller = new AbortController();
    const abortOnPageHide = () => controller.abort();
    const resumeOnPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setRetryCount((count) => count + 1);
    };
    window.addEventListener("pagehide", abortOnPageHide);
    window.addEventListener("beforeunload", abortOnPageHide);
    window.addEventListener("pageshow", resumeOnPageShow);
    loadProgramComparison(selectedKeys, controller.signal, (data) => {
      if (!controller.signal.aborted) setLoadState({ signature, kind: "preview", data });
    }, (data) => {
      if (!controller.signal.aborted) setLoadState({ signature, kind: "selection", data });
    }).then((data) => {
      if (controller.signal.aborted) return;
      setLoadState({ signature, kind: "ready", data });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      controller.abort();
      const releaseChanged = error instanceof AcademicReleaseMismatchError;
      const message = releaseChanged
        ? "Во время загрузки активный академический выпуск изменился. Обновите страницу, чтобы сравнение использовало единые данные."
        : "Не удалось загрузить программы и учебные планы из FastAPI. Проверьте соединение и повторите попытку.";
      setLoadState({ signature, kind: "error", message, recovery: releaseChanged ? "reload" : "retry" });
    }).finally(() => window.removeEventListener("beforeunload", abortOnPageHide));
    return () => {
      window.removeEventListener("pagehide", abortOnPageHide);
      window.removeEventListener("beforeunload", abortOnPageHide);
      window.removeEventListener("pageshow", resumeOnPageShow);
      controller.abort();
    };
  }, [retryCount, selectedKeys, signature]);

  const data = matchingState?.kind === "ready" ? matchingState.data : null;
  const overview = matchingState?.kind === "preview" || matchingState?.kind === "ready" ? matchingState.data : null;
  const selectedData = matchingState && matchingState.kind !== "error" ? matchingState.data : null;
  const error = matchingState?.kind === "error" ? matchingState.message : null;
  const recovery = matchingState?.kind === "error" ? matchingState.recovery : "retry";
  const isLoading = Boolean(selectedKeys.length && (!matchingState || matchingState.kind === "selection"));

  const comparison = (
    <div className={styles.page} style={{ "--comparison-count": selectedData?.programs.length || Math.min(selectedKeys.length, 3) || 3 } as CSSProperties}>
      <AndromedaHeader />
      <main className={styles.main}>
        <section className={styles.intro} aria-labelledby="compare-title">
          <div className={styles.introCopy}>
            <h1 className={styles.title} id="compare-title">Сравни программы</h1>
            <p className={styles.description}>Как поступить, что изучать и какая будет нагрузка. Все выбранные программы — в одном сравнении.</p>
          </div>
          <div className={styles.count}><strong>{selectedKeys.length} / 3</strong><span>программ выбрано</span></div>
        </section>

        {selectedKeys.length ? <SelectionCards selectedKeys={selectedKeys} data={selectedData} /> : null}
        {!selectedKeys.length ? (
          <section className={styles.state}>
            <h2>Добавь программы для сравнения</h2>
            <p>В каталоге отметь до трёх профилей кнопкой «Сравнить». Выбор сохранится в этом браузере.</p>
            <Link className={`${styles.button} ${styles.buttonBlue}`} to="/programs">Открыть каталог</Link>
          </section>
        ) : null}
        {isLoading ? <ComparisonSkeleton /> : null}
        {error ? <section className={`${styles.state} ${styles.error}`} role="alert"><h2>Сравнение временно недоступно</h2><p>{error}</p><button className={`${styles.button} ${styles.buttonBlue}`} type="button" onClick={() => recovery === "reload" ? window.location.reload() : setRetryCount((value) => value + 1)}>{recovery === "reload" ? "Обновить страницу" : "Повторить загрузку"}</button></section> : null}
        {overview && overview.programs.length === 0 && overview.invalidSelectionKeys.length > 0 ? <section className={`${styles.state} ${styles.error}`} role="alert"><h2>Выбор отсутствует в активном выпуске</h2><p>Удалите сохранённые ключи из списка выше и выберите программы заново.</p></section> : null}
        {overview && overview.programs.length > 0 ? (
          <>
            {overview.invalidSelectionKeys.length ? <p className={styles.warning}>Некоторые сохранённые ключи не найдены в активном выпуске. Они показаны выше и исключены из академических данных.</p> : null}
            <AdmissionComparison data={overview} />
            {overview.admissionUnavailable.size ? <div className={styles.retryNotice} role="status"><p>Условия приёма для части программ не загрузились. Это ошибка соединения, а не отсутствие данных.</p><button className={styles.button} type="button" onClick={() => setRetryCount((value) => value + 1)}>Повторить загрузку</button></div> : null}
            {!data ? <ComparisonSkeleton curriculumOnly /> : null}
          </>
        ) : null}
        {data && data.programs.length > 0 ? (
          <>
            <CurriculumStatus data={data} />
            <CategoryComparison data={data} />
            <WorkloadChart data={data} />
            <CurriculumMatrix data={data} />
            <p className={styles.releaseNote} data-qa="active-release-note">Активный академический выпуск: <code data-qa="active-release-key">{data.releaseKey}</code>. Все таблицы и планы сверены с этим ключом.</p>
          </>
        ) : null}
      </main>
    </div>
  );

  return __ANDROMEDA_REACT_PROFILE__
    ? <Profiler id="comparison" onRender={recordComparisonProfile}>{comparison}</Profiler>
    : comparison;
}

function ComparisonSkeleton({ curriculumOnly = false }: { curriculumOnly?: boolean }) {
  return <section id="curriculum-loading" className={styles.loading} role="status" aria-busy="true">
    <div><p className={styles.kicker}>{curriculumOnly ? "Учебные планы" : "Сравнение программ"}</p><h2>{curriculumOnly ? "Загружаем дисциплины и нагрузку" : "Собираем данные для сравнения"}</h2><p>{curriculumOnly ? "Условия поступления уже можно смотреть. Состав учебных планов появится здесь." : "Сверяем программы, условия поступления и версии учебных планов."}</p></div>
    <div className={styles.skeletonGrid} aria-hidden="true">{[0, 1, 2].map((index) => <div key={index}><span /><span /><span /></div>)}</div>
  </section>;
}
