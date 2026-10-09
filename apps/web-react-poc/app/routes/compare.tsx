import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { AndromedaHeader } from "@/widgets/andromeda-navigation/andromeda-header";
import { useComparisonSelection } from "@/shared/browser-state/hooks";
import { comparisonSelection } from "@/shared/browser-state/hooks";
import { loadProgramComparison, type LoadedProgramComparison } from "@/features/comparison/api";
import { buildDonutSegments } from "@/features/comparison/chart-data";
import type { CategoryWorkload, ComparisonCurriculumItem, NullableMetric, ProgramComparisonModel } from "@/features/comparison/model";
import type { AdmissionCampaignResult, AdmissionMetric, AdmissionSummary } from "@/features/catalog/admission-model";
import { AcademicReleaseMismatchError } from "@/shared/api/client";
import styles from "@/features/comparison/comparison.module.css";

type ComparisonLoadState =
  | { readonly signature: string; readonly kind: "ready"; readonly data: LoadedProgramComparison }
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
  if (!summary) return <OverviewValue value="Сведения о приёме недоступны" />;
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
  if (!summary) return <OverviewValue value="Сведения о приёме недоступны" />;
  const metric: AdmissionMetric | undefined = summary.seats[index];
  if (!metric) return <OverviewValue value="Не указано" />;
  return <OverviewValue value={metric.value} note={metric.note ?? `Уровень данных: ${summary.seatScope}`} sourceUrl={metric.sourceUrl} />;
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
  if (!summary) return <OverviewValue value="Сведения о приёме недоступны" />;
  const result = latestNumericCampaignResult(summary, { funding, stage: "main", competitionTypes });
  if (result?.score !== null && result?.score !== undefined) {
    const contest = funding === "budget" ? "бюджет · основной конкурс КЦП" : "платное · общий конкурс";
    return <OverviewValue value={scoreText(result.score)} note={`${contest} · ${result.scopeNote} · список зачисленных · ${result.year}`} sourceUrl={result.sourceUrl} />;
  }
  if (fallbackToPaidHistory) {
    const historical = summary.history.find((item) => item.funding === "Платное" && item.minimum !== "—");
    if (historical) {
      return <OverviewValue value={`${historical.minimum} баллов`} note={`платное · минимум зачисленных · ${historical.year} · ${summary.historyScope}`} sourceUrl={historical.sourceUrl} />;
    }
  }
  return <OverviewValue value="Нет данных" note={`Числовой балл ${funding === "budget" ? "бюджетного" : "платного"} конкурса не опубликован для приёма ${summary.year ?? ""}.`} />;
}

