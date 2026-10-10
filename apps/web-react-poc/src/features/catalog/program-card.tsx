import { useState } from "react";
import { Link } from "react-router";
import { AdmissionDetails } from "./admission-details";
import type { CatalogProgram } from "./model";
import { comparisonSelection, favoritesSelection, useComparisonSelection, useFavorites } from "@/shared/browser-state/hooks";
import { MAX_COMPARE_PROGRAMS } from "@/shared/browser-state/storage";
import styles from "./programs.module.css";

function safeLinks(program: CatalogProgram): readonly { href: string; label: string }[] {
  const studyPlan = program.study_plan_url ? safeUrl(program.study_plan_url) : null;
  const source = program.sourceUrl ? safeUrl(program.sourceUrl) : null;
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

export function ProgramCard({ program, onSelectionLimit }: {
  program: CatalogProgram;
  onSelectionLimit: (message: string) => void;
}) {
  const comparison = useComparisonSelection();
  const favorites = useFavorites();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const key = program.external_key;
  const isCompared = comparison.includes(key);
  const isFavorite = favorites.includes(key);
  const externalLinks = safeLinks(program);
  const direction = [program.directionCode, program.directionName].filter(Boolean).join(" · ");
  const department = program.departments.length > 0
    ? program.departments.map((item) => [item.code, item.name].filter(Boolean).join(" · ")).join(", ")
    : program.departmentStatus === "unresolved" ? "Связь не подтверждена" : "";

  function toggleComparison() {
    if (!isCompared && comparison.length >= MAX_COMPARE_PROGRAMS) {
      onSelectionLimit("Можно сравнить не более трёх программ. Удалите одну из выбранных или очистите список сравнения.");
      return;
    }
    const status = comparisonSelection.toggle(key, !isCompared);
    onSelectionLimit(status === "unavailable"
      ? "Браузер не сохранил сравнение. Разрешите localStorage и попробуйте снова."
      : "");
  }

  function toggleFavorite() {
    const status = favoritesSelection.toggle(key, !isFavorite);
    onSelectionLimit(status === "unavailable"
      ? "Браузер не сохранил избранное. Разрешите localStorage и попробуйте снова."
      : "");
  }

  return (
    <article className={styles.programCard} data-program-code={program.code} data-program-key={program.external_key}>
      <div className={styles.cardTop}>
        <span className={styles.programCode} title={program.code}>{program.code || "Код не указан"}</span>
        <div className={styles.cardActions}>
          <button
            className={styles.cardAction}
            type="button"
            aria-pressed={isCompared}
            onClick={toggleComparison}
          >
            {isCompared ? "✓ В сравнении" : "+ Сравнить"}
          </button>
        </div>
      </div>

      <details className={styles.programDetails} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
        <summary className={styles.programSummary}>
          <h2 className={styles.programTitle}>{program.name || "Название не указано"}</h2>
          {program.description ? <p className={styles.programDescription}>{program.description}</p> : null}
          {direction || department ? (
            <span className={styles.programFacts}>
              {direction ? <span className={styles.programFact}><span className={styles.factLabel}>Направление</span><span className={styles.factValue}>{direction}</span></span> : null}
              {department ? <span className={styles.programFact}><span className={styles.factLabel}>Кафедра</span><span className={styles.factValue}>{department}</span></span> : null}
            </span>
          ) : null}
          <span className={styles.expandHint}>Открыть места, баллы и условия поступления</span>
        </summary>
        {detailsOpen ? (
          <>
            <AdmissionDetails program={program} />
            <div className={styles.favoriteTools}>
              <button className={styles.favoriteAction} type="button" aria-pressed={isFavorite} onClick={toggleFavorite}>
                {isFavorite ? "♥ Убрать из избранного" : "♡ Добавить в избранное"}
              </button>
            </div>
          </>
        ) : null}
      </details>

      <footer className={styles.cardBottom}>
        <span className={styles.campusTag}>МГТУ · Москва</span>
        <div className={styles.cardLinks}>
          {externalLinks.length ? externalLinks.map((externalLink) => (
            <a key={`${externalLink.label}:${externalLink.href}`} className={styles.programLink} href={externalLink.href} target="_blank" rel="noopener noreferrer">
              {externalLink.label}<span className={styles.linkArrow} aria-hidden="true">↗</span>
            </a>
          )) : <span className={styles.campusTag}>Источник не указан</span>}
          {isCompared ? <Link className={styles.programLink} to="/compare">Перейти к сравнению</Link> : null}
        </div>
      </footer>
    </article>
  );
}
