import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/programs";
import { AndromedaHeader } from "@/widgets/andromeda-navigation/andromeda-header";
import { useComparisonSelection } from "@/shared/browser-state/hooks";
import { loadCatalog } from "@/shared/api/client";
import { buildCatalogSearchIndex, filterPrograms, getCatalogOptions, normalizeCatalogProgram, russianPlural, type CatalogProgram } from "@/features/catalog/model";
import { ProgramCard } from "@/features/catalog/program-card";
import styles from "@/features/catalog/programs.module.css";
import feedbackStyles from "@/features/catalog/feedback.module.css";

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const snapshot = await loadCatalog(request.signal);
  const directions = new Map(snapshot.directions.items.map((item) => [item.external_key, item]));
  const departments = new Map(snapshot.departments.items.map((item) => [item.external_key, item]));
  const programs = snapshot.programs.items
    .map((program) => normalizeCatalogProgram(program, directions, departments));
  return {
    programs,
    release: snapshot.release,
  };
}

const catalogFilterParameters = new Set(["q", "code", "direction", "department"]);

/** Search/filter URL changes are applied to the already loaded catalog snapshot. */
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs): boolean {
  if (
    defaultShouldRevalidate
    && currentUrl.pathname === nextUrl.pathname
    && formMethod === undefined
  ) {
    const current = currentUrl.searchParams;
    const next = nextUrl.searchParams;
    const changedKeys = [...new Set([...current.keys(), ...next.keys()])].filter((key) => (
      current.getAll(key).join("\u0000") !== next.getAll(key).join("\u0000")
    ));
    if (changedKeys.length > 0 && changedKeys.every((key) => catalogFilterParameters.has(key))) return false;
  }
  return defaultShouldRevalidate;
}

export function meta() {
  return [
    { title: "Каталог образовательных программ — Andromeda × BMSTU" },
    { name: "description", content: "Каталог образовательных программ МГТУ с условиями поступления из активного академического выпуска." },
  ];
}

