import { useMemo, type CSSProperties, type KeyboardEvent } from "react";
import { Pie, PieChart, ResponsiveContainer, Sector, type PieSectorShapeProps } from "recharts";
import { buildDonutSegments } from "./chart-data";
import type { LoadedProgramComparison } from "./api";
import type { CategoryWorkload, ProgramComparisonModel } from "./model";
import { colorFor, formatMetric, SERIES_COLORS } from "./presentation";
import styles from "./comparison.module.css";

export interface ComparisonCategory {
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

export function percentage(value: number, total: number, hasData: boolean): string {
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

export function classificationIsComplete(program: ProgramComparisonModel, taxonomyUnavailable: boolean): boolean {
  return !taxonomyUnavailable
    && program.itemsStatus === "loaded"
    && program.items.length > 0
    && program.items.every((item) => item.classification !== null || Boolean(item.generalCategory));
}

export function CategoryChart({
  program,
  programCode,
  programName,
  department,
  programIndex,
  categories,
  activeKey,
  taxonomyUnavailable,
  onSelect,
}: {
  program: ProgramComparisonModel;
  programCode: string;
  programName: string;
  department: string;
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
        color: "#45484e",
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
        color: "#45484e",
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
        <p className={styles.selectionDepartment}>{department}</p>
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

export function buildComparisonCategories(data: LoadedProgramComparison): readonly ComparisonCategory[] {
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
}