function QuotaScoreOverview({ summary }: { summary: AdmissionSummary | undefined }) {
  if (!summary) return <OverviewValue value="Сведения о приёме недоступны" />;
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
  data: LoadedProgramComparison | null;
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

function AdmissionComparison({ data }: { data: LoadedProgramComparison }) {
  const years = [...new Set([...data.admission.values()].flatMap((summary) => summary.year === null ? [] : [summary.year]))];
  const yearLabel = years.length === 1 ? String(years[0]) : years.length ? years.join(" / ") : "год не указан";
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
        : <OverviewValue value={summary ? "Нет данных" : "Сведения о приёме недоступны"} note="Минимальные баллы не найдены в архиве." />,
    },
    {
      label: "Форма и срок обучения",
      value: (_key, summary) => <StudyOfferOverview summary={summary} />,
    },
  ];

  return (
    <section className={styles.section} aria-labelledby="admission-title">
      <div className={styles.sectionHeading}>
        <div><p className={styles.kicker}>ПРИЁМ {yearLabel} · СПИСКИ ЗАЧИСЛЕННЫХ И АРХИВ</p><h2 id="admission-title">Места и проходные баллы</h2><p>Места и результаты взяты из архива. Проходной балл — минимум в опубликованном списке зачисленных; год и конкурсный уровень указаны под значением.</p></div>
      </div>
      <p className={styles.tableNote}>Сравни до трёх программ: на узком экране прокручивай таблицу по горизонтали.</p>
      <div className={styles.tableWrap}>
        <table className={`${styles.table} ${styles.comparisonTable}`}>
          <caption className={styles.srOnly}>Сравнение мест и условий приёма в выбранные программы.</caption>
          <thead><tr><th scope="col">Показатель</th>{data.programs.map((program) => <th scope="col" key={program.external_key}><div className={styles.programHead}><span className={styles.programCode}>{program.code}</span><h3 className={styles.programName}>{program.name}</h3></div></th>)}</tr></thead>
          <tbody>{rows.map((row) => <tr key={row.label}><th scope="row">{row.label}</th>{data.programs.map((program) => <td key={program.external_key}>{row.value(program.external_key, data.admission.get(program.external_key))}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

function WorkloadChart({ data }: { data: LoadedProgramComparison }) {
  const [metricKey, setMetricKey] = useState<"credits" | "hours">("credits");
  const unit = metricKey === "credits" ? "з.е." : "ч.";
  const semesters = [...new Map(data.curriculum.programs.flatMap((program) => program.semesters).map((semester) => [semester.key, semester])).values()]
    .sort((left, right) => {
      if (left.semester === null) return right.semester === null ? 0 : 1;
      if (right.semester === null) return -1;
      return left.semester - right.semester;
    });
  const maximum = Math.max(0, ...data.curriculum.programs.flatMap((program) => program.semesters.map((semester) => semester[metricKey].value)));

  return (
    <section className={styles.section} aria-labelledby="workload-title">
      <div className={styles.sectionHeading}>
        <div><p className={styles.kicker}>НАГРУЗКА</p><h2 id="workload-title">По семестрам</h2><p>Общие горизонтальные шкалы помогают сравнить нагрузку в одном и том же семестре.</p></div>
      </div>
      <details className={styles.workloadDetails}>
        <summary>Показать сравнение по {semesters.length} семестрам</summary>
        <div className={styles.workloadPanel}>
          <div className={styles.panelHead}>
            <div><strong>Выбери единицу измерения</strong><p>Учитываются дисциплины с числовым значением; справа показана точная сумма.</p></div>
            <div className={styles.metricSwitch} role="group" aria-label="Единица нагрузки">
              <button type="button" aria-pressed={metricKey === "credits"} onClick={() => setMetricKey("credits")}>Зачётные единицы</button>
              <button type="button" aria-pressed={metricKey === "hours"} onClick={() => setMetricKey("hours")}>Часы</button>
            </div>
          </div>
          <div className={styles.workloadLegend}>
            {data.programs.map((program, index) => <span className={styles.legendItem} key={program.external_key}><span className={styles.legendDot} style={{ "--series-color": SERIES_COLORS[index % SERIES_COLORS.length] } as CSSProperties} aria-hidden="true" /><strong>{program.code || program.name}</strong></span>)}
          </div>
          <div className={styles.workloadChart} role="group" aria-label="Сравнение нагрузки по семестрам">
            {semesters.length ? semesters.map((semester) => (
              <div className={styles.workloadRow} key={semester.key}>
                <strong className={styles.workloadTerm}>{semester.semester === null ? "Семестр не указан" : `${semester.semester} семестр`}</strong>
                <div className={styles.seriesGrid} style={{ "--series-count": data.programs.length } as CSSProperties}>
                  {data.curriculum.programs.map((program, index) => {
                    const value = program.semesters.find((item) => item.key === semester.key)?.[metricKey];
                    const hasValue = (value?.count ?? 0) > 0;
                    const width = maximum > 0 && value ? Math.min(100, (value.value / maximum) * 100) : 0;
                    const label = data.programs[index]?.code || program.programKey;
                    return (
                      <div className={styles.series} key={program.programKey} role="group" aria-label={`${label}: ${value && value.count > 0 ? formatMetric(value, unit) : "нет числовых данных"}`}>
                        <span className={styles.seriesCode}>{label}</span>
                        {hasValue ? <span className={styles.track} aria-hidden="true"><span className={styles.fill} style={{ "--series-color": SERIES_COLORS[index % SERIES_COLORS.length], "--bar-width": `${width}%` } as CSSProperties} /></span> : <span className={styles.emptyMetric}>Нет данных</span>}
                        <span className={styles.workloadValue}>{hasValue && value ? formatMetric(value, unit) : "—"}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )) : <p className={styles.workloadFootnote}>В выбранных программах нет доступных данных о семестрах.</p>}
            <p className={styles.workloadFootnote}>Длина полосы показывает сумму относительно максимума в выбранных программах и семестрах.</p>
          </div>
        </div>
      </details>
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

function percentage(value: number, total: number, hasData: boolean): string {
  if (!hasData || total <= 0) return "—";
  if (value === 0) return "0%";
  const rounded = Math.round(value / total * 100);
  return rounded < 1 ? "<1%" : String(rounded) + "%";
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

  function activate(event: KeyboardEvent<SVGCircleElement>, categoryKey: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(categoryKey);
    }
  }

  return (
    <article
      className={styles.categoryCard}
      data-program-key={program.programKey}
      data-plan-key={program.planSelection.currentPlan?.external_key ?? ""}
    >
      <header className={styles.categoryProgramHead} style={{ "--program-color": SERIES_COLORS[programIndex % SERIES_COLORS.length] } as CSSProperties}>
        <div className={styles.categoryProgramCopy}>
          <span className={styles.categoryProgramCode}>{programCode || "Код не указан"}</span>
          <h3 className={styles.categoryProgramName}>{programName}</h3>
        </div>
        <div className={styles.categoryProgramTotal}>
          <strong>{total.count ? formatMetric(total, "ч.") : "—"}</strong>
          <span>{program.categories.filter((category) => category.hours.count > 0 && category.categoryCode !== null).length}/{categories.filter((category) => category.categoryCode !== null).length} категорий в плане</span>
        </div>
      </header>
      <div className={styles.donutLayout}>
        <div className={styles.donutWrap}>
          <svg className={styles.donut} viewBox="0 0 220 220" role="group" aria-label={"Распределение программы " + (programCode || programName) + " по категориям" + (total.count ? ", " + formatMetric(total, "ч.") : "")}>
            <circle className={styles.donutTrack} cx="110" cy="110" r="75" />
            {segments.map(({ category, value, length, offset }) => (
              <circle
                key={category.key}
                className={styles.donutSegment + (activeKey && activeKey !== category.key ? " " + styles.donutSegmentDimmed : "") + (activeKey === category.key ? " " + styles.donutSegmentActive : "")}
                data-chart-category-code={category.categoryCode ?? "unclassified"}
                cx="110" cy="110" r="75"
                strokeDasharray={String(Math.min(circumference, Math.max(.7, length - .4))) + " " + String(circumference - length)}
                strokeDashoffset={-offset}
                transform="rotate(-90 110 110)"
                style={{ "--category-color": category.color } as CSSProperties}
                role="button"
                tabIndex={0}
                aria-label={category.name + ": " + formatMetric(value, "ч.") + ", " + percentage(value.value, total.value, true)}
                aria-pressed={activeKey === category.key}
                onClick={() => onSelect(category.key)}
                onKeyDown={(event) => activate(event, category.key)}
              />
            ))}
          </svg>
          <div className={styles.donutCenter} aria-live="polite">
            <strong>{percentage(activeValue, total.value, hasActiveValue && total.count > 0)}</strong>
            <span>{activeCategory?.name ?? (total.count ? "Выберите категорию" : "Нет числовых данных")}</span>
          </div>
        </div>
      </div>
      {program.items.length > 0 && program.total.hours.count < program.items.length
        ? <p className={styles.categoryFootnote}>Для части дисциплин часы не указаны. Доли рассчитаны по опубликованным значениям.</p>
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
  const overallHours = data.curriculum.programs.reduce((sum, program) => sum + program.total.hours.value, 0);
  const totalHourCount = data.curriculum.programs.reduce((sum, program) => sum + program.total.hours.count, 0);
  const taxonomyCategoryCount = data.curriculum.taxonomyCategories.length;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (detailKey && !dialog.open) dialog.showModal();
    else if (!detailKey && dialog.open) dialog.close();
  }, [detailKey]);

  return (
    <section className={styles.section} aria-labelledby="category-title">
      <div className={styles.categoryBoard}>
        <header className={styles.categoryHead}>
          <div>
            <p className={styles.kicker}>СТРУКТУРА УЧЕБНЫХ ПЛАНОВ</p>
            <h2 className={styles.categoryTitle} id="category-title">Куда уходит учебное время</h2>
            <p className={styles.categoryCopy}>Сектора показывают долю учебных часов в каждой предметной категории.</p>
            <span className={styles.categoryCount}>В классификаторе: {new Intl.NumberFormat("ru-RU").format(taxonomyCategoryCount)} категорий</span>
          </div>
          <div className={styles.categoryTotal}>
            <strong>{totalHourCount ? formatMetric({ value: overallHours, count: totalHourCount }, "ч.") : "—"}</strong>
            <span>суммарно по выбранным программам</span>
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
              <p className={styles.kicker}>ОБЩАЯ ЛЕГЕНДА</p>
              <h3 className={styles.categorySharedTitle} id="category-shared-title">Одна категория — один цвет</h3>
              <p className={styles.categorySharedCopy}>Нажмите на категорию, чтобы выделить её на всех диаграммах и сравнить дисциплины.</p>
            </div>
            <button className={styles.categoryReset} type="button" onClick={() => setActiveKey(defaultCategoryKey)}>Сбросить выбор</button>
          </div>
          <div className={styles.categorySharedGrid}>
            {categories.map((category) => (
              <div className={styles.categorySharedItem + (selectedCategoryKey === category.key ? " " + styles.categorySharedItemActive : "")} key={category.key} data-qa="category-legend-item" data-category={category.name} style={{ "--category-color": category.color } as CSSProperties}>
                <button className={styles.categorySharedSelect + (selectedCategoryKey && selectedCategoryKey !== category.key ? " " + styles.categorySharedSelectDimmed : "")} type="button" aria-pressed={selectedCategoryKey === category.key} onClick={() => setActiveKey(category.key)}>
                  <span className={styles.categorySharedDot} aria-hidden="true" />
                  <span className={styles.categorySharedName}>{category.name}</span>
                  <span className={styles.categorySharedValues} data-qa="category-legend-values">
                    {data.curriculum.programs.map((program) => {
                      const workload = category.workloads.get(program.programKey);
                      const complete = classificationIsComplete(program, data.taxonomyUnavailable);
                      const knownZero = !workload && complete && program.total.hours.count > 0;
                      const hasValue = Boolean(workload?.hours.count) || knownZero;
                      const value = workload?.hours.value ?? 0;
                      const total = program.total.hours.value;
                      const label = data.programs.find((candidate) => candidate.external_key === program.programKey)?.code || "Программа";
                      const numericMetric = { value, count: workload?.hours.count ?? (knownZero ? 1 : 0) };
                      const unknownLabel = workload ? "Для категории не указаны числовые часы" : "Для категории нет подтверждённых дисциплин";
                      return <span key={program.programKey} data-program-code={label} data-semantic-state={hasValue ? "known" : "unknown"} aria-label={hasValue ? undefined : `${label}: ${unknownLabel}`} title={hasValue ? undefined : unknownLabel}><strong>{label}</strong> · {hasValue ? formatMetric(numericMetric, "ч.") : "—"} · {hasValue ? percentage(value, total, true) : "—"}</span>;
                    })}
                  </span>
                </button>
                <button className={styles.categoryDetailsTrigger} type="button" aria-label={"Подробнее о категории «" + category.name + "»"} onClick={() => { setActiveKey(category.key); setDetailKey(category.key); }}>Подробнее</button>
              </div>
            ))}
          </div>
        </section>
        <section className={styles.categoryDistribution} aria-labelledby="category-distribution-title">
          <div className={styles.categoryDistributionHeading}>
            <div><p className={styles.kicker}>СОПОСТАВЛЕНИЕ ДОЛЕЙ</p><h3 id="category-distribution-title">Часы по категориям</h3></div>
            <p className={styles.categoryDistributionNote}>Все категории классификатора видны в таблице. Доли рассчитаны по опубликованным часам.</p>
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
        <p className={styles.tableNote}>На узком экране прокручивайте таблицу по горизонтали.</p>
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
                  return <td key={program.programKey}>{items.length ? items.map((item, index) => <MatrixCourseEntry item={item} key={`${item.externalKey}:${index}`} />) : <MatrixMissingCell program={program} />}</td>;
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
  const signature = selectedKeys.join("\u001f");
  const [retryCount, setRetryCount] = useState(0);
  const [loadState, setLoadState] = useState<ComparisonLoadState | null>(null);
  const matchingState = loadState?.signature === signature ? loadState : null;

  useEffect(() => {
    if (!signature) return;
    const controller = new AbortController();
    loadProgramComparison(selectedKeys, controller.signal).then((data) => {
      setLoadState({ signature, kind: "ready", data });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      const releaseChanged = error instanceof AcademicReleaseMismatchError;
      const message = releaseChanged
        ? "Во время загрузки активный академический выпуск изменился. Обновите страницу, чтобы сравнение использовало единые данные."
        : "Не удалось загрузить программы и учебные планы из FastAPI. Проверьте соединение и повторите попытку.";
      setLoadState({ signature, kind: "error", message, recovery: releaseChanged ? "reload" : "retry" });
    });
    return () => controller.abort();
  }, [retryCount, selectedKeys, signature]);

  const data = matchingState?.kind === "ready" ? matchingState.data : null;
  const error = matchingState?.kind === "error" ? matchingState.message : null;
  const recovery = matchingState?.kind === "error" ? matchingState.recovery : "retry";
  const isLoading = Boolean(signature && !matchingState);

  return (
    <div className={styles.page}>
      <AndromedaHeader />
      <main className={styles.main}>
        <section className={styles.intro} aria-labelledby="compare-title">
          <div className={styles.introCopy}>
            <h1 className={styles.title} id="compare-title">Сравни программы</h1>
            <p className={styles.description}>Места, проходные баллы и условия поступления — рядом. Сопоставь бюджетные и платные места и историю зачисления.</p>
          </div>
          <div className={styles.count}><strong>{selectedKeys.length} / 3</strong><span>программ выбрано</span></div>
        </section>

        {data ? <SelectionCards selectedKeys={selectedKeys} data={data} /> : signature ? <SelectionCards selectedKeys={selectedKeys} data={null} /> : null}
        {!signature ? (
          <section className={styles.state}>
            <h2>Добавь программы для сравнения</h2>
            <p>В каталоге отметь до трёх профилей кнопкой «Сравнить». Выбор сохранится в этом браузере.</p>
            <Link className={`${styles.button} ${styles.buttonBlue}`} to="/programs">Открыть каталог</Link>
          </section>
        ) : null}
        {isLoading ? <section className={styles.state} role="status" aria-busy="true"><h2>Готовим сравнение</h2><p>Проверяем активный выпуск, версии учебных планов и условия приёма.</p></section> : null}
        {error ? <section className={`${styles.state} ${styles.error}`} role="alert"><h2>Сравнение временно недоступно</h2><p>{error}</p><button className={`${styles.button} ${styles.buttonBlue}`} type="button" onClick={() => recovery === "reload" ? window.location.reload() : setRetryCount((value) => value + 1)}>{recovery === "reload" ? "Обновить страницу" : "Повторить загрузку"}</button></section> : null}
        {data && data.programs.length === 0 && data.invalidSelectionKeys.length > 0 ? <section className={`${styles.state} ${styles.error}`} role="alert"><h2>Выбор отсутствует в активном выпуске</h2><p>Удалите сохранённые ключи из списка выше и выберите программы заново.</p></section> : null}
        {data && data.programs.length > 0 ? (
          <>
            {data.invalidSelectionKeys.length ? <p className={styles.warning}>Некоторые сохранённые ключи не найдены в активном выпуске. Они показаны выше и исключены из академических данных.</p> : null}
            <AdmissionComparison data={data} />
            <CurriculumStatus data={data} />
            <WorkloadChart data={data} />
            <CategoryComparison data={data} />
            <CurriculumMatrix data={data} />
            <p className={styles.releaseNote}>Активный академический выпуск: <code>{data.releaseKey}</code>. Все таблицы и планы сверены с этим ключом.</p>
          </>
        ) : null}
      </main>
    </div>
  );
}
