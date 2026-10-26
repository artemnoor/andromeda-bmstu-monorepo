import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { russianPlural } from "@/features/catalog/model";
import type { ProfTestData } from "./api";
import type { RankedCareerProfile } from "./model";
import { matchesProgramSearch } from "./presentation";
import { ComparisonMorph } from "@/shared/ui/comparison-morph";
import { programPath } from "@/features/catalog/program-path";
import styles from "./prof-test.module.css";

const PAGE_SIZE = 12;

export function ProgramResults({ data, ranked, hasSignal, comparisonKeys, onToggleComparison }: {
  readonly data: ProfTestData;
  readonly ranked: readonly RankedCareerProfile[];
  readonly hasSignal: boolean;
  readonly comparisonKeys: readonly string[];
  readonly onToggleComparison: (key: string, selected: boolean) => boolean | void;
}) {
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const listRef = useRef<HTMLUListElement>(null);
  const focusNextIndex = useRef<number | null>(null);
  useEffect(() => {
    if (focusNextIndex.current !== null) {
      listRef.current?.querySelectorAll<HTMLAnchorElement>("[data-program-result-link]")[focusNextIndex.current]?.focus();
      focusNextIndex.current = null;
    }
  }, [visibleCount]);
  const matches = useMemo(() => ranked.filter(({ profile }) => matchesProgramSearch(profile.program, query)), [ranked, query]);
  const unavailable = useMemo(() => {
    const included = new Set(ranked.map(({ profile }) => profile.program.external_key));
    return data.programs.filter((program) => !included.has(program.external_key) && matchesProgramSearch(program, query));
  }, [data.programs, ranked, query]);

  return (
    <section className={styles.allResults} aria-labelledby="all-results-title">
      <header className={styles.questionHeading}>
        <h3 id="all-results-title">Посмотри остальные программы</h3>
        <p>Здесь доступны все программы каталога. {hasSignal ? "Программы с учебным планом расположены по совпадению с ответами." : "Без выраженных предпочтений персональный порядок не рассчитывается."} Можно найти конкретное направление, код или кафедру.</p>
      </header>
      <label className={styles.searchLabel} htmlFor="prof-program-search">Найти программу в результатах</label>
      <input
        className={styles.programSearch}
        id="prof-program-search"
        type="search"
        placeholder="Например, робототехника, 09.03 или ИБМ"
        value={query}
        onChange={(event) => { focusNextIndex.current = null; setQuery(event.target.value); setVisibleCount(PAGE_SIZE); }}
      />
      <p className={styles.searchCount} role="status">Найдено: {matches.length + unavailable.length}. С учебным планом: {matches.length}; без оценки: {unavailable.length}.</p>
      {matches.length > 0 ? (
        <ul ref={listRef} className={styles.programList} aria-label="Все программы с учебными планами">
          {matches.slice(0, visibleCount).map(({ profile, score }) => {
            const program = profile.program;
            const selected = comparisonKeys.includes(program.external_key);
            return (
              <li className={styles.programRow} key={program.external_key}>
                <div className={styles.programRowCopy}>
                  <span>{program.code}{program.departmentCode ? ` · ${program.departmentCode}` : ""}</span>
                  <Link viewTransition data-program-result-link to={programPath(program)}>{program.name || "Образовательная программа"}</Link>
                  {program.directionName ? <small>{program.directionName}</small> : null}
                </div>
                <span className={styles.programRowScore}>{hasSignal ? <><strong>{Math.round(score)}</strong> / 100</> : "Без оценки"}</span>
                <ComparisonMorph selected={selected} label={`${selected ? "Убрать из сравнения" : "В сравнение"}: ${program.name || program.code}`} onToggle={() => onToggleComparison(program.external_key, selected)} />
              </li>
            );
          })}
        </ul>
      ) : null}
      {visibleCount < matches.length ? <button className={`${styles.button} ${styles.buttonSecondary} ${styles.showMore}`} type="button" onClick={() => { focusNextIndex.current = visibleCount; setVisibleCount((count) => count + PAGE_SIZE); }}>Показать ещё {Math.min(PAGE_SIZE, matches.length - visibleCount)} {russianPlural(Math.min(PAGE_SIZE, matches.length - visibleCount), ["программу", "программы", "программ"])}</button> : null}
      {unavailable.length > 0 ? (
        <details className={styles.unrankedResults} open={query.trim() ? true : undefined}>
          <summary>Без подтверждённого учебного плана · {unavailable.length}</summary>
          <p>Эти программы есть в каталоге, но для них пока нет доступного подтверждённого плана. Оценить совпадение по содержанию нельзя. Открой карточку, чтобы посмотреть опубликованные сведения.</p>
          <ul className={styles.programList} aria-label="Программы без оценки">
            {unavailable.map((program) => <li className={styles.programRow} key={program.external_key}><div className={styles.programRowCopy}><span>{program.code}</span><Link viewTransition to={programPath(program)}>{program.name || "Образовательная программа"}</Link></div><span className={styles.programRowScore}>Без оценки</span></li>)}
          </ul>
        </details>
      ) : null}
      {matches.length === 0 && unavailable.length === 0 ? <p className={styles.emptySearch}>Ничего не нашли. Попробуй часть названия, код направления или название кафедры.</p> : null}
    </section>
  );
}
