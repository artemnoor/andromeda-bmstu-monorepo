import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { trackEvent } from "@/shared/analytics/analytics";
import { Link, useRevalidator, useRouteError, useSearchParams } from "react-router";
import type { ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/programs";
import { AndromedaHeader } from "@/widgets/andromeda-navigation/andromeda-header";
import { AcademicReleaseMismatchError, loadCatalog } from "@/shared/api/client";
import { buildCatalogSearchIndex, filterPrograms, getCatalogOptions, normalizeCatalogProgram, russianPlural } from "@/features/catalog/model";
import { ProgramList } from "@/features/catalog/program-list";
import { CatalogSearch } from "@/features/catalog/catalog-search";
import styles from "@/features/catalog/programs.module.css";
import feedbackStyles from "@/features/catalog/feedback.module.css";
import { pageMeta } from "@/shared/seo";
import { useHydrated } from "@/shared/browser-state/hooks";

async function catalogData(request: Request) {
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

// Build-time HTML includes real catalog content; browser loads still refresh the active release.
export async function loader({ request }: Route.LoaderArgs) {
  return catalogData(request);
}

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  return catalogData(request);
}
clientLoader.hydrate = true as const;

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
  return pageMeta("/programs");
}

export default function ProgramsRoute({ loaderData }: Route.ComponentProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const hydrated = useHydrated();
  const [feedback, setFeedback] = useState("");
  const query = hydrated ? searchParams.get("q") ?? searchParams.get("code") ?? "" : "";
  const directionCode = hydrated ? searchParams.get("direction") ?? "" : "";
  const departmentCode = hydrated ? searchParams.get("department") ?? "" : "";
  const options = useMemo(() => getCatalogOptions(loaderData.programs), [loaderData.programs]);
  const searchIndex = useMemo(() => buildCatalogSearchIndex(loaderData.programs), [loaderData.programs]);
  const filteredPrograms = useMemo(() => filterPrograms(loaderData.programs, {
    query,
    directionCode,
    departmentCode,
  }, searchIndex), [loaderData.programs, searchIndex, query, directionCode, departmentCode]);
  const displayedPrograms = useDeferredValue(filteredPrograms);
  useEffect(() => {
    const timer = window.setTimeout(() => trackEvent("catalog_results_viewed", {
      has_search: Boolean(query.trim()), search_length: query.trim().length,
      has_direction_filter: Boolean(directionCode), has_department_filter: Boolean(departmentCode),
      result_count: filteredPrograms.length,
    }), 600);
    return () => window.clearTimeout(timer);
  }, [query, directionCode, departmentCode, filteredPrograms.length]);

  function setFilters(updates: Partial<{ q: string; direction: string; department: string }>) {
    const next = new URLSearchParams(searchParams);
    for (const [name, value] of Object.entries(updates)) {
      if (value) next.set(name, value);
      else next.delete(name);
    }
    if ("q" in updates) next.delete("code");
    setSearchParams(next, { replace: true, preventScrollReset: true });
    setFeedback("");
  }

  function resetFilters() {
    setSearchParams(new URLSearchParams(), { replace: true, preventScrollReset: true });
    setFeedback("");
    document.getElementById("program-search")?.focus();
  }

  return (
    <div className={styles.page}>
      <AndromedaHeader />
      <main className={styles.main}>
        <section className={styles.hero} aria-labelledby="catalog-title">
          <div className={styles.heroCopy}>
            <h1 className={styles.heroTitle} id="catalog-title" aria-label="Каталог программ">Каталог<br /><em>программ</em></h1>
            <p className={styles.heroDescription}>Бакалавриат и специалитет — все образовательные программы университета в одном месте.</p>
          </div>
          <div className={styles.heroStats} aria-label="Состав каталога">
            <div className={styles.primaryStat}>
              <div><span className={styles.statLabel}>В каталоге</span><strong>{loaderData.programs.length}</strong><span className={styles.statUnit}>{russianPlural(loaderData.programs.length, ["программа", "программы", "программ"])}</span></div>
              <svg className={styles.orbit} viewBox="0 0 160 160" aria-hidden="true">
                <ellipse cx="80" cy="80" rx="65" ry="27" transform="rotate(-34 80 80)" />
                <ellipse cx="80" cy="80" rx="65" ry="27" transform="rotate(34 80 80)" />
                <circle className={styles.orbitCore} cx="80" cy="80" r="5" />
              </svg>
            </div>
            <div className={styles.secondaryStats}>
              <div><strong>{options.directions.length}</strong><span>{russianPlural(options.directions.length, ["направление", "направления", "направлений"])}</span></div>
              <div><strong>{options.departments.length}</strong><span>{russianPlural(options.departments.length, ["кафедра", "кафедры", "кафедр"])}</span></div>
            </div>
          </div>
        </section>

        <section className={styles.catalogPanel} aria-labelledby="catalog-list-title">
          <div className={styles.toolbarHeading}>
            <h2 className={styles.sectionTitle} id="catalog-list-title">Все программы</h2>
          </div>

          <CatalogSearch
            programs={loaderData.programs}
            filters={{ q: query, direction: directionCode, department: departmentCode }}
            onChange={setFilters}
            onReset={resetFilters}
          />

          <p className={feedback ? feedbackStyles.feedback : styles.srOnly} role="status" aria-live="polite">{feedback}</p>
          <ProgramList programs={displayedPrograms} expectedReleaseKey={loaderData.release.release_key} onSelectionLimit={setFeedback} />

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
  const error = useRouteError();
  const revalidator = useRevalidator();
  const releaseChanged = error instanceof AcademicReleaseMismatchError;
  const pending = revalidator.state === "loading";
  return (
    <div className={styles.page}>
      <AndromedaHeader />
      <main className={styles.main}>
        <section className={styles.state} role="alert">
          <h1>{releaseChanged ? "Каталог обновился" : "Каталог временно недоступен"}</h1>
          <p>{releaseChanged
            ? "Опубликован новый академический выпуск. Обновите страницу, чтобы получить согласованные данные. Сохранённый выбор программ останется."
            : "Не получилось загрузить программы. Проверьте соединение и повторите попытку."}</p>
          <div className={styles.stateActions}>
            <button className={styles.retryAdmission} type="button" disabled={pending} onClick={() => {
              if (releaseChanged) window.location.reload();
              else void revalidator.revalidate();
            }}>{pending ? "Загружаем…" : releaseChanged ? "Обновить страницу" : "Повторить загрузку"}</button>
            <Link viewTransition className={styles.programLink} to="/">На главную</Link>
          </div>
        </section>
      </main>
    </div>
  );
}
