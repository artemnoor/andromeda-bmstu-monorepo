import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { getCatalogOptions } from "./model";
import type { CatalogProgram } from "./model";
import styles from "./catalog-search.module.css";

type Filters = { q: string; direction: string; department: string };
type Suggestion = { key: string; label: string; detail: string; kind: "Программа" | "Направление" | "Кафедра"; filters: Partial<Filters> };

function Highlight({ text, query }: { text: string; query: string }) {
  const start = text.toLocaleLowerCase("ru").indexOf(query.trim().toLocaleLowerCase("ru"));
  if (start < 0) return text;
  const end = start + query.trim().length;
  return <>{text.slice(0, start)}<mark>{text.slice(start, end)}</mark>{text.slice(end)}</>;
}

function CloseIcon() {
  return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
}

export function CatalogSearch({ programs, filters, onChange, onReset }: {
  programs: readonly CatalogProgram[];
  filters: Filters;
  onChange: (updates: Partial<Filters>) => void;
  onReset: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [filtersOpen, setFiltersOpen] = useState(Boolean(filters.direction || filters.department));
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const options = useMemo(() => getCatalogOptions(programs), [programs]);
  const query = filters.q.trim().toLocaleLowerCase("ru");
  const { direction, department } = filters;
  const suggestions = useMemo(() => {
    if (!query) return [];
    const result: Suggestion[] = [];
    for (const [kind, key, items] of [
      ["Кафедра", "department", options.departments],
      ["Направление", "direction", options.directions],
    ] as const) {
      for (const item of items.filter((item) => item.label.toLocaleLowerCase("ru").includes(query)).slice(0, 2)) {
        result.push({ key: `${key}:${item.value}`, label: item.label, detail: "Добавить фильтр", kind, filters: { q: "", [key]: item.value } });
      }
    }
    const seen = new Set<string>();
    const matchingPrograms = programs.filter((program) => {
      if (direction && program.directionCode !== direction) return false;
      if (department && !program.departments.some((item) => item.code === department)) return false;
      return [program.name, program.code].some((value) => value?.toLocaleLowerCase("ru").includes(query));
    });
    for (const program of matchingPrograms) {
      if (seen.has(program.name)) continue;
      seen.add(program.name);
      result.push({ key: program.external_key, label: program.name, detail: [program.code, program.departments.map((department) => department.code).filter(Boolean).join(", ")].filter(Boolean).join(" · "), kind: "Программа", filters: { q: program.name } });
      if (seen.size === 3) break;
    }
    return result.slice(0, 6);
  }, [query, options, programs, direction, department]);
  const showSuggestions = suggestionsOpen && query.length > 0 && suggestions.length > 0;
  const activeSuggestion = showSuggestions ? suggestions[active] : undefined;
  const filterCount = Number(Boolean(filters.direction)) + Number(Boolean(filters.department));
  const chips = [
    { key: "direction" as const, label: "Направление", value: filters.direction, options: options.directions },
    { key: "department" as const, label: "Кафедра", value: filters.department, options: options.departments },
  ].filter((chip) => chip.value);

  useEffect(() => {
    if (showSuggestions && active >= 0) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [showSuggestions, active, id]);

  function choose(suggestion: Suggestion) {
    onChange(suggestion.filters);
    setSuggestionsOpen(false);
    setActive(-1);
    input.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && suggestions.length > 0 && query) {
      event.preventDefault();
      setSuggestionsOpen(true);
      setActive((previous) => event.key === "ArrowDown" ? (previous + 1) % suggestions.length : (previous <= 0 ? suggestions.length - 1 : previous - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeSuggestion) choose(activeSuggestion);
      else { setSuggestionsOpen(false); input.current?.blur(); }
    } else if (event.key === "Escape") {
      setSuggestionsOpen(false);
      setActive(-1);
    }
  }

  return <div className={styles.panel} role="search" aria-label="Поиск программ">
    <div className={styles.searchRow}>
      <div className={styles.searchArea}>
        <div className={styles.searchBox}>
          <svg className={styles.searchIcon} viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.6" /><path d="m15.5 15.5 4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          <div className={styles.inputWrap}>
          <input ref={input} id="program-search" type="search" role="combobox" aria-label="Поиск по каталогу" aria-autocomplete="list" aria-expanded={showSuggestions} aria-controls={showSuggestions ? `${id}-suggestions` : undefined} aria-activedescendant={activeSuggestion ? `${id}-${active}` : undefined} aria-describedby={`${id}-hint`} autoComplete="off" enterKeyHint="search" placeholder="Название, код или кафедра" value={filters.q}
              onFocus={() => setSuggestionsOpen(true)} onBlur={() => { setSuggestionsOpen(false); setActive(-1); }}
              onChange={(event) => { onChange({ q: event.currentTarget.value }); setSuggestionsOpen(true); setActive(-1); }} onKeyDown={handleKeyDown} />
          </div>
          {filters.q && <button type="button" className={styles.clear} aria-label="Очистить поиск" onClick={() => { onChange({ q: "" }); setActive(-1); input.current?.focus(); }}><CloseIcon /></button>}
        </div>
        {showSuggestions && <div className={styles.suggestions}>
          <p className={styles.suggestionHeading}>Подсказки по каталогу <span>↑ ↓ для выбора</span></p>
          <ul id={`${id}-suggestions`} role="listbox" aria-label="Подсказки по каталогу">
            {suggestions.map((suggestion, index) => <li id={`${id}-${index}`} key={suggestion.key} role="option" aria-selected={active === index} className={styles.suggestion} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(suggestion)}>
              <span className={styles.suggestionKind}>{suggestion.kind}</span>
              <span className={styles.suggestionTitle}><Highlight text={suggestion.label} query={filters.q} /></span>
              <span className={styles.suggestionDetail}>{suggestion.detail}</span>
            </li>)}
          </ul>
        </div>}
      </div>
      <button type="button" className={styles.filterToggle} aria-expanded={filtersOpen} aria-controls={`${id}-filters`} onClick={() => { setFiltersOpen(!filtersOpen); setSuggestionsOpen(false); }}>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h7m5 0h4M4 17h3m5 0h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><circle cx="13.5" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.5" /><circle cx="9.5" cy="17" r="2.5" stroke="currentColor" strokeWidth="1.5" /></svg>
        Фильтры {filterCount > 0 && <span className={styles.badge}>{filterCount}</span>}
        <svg className={styles.chevron} data-open={filtersOpen} viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </div>
    <p className={styles.hint} id={`${id}-hint`}>Начни с интереса, названия или кода. Например: <button type="button" onClick={() => { onChange({ q: "информатика" }); setSuggestionsOpen(true); setActive(-1); input.current?.focus(); }}>информатика</button><span aria-hidden="true"> · </span><button type="button" onClick={() => { onChange({ q: "ИУ7" }); setSuggestionsOpen(true); setActive(-1); input.current?.focus(); }}>ИУ7</button></p>
    <div className={styles.filterReveal} data-open={filtersOpen} id={`${id}-filters`} inert={!filtersOpen}>
      <div className={styles.filterClip}>
        <div className={styles.filters} role="group" aria-label="Фильтры каталога">
          <div className={styles.filterIntro}><strong>Уточни выбор</strong><span>Можно выбрать один или оба фильтра</span></div>
          <label className={styles.filterField} htmlFor="direction-filter"><span>Направление</span><select id="direction-filter" value={filters.direction} onChange={(event) => onChange({ direction: event.currentTarget.value })}><option value="">Все направления</option>{options.directions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className={styles.filterField} htmlFor="department-filter"><span>Кафедра</span><select id="department-filter" value={filters.department} onChange={(event) => onChange({ department: event.currentTarget.value })}><option value="">Все кафедры</option>{options.departments.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <p className={styles.filterNote}>Результаты обновляются сразу</p>
        </div>
      </div>
    </div>
    {(filterCount > 0 || filters.q) && <div className={styles.selection}>
      {chips.map((chip) => <button type="button" key={`${chip.key}:${chip.value}`} className={styles.chip} aria-label={`Убрать фильтр ${chip.label}: ${chip.options.find((option) => option.value === chip.value)?.label ?? chip.value}`} onClick={() => onChange({ [chip.key]: "" })}><span><small>{chip.label}</small>{chip.options.find((option) => option.value === chip.value)?.label ?? chip.value}</span><CloseIcon /></button>)}
      <button type="button" className={styles.reset} onClick={() => { onReset(); setActive(-1); setSuggestionsOpen(false); }}>Сбросить всё</button>
    </div>}
  </div>;
}
