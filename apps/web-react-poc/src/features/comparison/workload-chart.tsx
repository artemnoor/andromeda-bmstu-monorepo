import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import type { CSSProperties } from "react";
import type { LoadedProgramComparison } from "./api";
import { ProgramIdentity } from "@/features/catalog/program-identity";
import { formatMetric, SERIES_COLORS } from "./presentation";
import styles from "./comparison.module.css";

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

export default function WorkloadChart({ data }: { data: LoadedProgramComparison }) {
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
          {data.programs.map((program, index) => <span className={styles.legendItem} key={program.external_key}><span className={styles.legendDot} style={{ "--series-color": SERIES_COLORS[index % SERIES_COLORS.length] } as CSSProperties} aria-hidden="true" /><ProgramIdentity program={program} /></span>)}
        </div>
        {chartData.length ? (
          <div className={styles.workloadChart} role="group" aria-label="Сравнение нагрузки по семестрам">
            <ResponsiveContainer width="100%" height={chartHeight}>
              <BarChart accessibilityLayer data={chartData} layout="vertical" margin={{ left: 0, right: 16, top: 8, bottom: 8 }} barGap={4} barCategoryGap="22%">
                <YAxis dataKey="semester" type="category" tickLine={false} tickMargin={10} axisLine={false} width={132} interval={0} tick={{ fill: "var(--text-muted)", fontSize: 11 }} />
                <XAxis type="number" domain={[0, "dataMax"]} hide />
                <Tooltip cursor={false} content={WorkloadTooltip} />
                {data.programs.map((program, index) => (
                  <Bar isAnimationActive={false} key={program.external_key} dataKey={`series-${index}`} name={program.code || program.name} fill={SERIES_COLORS[index % SERIES_COLORS.length]} radius={5} maxBarSize={16} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <p className={styles.workloadEmpty}>В выбранных программах нет доступных данных о семестрах.</p>}
      </div>
    </section>
  );
}
