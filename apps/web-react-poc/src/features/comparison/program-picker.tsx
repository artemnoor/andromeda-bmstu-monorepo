import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { loadCatalog } from "@/shared/api/client";
import { buildCatalogSearchIndex, filterPrograms, normalizeCatalogProgram, type CatalogProgram } from "@/features/catalog/model";
import { programDepartment } from "@/features/catalog/program-identity";
import { MAX_COMPARE_PROGRAMS, type StorageStatus } from "@/shared/browser-state/storage";
import { showComparisonLimitNotice } from "@/shared/ui/comparison-limit-notice";
import { trackEvent } from "@/shared/analytics/analytics";
import styles from "./program-picker.module.css";
import catalogStyles from "@/features/catalog/catalog-search.module.css";

type CatalogState = { kind: "loading" } | { kind: "error" } | { kind: "ready"; programs: readonly CatalogProgram[] };
const noPrograms: readonly CatalogProgram[] = [];

export function ProgramPicker({ selectedKeys, onSelectionChange }: {
  selectedKeys: readonly string[];
  onSelectionChange: (keys: readonly string[]) => StorageStatus;
}) {
  const [catalog, setCatalog] = useState<CatalogState>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const container = useRef<HTMLElement>(null);
  const results = useRef<HTMLUListElement>(null);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadCatalog(controller.signal).then((snapshot) => {
      if (controller.signal.aborted) return;
      const directions = new Map(snapshot.directions.items.map((entry) => [entry.external_key, entry]));
      const departments = new Map(snapshot.departments.items.map((entry) => [entry.external_key, entry]));
      setCatalog({ kind: "ready", programs: snapshot.programs.items.map((program) => normalizeCatalogProgram(program, directions, departments)) });
    }).catch(() => {
      if (!controller.signal.aborted) {
        setCatalog({ kind: "error" });
        trackEvent("comparison_search_load_failed");
      }
    });
    return () => controller.abort();
  }, [retry]);

  const programs = catalog.kind === "ready" ? catalog.programs : noPrograms;
  const searchIndex = useMemo(() => buildCatalogSearchIndex(programs), [programs]);
  const matches = useMemo(() => filterPrograms(programs, { query: deferredQuery }, searchIndex), [programs, deferredQuery, searchIndex]);
  const suggestions = matches.slice(0, 7);
  useEffect(() => {
    if (!open || catalog.kind !== "ready" || !deferredQuery.trim()) return;
    const timer = setTimeout(() => trackEvent("comparison_search_used", { search_length: deferredQuery.trim().length, result_count: matches.length }), 600);
    return () => clearTimeout(timer);
  }, [open, catalog.kind, deferredQuery, matches.length]);
  const isSelected = (program: CatalogProgram) => selectedKeys.includes(program.external_key) || selectedKeys.includes(program.code);

  function addProgram(program: CatalogProgram) {
    if (isSelected(program)) return;
    if (selectedKeys.length >= MAX_COMPARE_PROGRAMS) {
      showComparisonLimitNotice();
      return;
    }
    const status = onSelectionChange([...selectedKeys, program.external_key]);
    if (status === "available") trackEvent("comparison_search_selected", { program_key: program.external_key });
    setMessage(status === "unavailable" ? "Не удалось сохранить выбор в браузере. Сохраните ссылку на сравнение." : `Добавлена программа «${program.name}».`);
  }

  return <section ref={container} className={styles.picker} aria-labelledby="compare-add-title">
    <div className={styles.heading}><label id="compare-add-title" htmlFor="compare-program-search">Добавить программу</label><span>{selectedKeys.length} / {MAX_COMPARE_PROGRAMS}</span></div>
    <div className={catalogStyles.searchArea}>
    <div className={catalogStyles.searchBox}>
      <svg className={catalogStyles.searchIcon} viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.6" /><path d="m15.5 15.5 4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      <div className={catalogStyles.inputWrap}><input id="compare-program-search" type="search" placeholder="Название, код или кафедра" autoComplete="off" value={query} ref={input} aria-describedby="compare-search-hint" aria-controls={open ? "compare-search-results" : undefined} onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setOpen(true); setMessage(""); }} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
        if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); results.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(); }
      }} /></div>
      {query ? <button type="button" className={catalogStyles.clear} aria-label="Очистить поиск программ" onClick={() => { setQuery(""); input.current?.focus(); }}><X size={22} aria-hidden="true" /></button> : null}
    </div>
    {open ? <div className={`${catalogStyles.suggestions} ${styles.results}`} id="compare-search-results">
      {catalog.kind === "loading" ? <p className={styles.status} role="status">Загружаем каталог…</p> : null}
      {catalog.kind === "error" ? <div className={styles.status} role="alert"><p>Не удалось загрузить каталог.</p><button type="button" onClick={() => { setCatalog({ kind: "loading" }); setRetry((value) => value + 1); }}>Повторить загрузку</button></div> : null}
      {catalog.kind === "ready" ? <>
        <p className={styles.resultHeading}>{deferredQuery.trim() ? `Найдено программ: ${matches.length}` : "Программы из каталога"}{matches.length > suggestions.length ? <span>Показаны первые {suggestions.length}. Уточните запрос.</span> : null}</p>
        <ul ref={results} className={styles.list} onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); input.current?.focus(); setOpen(false); return; }
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          event.preventDefault();
          const next = index + (event.key === "ArrowDown" ? 1 : -1);
          if (next < 0) input.current?.focus();
          else buttons[Math.min(next, buttons.length - 1)]?.focus();
        }}>
          {suggestions.map((program) => <li key={program.external_key}><button type="button" disabled={isSelected(program)} className={styles.result} aria-label={isSelected(program) ? `${program.name} — уже в сравнении` : `Добавить: ${program.name}, ${program.code}`} onClick={() => addProgram(program)}>
            <span className={styles.identity}><span className={styles.code}>{program.code} <span>{program.directionCode}</span></span><strong>{program.name}</strong><small>{programDepartment(program)}</small></span><span className={styles.action}>{isSelected(program) ? <><Check size={17} aria-hidden="true" /><span>В сравнении</span></> : <><Plus size={18} aria-hidden="true" /><span>Добавить</span></>}</span>
          </button></li>)}
        </ul>
        {!matches.length ? <p className={styles.status}>Ничего не найдено. Попробуйте другое название, код или кафедру.</p> : null}
      </> : null}
    </div> : null}
    </div>
    <p className={styles.hint} id="compare-search-hint">Найдите программу и добавьте её в сравнение — до трёх одновременно.</p>
    <p className={styles.feedback} role="status" aria-live="polite">{message}</p>
  </section>;
}
