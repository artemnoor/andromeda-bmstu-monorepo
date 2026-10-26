import { memo } from "react";
import { Link, useLocation } from "react-router";
import { programPath } from "./program-path";
import type { CatalogProgram } from "./model";
import { comparisonSelection, useIsCompared } from "@/shared/browser-state/hooks";
import { getComparisonSnapshot, MAX_COMPARE_PROGRAMS } from "@/shared/browser-state/storage";
import { publicSourceUrl } from "@/shared/links/public-source-url";
import { ComparisonMorph } from "@/shared/ui/comparison-morph";
import styles from "./programs.module.css";

function safeLinks(program: CatalogProgram): readonly { href: string; label: string }[] {
  const studyPlan = program.study_plan_url ? safeUrl(program.study_plan_url) : null;
  const source = publicSourceUrl(program.sourceUrl);
  return [
    ...(studyPlan ? [{ href: studyPlan, label: "Учебный план" }] : []),
    ...(source && source !== studyPlan ? [{ href: source, label: "Источник" }] : []),
  ];
}

function safeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export const ProgramCard = memo(function ProgramCard({ program, onSelectionLimit }: {
  program: CatalogProgram;
  expectedReleaseKey: string;
  onSelectionLimit: (message: string) => void;
}) {
  const location = useLocation();
  const key = program.external_key;
  const isCompared = useIsCompared(key);
  const externalLinks = safeLinks(program);
  const direction = [program.directionCode, program.directionName].filter(Boolean).join(" · ");
  const department = program.departments.length > 0
    ? program.departments.map((item) => [item.code, item.name].filter(Boolean).join(" · ")).join(", ")
    : program.departmentStatus === "unresolved" ? "Связь не подтверждена" : "";

  function toggleComparison() {
    const comparison = getComparisonSnapshot();
    const selected = comparison.includes(key);
    if (!selected && comparison.length >= MAX_COMPARE_PROGRAMS) {
      onSelectionLimit("Можно сравнить не более трёх программ. Удалите одну из выбранных или очистите список сравнения.");
      return false;
    }
    const status = comparisonSelection.toggle(key, !selected);
    onSelectionLimit(status === "unavailable"
      ? "Браузер не сохранил сравнение. Разрешите localStorage и попробуйте снова."
      : "");
    return status !== "unavailable";
  }

  return (
    <article className={styles.programCard} data-program-code={program.code} data-program-key={program.external_key}>
      <div className={styles.cardTop}>
        <span className={styles.programCode} title={program.code}>{program.code || "Код не указан"}</span>
        <div className={styles.cardActions}>
          <ComparisonMorph selected={isCompared} onToggle={toggleComparison} />
        </div>
      </div>

      <div className={styles.programDetails}>
        <div className={styles.programSummary}>
          <h2 className={styles.programTitle}>{program.name || "Название не указано"}</h2>
          {program.description ? <p className={styles.programDescription}>{program.description}</p> : null}
          {direction || department ? (
            <span className={styles.programFacts}>
              {direction ? <span className={styles.programFact}><span className={styles.factLabel}>Направление</span><span className={styles.factValue}>{direction}</span></span> : null}
              {department ? <span className={styles.programFact}><span className={styles.factLabel}>Кафедра</span><span className={styles.factValue}>{department}</span></span> : null}
            </span>
          ) : null}
          <Link
            className={styles.detailsButton}
            to={programPath(program)}
            state={{ catalogSearch: location.search }}
            viewTransition
          >
            Подробнее ↗
          </Link>
        </div>
      </div>

      <footer className={styles.cardBottom}>
        <span className={styles.campusTag}>{program.campus_status === "verified" && program.campus_scope === "head_moscow"
          ? "МГТУ им. Н. Э. Баумана · Москва"
          : program.campus_status === "verified" && program.campus_scope === "other"
            ? "МГТУ им. Н. Э. Баумана · другой кампус"
            : "МГТУ им. Н. Э. Баумана · кампус не подтверждён"}</span>
        <div className={styles.cardLinks}>
          {externalLinks.length ? externalLinks.map((externalLink) => (
            <a key={`${externalLink.label}:${externalLink.href}`} className={styles.programLink} href={externalLink.href} target="_blank" rel="noopener noreferrer">
              {externalLink.label}
            </a>
          )) : <span className={styles.campusTag}>Источник не указан</span>}
        </div>
      </footer>
    </article>
  );
});
