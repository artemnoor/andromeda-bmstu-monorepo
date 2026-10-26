import { memo, useState, type CSSProperties } from "react";
import { comparisonPreview } from "./comparison-preview-data";
import comparisonStyles from "@/features/comparison/comparison.module.css";
import styles from "./comparison-showcase.module.css";

function wrapLabel(value: string) {
  const lines: string[] = [];
  for (const word of value.split(/\s+/)) {
    const last = lines.length - 1;
    if (last < 0 || ((lines[last] ?? "") + " " + word).length > 16) lines.push(word);
    else lines[last] += " " + word;
  }
  return lines.length > 3 ? [lines[0], lines[1], (lines[2]?.slice(0, 13) ?? "") + "…"] : lines;
}

function HoursPreview() {
  const [activeKey, setActiveKey] = useState(comparisonPreview.activeCategory);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const selectedName = comparisonPreview.programs.flatMap(program => program.segments).find(segment => segment.key === activeKey)?.name ?? "";
  return <div><div className={styles.chartGrid}>
    {comparisonPreview.programs.map(program => {
      const active = program.segments.find(segment => segment.key === activeKey);
      return <article className={comparisonStyles.categoryCard} key={program.key} data-qa="category-chart-card" data-program-key={program.key} data-total-hours={program.totalHours}>
        <header className={comparisonStyles.chartCardHeader} style={{ "--program-color": program.color } as CSSProperties}>
          <span className={comparisonStyles.chartCardCode}>{program.code}</span>
          <h3 className={comparisonStyles.chartCardTitle}>{program.name}</h3>
          <p className={comparisonStyles.selectionDepartment}>
            <span className={styles.departmentFull}>{program.department}</span>
            <span className={styles.departmentShort}>{program.department.split(" · ")[0]}</span>
          </p>
        </header>
        <div className={comparisonStyles.chartCardContent}>
          <div className={comparisonStyles.donutWrap} role="group" aria-label={"Распределение программы " + program.code + " по категориям, " + program.totalHours + " ч."}>
            <svg className={comparisonStyles.donut} viewBox="0 0 190 190" aria-label="Доли учебных часов">
              <circle cx="95" cy="95" r="63" fill="none" stroke="#45484e" strokeWidth="22" />
              {program.segments.map(segment => <path key={segment.key}
                d={segment.key === activeKey || hoveredKey === program.key + segment.key ? segment.activePath : segment.path}
                fill={segment.color} className={comparisonStyles.donutSector}
                role="button" tabIndex={0} aria-label={segment.name + ": " + segment.hours + " ч., " + segment.percent}
                aria-pressed={segment.key === activeKey}
                onClick={() => setActiveKey(segment.key)}
                onMouseEnter={() => setHoveredKey(program.key + segment.key)}
                onMouseLeave={() => setHoveredKey(null)}
                onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setActiveKey(segment.key); } }}
              ><title>{segment.name}: {segment.hours} ч.</title></path>)}
            </svg>
            <div className={comparisonStyles.donutCenter} aria-live="polite">
              <strong className={comparisonStyles.donutCenterValue}>{active?.percent ?? "0%"}</strong>
              <span className={comparisonStyles.donutCenterLabel}>{wrapLabel(selectedName).map((line, index) => <span key={index}>{line}</span>)}</span>
            </div>
          </div>
        </div>
      </article>;
    })}
  </div><p className={styles.categoryCaption} aria-live="polite">{selectedName}</p></div>;
}

export default memo(HoursPreview);