export default function ProgramsRoute({ loaderData }: Route.ComponentProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const comparison = useComparisonSelection();
  const [feedback, setFeedback] = useState("");
  const query = searchParams.get("q") ?? searchParams.get("code") ?? "";
  const directionCode = searchParams.get("direction") ?? "";
  const departmentCode = searchParams.get("department") ?? "";
  const options = useMemo(() => getCatalogOptions(loaderData.programs), [loaderData.programs]);
  const searchIndex = useMemo(() => buildCatalogSearchIndex(loaderData.programs), [loaderData.programs]);
  const filteredPrograms = useMemo(() => filterPrograms(loaderData.programs, {
    query,
    directionCode,
    departmentCode,
  }, searchIndex), [loaderData.programs, searchIndex, query, directionCode, departmentCode]);

  function setFilter(name: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(name, value);
    else next.delete(name);
    if (name === "q") next.delete("code");
    setSearchParams(next, { replace: true });
    setFeedback("");
  }

  function resetFilters() {
    setSearchParams(new URLSearchParams(), { replace: true });
    setFeedback("");
    document.getElementById("program-search")?.focus();
  }

  return (
    <div className={styles.page}>
      <AndromedaHeader />
      <main className={styles.main}>
        <section className={styles.hero} aria-labelledby="catalog-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}><span className={styles.heroIndex} aria-hidden="true">01</span> МГТУ имени Баумана · набор 2026</p>
            <h1 className={styles.heroTitle} id="catalog-title" aria-label="Каталог программ">Каталог<br /><em>программ</em></h1>
            <p className={styles.heroDescription}>Бакалавриат и специалитет — все образовательные программы университета в одном месте.</p>
          </div>
          <div className={styles.heroStats} aria-label="Состав каталога">
            <div className={styles.primaryStat}>
              <div><span className={styles.statLabel}>В каталоге</span><strong>{loaderData.programs.length}</strong><span className={styles.statUnit}>{russianPlural(loaderData.programs.length, ["программа", "программы", "программ"])}</span></div>
              <svg className={styles.orbit} viewBox="0 0 160 160" aria-hidden="true"><ellipse cx="80" cy="80" rx="65" ry="27" transform="rotate(-34 80 80)" /><ellipse cx="80" cy="80" rx="65" ry="27" transform="rotate(34 80 80)" /><circle cx="80" cy="80" r="5" /><circle cx="132" cy="48" r="3" /></svg>
            </div>
            <div className={styles.secondaryStats}>
              <div><strong>{options.directions.length}</strong><span>{russianPlural(options.directions.length, ["направление", "направления", "направлений"])}</span></div>
              <div><strong>{options.departments.length}</strong><span>{russianPlural(options.departments.length, ["кафедра", "кафедры", "кафедр"])}</span></div>
            </div>
          </div>
        </section>

        <section className={styles.catalogPanel} aria-labelledby="catalog-list-title">
          <div className={styles.toolbarHeading}>
            <div><p className={styles.microLabel}>Найди своё направление</p><h2 className={styles.sectionTitle} id="catalog-list-title">Все программы</h2></div>
            <span className={styles.resultCount} aria-live="polite">{filteredPrograms.length} {russianPlural(filteredPrograms.length, ["программа", "программы", "программ"])}</span>
          </div>

          <div className={styles.toolbar}>
            <label className={styles.searchField} htmlFor="program-search">
              <span className={styles.toolbarLabel}>Поиск по каталогу</span>
              <span className={styles.searchWrap}>
                <svg className={styles.searchIcon} viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="8.7" cy="8.7" r="5.7" stroke="currentColor" strokeWidth="1.5" /><path d="m13 13 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                <input id="program-search" className={styles.searchInput} type="search" autoComplete="off" placeholder="Название, код, направление…" value={query} onChange={(event) => setFilter("q", event.currentTarget.value)} />
              </span>
            </label>
            <label className={styles.filterField} htmlFor="direction-filter">
              <span className={styles.toolbarLabel}>Направление</span>
              <select id="direction-filter" className={styles.filterControl} value={directionCode} onChange={(event) => setFilter("direction", event.currentTarget.value)}>
                <option value="">Все направления</option>
                {options.directions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className={styles.filterField} htmlFor="department-filter">
              <span className={styles.toolbarLabel}>Кафедра</span>
              <select id="department-filter" className={styles.filterControl} value={departmentCode} onChange={(event) => setFilter("department", event.currentTarget.value)}>
                <option value="">Все кафедры</option>
                {options.departments.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <button className={styles.toolbarReset} type="button" onClick={resetFilters}><span aria-hidden="true">↺</span> Сбросить</button>
          </div>

          <p className={feedback ? feedbackStyles.feedback : styles.srOnly} role="status" aria-live="polite">{feedback}</p>
          {comparison.length > 0 ? (
            <div className={styles.compareBar}>
              <span>В сравнении {comparison.length} из 3 {russianPlural(comparison.length, ["программа", "программы", "программ"])}</span>
              <Link to="/compare">Открыть сравнение <span aria-hidden="true">↗</span></Link>
            </div>
          ) : null}

          <div className={styles.grid} aria-busy="false">
            {filteredPrograms.length === 0 ? (
              <div className={styles.state}>
                <h2>Ничего не нашлось</h2>
                <p>Измените поисковый запрос или сбросьте фильтры, чтобы увидеть другие программы.</p>
              </div>
            ) : filteredPrograms.map((program: CatalogProgram) => (
              <ProgramCard
                key={program.external_key}
                program={program}
                expectedReleaseKey={loaderData.release.release_key}
                onSelectionLimit={setFeedback}
              />
            ))}
          </div>

          <footer className={styles.footnote}>
            <span>Изучай программы и сверяй детали с учебными планами и документами университета.</span>
            <span className={styles.releaseNote} title={`Активный академический выпуск: ${loaderData.release.release_key}`}>МГТУ имени Баумана · 2026<span className={styles.srOnly}>. Активный академический выпуск {loaderData.release.release_key}</span></span>
          </footer>
        </section>
      </main>
    </div>
  );
}

export function ErrorBoundary() {
  return (
    <main className={styles.state} role="alert">
      <h1>Каталог временно недоступен</h1>
      <p>Не удалось получить программы из FastAPI или подтвердить единый академический выпуск. Обновите страницу и попробуйте ещё раз.</p>
      <Link to="/programs">Повторить загрузку</Link>
    </main>
  );
}
