import { lazy, Suspense, Profiler, useEffect, useMemo, useRef, useState, type CSSProperties, type ProfilerOnRenderCallback } from "react";
import { Link, useSearchParams } from "react-router";
import { ShareActions } from "@/shared/sharing/share-actions";
import { ScreenLoader } from "@/shared/ui/screen-loader";
import { absoluteLink, comparisonKeys, comparisonPath } from "@/shared/sharing/links";
import { comparisonReport } from "@/shared/sharing/report-model";
import { AndromedaHeader } from "@/widgets/andromeda-navigation/andromeda-header";
import { useComparisonSelection, useHydrated } from "@/shared/browser-state/hooks";
import { comparisonSelection } from "@/shared/browser-state/hooks";
import { loadProgramComparison, type ComparisonOverview, type ComparisonSelection, type LoadedProgramComparison } from "@/features/comparison/api";
import type { ProgramComparisonModel } from "@/features/comparison/model";
import { AdmissionEnrollmentTable, AdmissionExams, AdmissionScoreTable, AdmissionPlacesTable, ProgramEducationTable, AdmissionFreshness } from "@/features/catalog/admission-facts";
import { ProgramIdentity, programDepartment } from "@/features/catalog/program-identity";
import admissionStyles from "@/features/catalog/admission-facts.module.css";
import { AcademicReleaseMismatchError } from "@/shared/api/client";
import { CategoryChart, buildComparisonCategories, percentage, classificationIsComplete, type ComparisonCategory } from "@/features/comparison/category-chart";
import { MatrixCourseEntry, MatrixMissingCell } from "@/features/comparison/matrix-course-entry";
import { formatMetric, SERIES_COLORS } from "@/features/comparison/presentation";
import styles from "@/features/comparison/comparison.module.css";
import { pageMeta } from "@/shared/seo";
import { ProgramPicker } from "@/features/comparison/program-picker";
import { trackEvent } from "@/shared/analytics/analytics";

const WorkloadChart = lazy(() => import("@/features/comparison/workload-chart"));

export function meta() {
  return pageMeta("/compare");
}

type ComparisonLoadState =
  | { readonly signature: string; readonly kind: "ready"; readonly data: LoadedProgramComparison }
  | { readonly signature: string; readonly kind: "preview"; readonly data: ComparisonOverview }
  | { readonly signature: string; readonly kind: "selection"; readonly data: ComparisonSelection }
  | {
      readonly signature: string;
      readonly kind: "error";
      readonly message: string;
      readonly recovery: "retry" | "reload";
    };

const recordComparisonProfile: ProfilerOnRenderCallback = (
  id,
  phase,
  actualDuration,
  baseDuration,
  startTime,
  commitTime,
) => {
  const samples = window.__andromedaReactProfileSamples ??= [];
  samples.push({ id, phase, actualDuration, baseDuration, startTime, commitTime });
};

function planStatusMessage(program: ProgramComparisonModel): string {
  if (program.itemsStatus === "unavailable") return "Состав подтверждённого плана не удалось полностью загрузить.";
  if (program.planSelection.status !== "ready") {
    const gaps = program.planSelection.currentPlan?.data_gaps ?? [];
    if (gaps.some((gap) => gap.field_path === "study_plan_source_placeholder")) {
      return "В официальном источнике пока заглушка: «Учебный план появится позже».";
    }
    if (gaps.some((gap) => gap.field_path === "study_plan_profile_mismatch")) {
      return "Ссылка в каталоге ведёт на учебный план другого профиля. Его дисциплины не используются для этой программы.";
    }
    if (gaps.some((gap) => gap.field_path === "study_plan_no_downloadable_document")) {
      return "В папке по официальной ссылке пока нет файла учебного плана.";
    }
  }
  switch (program.planSelection.status) {
    case "ready": return program.items.length ? "Используется последняя однозначно подтверждённая версия." : "В доступной версии плана нет позиций.";
    case "missing": return "Учебный план не опубликован для этой программы.";
    case "ambiguous": return "Найдено несколько версий или год версии не указан; состав плана не сопоставлен.";
    case "needs-review": return "Актуальная версия или связь учебного плана требует проверки; старую версию не подставляем.";
  }
}

function SelectionCards({
  selectedKeys,
  data,
  onSelectionChange,
}: {
  selectedKeys: readonly string[];
  data: ComparisonSelection | null;
  onSelectionChange: (keys: readonly string[]) => ReturnType<typeof comparisonSelection.set>;
}) {
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const found = data?.programs ?? [];

  function saveSelection(nextKeys: readonly string[]) {
    setStorageUnavailable(onSelectionChange(nextKeys) === "unavailable");
  }

  function removeProgram(programKey: string, code: string) {
    const aliases = new Set([programKey, code]);
    saveSelection(selectedKeys.filter((key) => !aliases.has(key)));
  }

  return (
    <section className={styles.selection} aria-labelledby="selection-title">
      <div className={styles.selectionHead}>
        <div>
          <h2 id="selection-title">Выбранные программы</h2>
          <p className={styles.selectionCount}>{selectedKeys.length} из 3 можно сравнить одновременно</p>
        </div>
        <div className={styles.selectionActions}>
          <Link viewTransition className={styles.button} to="/programs">Изменить выбор</Link>
        </div>
      </div>
      {storageUnavailable ? <p className={styles.warning} role="alert">Не удалось сохранить выбор в браузере. Сохрани ссылку на сравнение, чтобы вернуться к нему.</p> : null}
      <div className={styles.selectionList}>
        {data === null ? selectedKeys.map((key) => <article className={`${styles.selectionCard} ${styles.selectionPlaceholder}`} key={`loading:${key}`} aria-hidden="true">
          <div><span /><span /><span /></div>
        </article>) : null}
        {found.map((program, index) => (
          <article className={styles.selectionCard} key={program.external_key} style={{ "--program-color": SERIES_COLORS[index % SERIES_COLORS.length] } as CSSProperties}>
            <div className={styles.selectionCopy}>
              <span>{program.code || "Код не указан"}</span>
              <strong>{program.name || "Название не указано"}</strong>
              <p className={styles.selectionDepartment}>{programDepartment(program)}</p>
            </div>
            <button className={styles.removeButton} type="button" aria-label={`Убрать программу ${program.code} из сравнения`} onClick={() => removeProgram(program.external_key, program.code)}>×</button>
          </article>
        ))}
        {data?.invalidSelectionKeys.map((key) => (
          <article className={styles.selectionCard} key={`missing:${key}`}>
            <div className={styles.selectionCopy}><span>Сохранённый ключ</span><strong>{key} · отсутствует в активном выпуске</strong></div>
            <button className={styles.removeButton} type="button" aria-label={`Убрать отсутствующий ключ ${key}`} onClick={() => saveSelection(selectedKeys.filter((entry) => entry !== key))}>×</button>
          </article>
        ))}
        {!selectedKeys.length ? <p className={styles.selectionEmpty}>Добавьте программы в каталоге, чтобы сравнить поступление и подтверждённые учебные планы.</p> : null}
      </div>
      {data === null && selectedKeys.length ? <p className={styles.srOnly} role="status">Загружаем выбранные программы…</p> : null}
    </section>
  );
}

function AdmissionComparison({ data }: { data: ComparisonOverview }) {
  const currentYears = [...new Set([...data.admission.values()].flatMap((summary) => summary.year === null ? [] : [summary.year]))];
  const years = currentYears.sort((a, b) => a - b);
  const columns = data.programs.map((program) => ({
    key: program.external_key,
    label: program.code || program.name,
    program,
    summary: data.admission.get(program.external_key),
  }));
  return (
    <section className={`${styles.section} ${admissionStyles.stack}`} id="admission" aria-labelledby="admission-title"
      data-qa="admission-summary" data-unavailable-count={data.admissionUnavailable.size}>
      <div className={styles.sectionHeading}><div><h2 id="admission-title">Поступление</h2></div></div>
      {years.map((year) => <AdmissionFreshness key={`freshness:${year}`} year={year} />)}
      <ProgramEducationTable columns={columns} />
      {years.map((year) => <AdmissionPlacesTable key={`places:${year}`} columns={columns} year={year} />)}
      {years.map((year) => <AdmissionEnrollmentTable key={`enrollment:${year}`} columns={columns} year={year} />)}
      {years.map((year) => <AdmissionScoreTable key={year} columns={columns} year={year} />)}
      {!years.length ? <p className={styles.warning}>Не удалось загрузить результаты приёма. Повторите загрузку.</p> : null}
      <div className={styles.sectionHeading}><div><h2>Необходимые экзамены</h2></div></div>
      <div className={admissionStyles.programExams}>{columns.map((column) => <section key={column.key}>
        <h3><ProgramIdentity program={column.program} /></h3><AdmissionExams summary={column.summary} />
      </section>)}</div>
    </section>
  );
}

function CategoryComparison({ data }: { data: LoadedProgramComparison }) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const categories = useMemo(() => buildComparisonCategories(data), [data]);
  const defaultCategoryKey = useMemo(() => {
    const aggregate = (category: ComparisonCategory) => [...category.workloads.values()]
      .reduce((sum, workload) => sum + workload.hours.value, 0);
    return [...categories]
      .filter((category) => category.categoryCode !== null)
      .sort((left, right) => aggregate(right) - aggregate(left))
      .find((category) => aggregate(category) > 0)?.key
      ?? categories[0]?.key
      ?? null;
  }, [categories]);
  const selectedCategoryKey = categories.some((category) => category.key === activeKey) ? activeKey : defaultCategoryKey;
  const selectedCategory = categories.find((category) => category.key === selectedCategoryKey) ?? null;
  const displayCategories = useMemo(() => [...categories].sort((left, right) => {
    const aggregate = (category: ComparisonCategory) => [...category.workloads.values()]
      .reduce((sum, workload) => sum + workload.hours.value, 0);
    return aggregate(right) - aggregate(left) || left.name.localeCompare(right.name, "ru");
  }), [categories]);
  const taxonomyCategoryCount = data.curriculum.taxonomyCategories.length;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (detailKey && !dialog.open) dialog.showModal();
    else if (!detailKey && dialog.open) dialog.close();
  }, [detailKey]);

  return (
    <section className={styles.section} id="curriculum" aria-labelledby="category-title">
      <div className={styles.categoryBoard}>
        <header className={styles.categoryHead}>
          <div>
            <h2 className={styles.categoryTitle} id="category-title">Куда уходит учебное время</h2>
            <p className={styles.categoryCopy}>Сектора показывают долю учебных часов в каждой предметной категории.</p>
            <span className={styles.categoryCount}>В классификаторе: {new Intl.NumberFormat("ru-RU").format(taxonomyCategoryCount)} категорий</span>
          </div>
        </header>
        {data.taxonomyUnavailable ? <p className={styles.warning}>Для этих классификаций не удалось подтвердить одну версию таксономии. Дисциплины сохранены в таблице, но сравнимые категории не рассчитываются.</p> : null}
        <div className={styles.categoryGrid}>
          {data.curriculum.programs.map((program, index) => (
            <CategoryChart
              key={program.programKey}
              program={program}
              programCode={data.programs.find((candidate) => candidate.external_key === program.programKey)?.code ?? ""}
              programName={data.programs.find((candidate) => candidate.external_key === program.programKey)?.name ?? "Программа"}
              department={(() => { const selected = data.programs.find((candidate) => candidate.external_key === program.programKey); return selected ? programDepartment(selected) : "Кафедра не подтверждена"; })()}
              programIndex={index}
              categories={categories}
              activeKey={selectedCategoryKey}
              taxonomyUnavailable={data.taxonomyUnavailable}
              onSelect={setActiveKey}
            />
          ))}
        </div>
        <section className={styles.categoryShared} aria-labelledby="category-shared-title">
          <div className={styles.categorySharedHead}>
            <div>
              <h3 className={styles.categorySharedTitle} id="category-shared-title">Одна категория — один цвет</h3>
              <p className={styles.categorySharedCopy}>Нажмите на категорию, чтобы выделить её на всех диаграммах и сравнить дисциплины.</p>
            </div>
          </div>
          <div className={styles.categorySharedGrid}>
            {categories.map((category) => (
              <div className={styles.categorySharedItem + (selectedCategoryKey === category.key ? " " + styles.categorySharedItemActive : "")} key={category.key} data-qa="category-legend-item" data-category={category.name} style={{ "--category-color": category.color } as CSSProperties}>
                <button className={styles.categorySharedSelect + (selectedCategoryKey && selectedCategoryKey !== category.key ? " " + styles.categorySharedSelectDimmed : "")} type="button" aria-pressed={selectedCategoryKey === category.key} onClick={() => setActiveKey(category.key)}>
                  <span className={styles.categorySharedDot} aria-hidden="true" />
                  <span className={styles.categorySharedName}>{category.name}</span>
                </button>
                <button className={styles.categoryDetailsTrigger} type="button" aria-label={"Подробнее о категории «" + category.name + "»"} onClick={() => { setActiveKey(category.key); setDetailKey(category.key); }}>Подробнее</button>
              </div>
            ))}
          </div>
        </section>
        <section className={styles.categoryDistribution} aria-labelledby="category-distribution-title">
          <div className={styles.categoryDistributionHeading}>
            <h3 id="category-distribution-title">Часы по категориям</h3>
          </div>
          <div className={styles.categoryDistributionWrap}>
            <table className={styles.table + " " + styles.categoryDistributionTable}>
              <caption className={styles.srOnly}>Сравнение учебных часов по категориям предметов.</caption>
              <thead><tr><th scope="col">Категория предмета</th>{data.programs.map((program) => <th scope="col" key={program.external_key}><ProgramIdentity program={program} /></th>)}</tr></thead>
              <tbody>{displayCategories.length ? displayCategories.map((category) => (
                <tr key={category.key} data-qa="category-distribution-row" data-category={category.name} style={{ "--category-color": category.color } as CSSProperties}>
                  <th scope="row"><span className={styles.categoryRowName}><span className={styles.categoryRowDot} aria-hidden="true" />{category.name}</span></th>
                  {data.curriculum.programs.map((program) => {
                    const workload = category.workloads.get(program.programKey);
                    const complete = classificationIsComplete(program, data.taxonomyUnavailable);
                    const knownZero = !workload && complete && program.total.hours.count > 0;
                    const hasValue = Boolean(workload?.hours.count) || knownZero;
                    const value = workload?.hours.value ?? 0;
                    const total = program.total.hours.value;
                    if (program.itemsStatus === "unavailable" || program.planSelection.status !== "ready") {
                      return <td key={program.programKey} data-program-code={data.programs.find((candidate) => candidate.external_key === program.programKey)?.code ?? ""}><span className={styles.categoryDistributionEmpty}>{planStatusMessage(program)}</span></td>;
                    }
                    if (!hasValue) {
                      const programCode = data.programs.find((candidate) => candidate.external_key === program.programKey)?.code ?? "";
                      const unknownLabel = workload ? "Для категории не указаны числовые часы" : "Для категории нет подтверждённых дисциплин";
                      return <td key={program.programKey} data-program-code={programCode} aria-label={`${category.name}, ${programCode}: ${unknownLabel}`}>
                        <div className={styles.categoryDistributionCell}>
                          <div className={styles.categoryDistributionValues}><strong data-semantic-state="unknown" title={unknownLabel}>—</strong><span>—</span></div>
                          <span className={styles.categoryDistributionTrack} aria-hidden="true"><span className={styles.categoryDistributionFill} style={{ "--bar-width": "0%" } as CSSProperties} /></span>
                        </div>
                      </td>;
                    }
                    const width = total > 0 ? Math.min(100, value / total * 100) : 0;
                    const numericMetric = { value, count: workload?.hours.count ?? (knownZero ? 1 : 0) };
                    return <td key={program.programKey} data-program-code={data.programs.find((candidate) => candidate.external_key === program.programKey)?.code ?? ""}>
                      <div className={styles.categoryDistributionCell}>
                        <div className={styles.categoryDistributionValues}><strong>{formatMetric(numericMetric, "ч.")}</strong><span>{percentage(value, total, true)}</span></div>
                        <span className={styles.categoryDistributionTrack} aria-hidden="true"><span className={styles.categoryDistributionFill} style={{ "--bar-width": String(width) + "%" } as CSSProperties} /></span>
                      </div>
                    </td>;
                  })}
                </tr>
              )) : <tr><td colSpan={data.programs.length + 1}>Категории не указаны в данных выбранных программ.</td></tr>}</tbody>
            </table>
          </div>
        </section>
      </div>
      <dialog
        ref={dialogRef}
        className={styles.categoryDialog}
        aria-labelledby="category-dialog-title"
        aria-describedby="category-dialog-description"
        onClose={() => setDetailKey(null)}
        onCancel={() => setDetailKey(null)}
      >
        {selectedCategory ? <div className={styles.categoryDialogShell}>
          <header className={styles.categoryDialogHead}>
            <div><p className={styles.kicker}>СОСТАВ КАТЕГОРИИ</p><h2 className={styles.categoryDialogTitle} id="category-dialog-title">{selectedCategory.name}</h2><p className={styles.categoryDialogDescription} id="category-dialog-description">Дисциплины по каждой выбранной программе и подтверждённой версии учебного плана.</p></div>
            <button className={styles.categoryDialogClose} type="button" aria-label="Закрыть подробности категории" onClick={() => dialogRef.current?.close()}>×</button>
          </header>
          <div className={styles.categoryDialogGrid}>
            {data.curriculum.programs.map((program, index) => {
              const workload = selectedCategory.workloads.get(program.programKey);
              const programData = data.programs.find((candidate) => candidate.external_key === program.programKey);
              const items = workload?.items ?? [];
              return <section className={styles.categoryDialogColumn} key={program.programKey} style={{ "--category-color": SERIES_COLORS[index % SERIES_COLORS.length] } as CSSProperties}>
                <header className={styles.categoryDialogColumnHead}><span className={styles.categoryDialogDirectionCode}>{programData?.code || "Код не указан"}</span><h3 className={styles.categoryDialogDirection}>{programData?.directionName || programData?.directionCode || "Направление не указано"}</h3><p className={styles.categoryDialogProgram}>{programData?.name || "Название не указано"}</p>{programData ? <p className={styles.selectionDepartment}>{programDepartment(programData)}</p> : null}<span className={styles.categoryDialogTotal}>{items.length ? formatMetric(workload?.hours ?? { value: 0, count: 0 }, "ч.") + " · " + items.length + " дисциплин" : "Дисциплин нет в выбранной категории"}</span></header>
                {items.length ? <ul className={styles.categoryDialogSubjects}>{items.map((item) => <li key={item.externalKey}><strong className={styles.categoryDialogSubjectName}>{item.displayName}</strong><span className={styles.categoryDialogSubjectMeta}>{item.semester === null ? "Семестр не указан" : String(item.semester) + " семестр"} · {item.hours === null ? "часы не указаны" : new Intl.NumberFormat("ru-RU").format(item.hours) + " ч."}{item.assessmentType ? " · " + item.assessmentType : ""}</span></li>)}</ul> : <p className={styles.categoryDialogEmpty}>{planStatusMessage(program)}</p>}
              </section>;
            })}
          </div>
        </div> : null}
      </dialog>
    </section>
  );
}
function CurriculumMatrix({ data }: { data: LoadedProgramComparison }) {
  const [query, setQuery] = useState("");
  const [semester, setSemester] = useState("");
  const [category, setCategory] = useState("");
  const semesterOptions = useMemo(() => [...new Set(data.curriculum.matrixRows.flatMap((row) => (
    [...row.itemsByProgram.values()].flat().map((item) => item.semesterKey)
  )))].sort((left, right) => {
    if (left === "unknown") return right === "unknown" ? 0 : 1;
    if (right === "unknown") return -1;
    return Number(left) - Number(right);
  }), [data.curriculum.matrixRows]);
  const categoryOptions = useMemo(() => [...new Set(data.curriculum.matrixRows.flatMap((row) => (
    [...row.itemsByProgram.values()].flat().map((item) => item.generalCategory ?? item.classification?.categoryName ?? "Категория не указана")
  )))].sort((left, right) => left.localeCompare(right, "ru")), [data.curriculum.matrixRows]);
  const visibleRows = data.curriculum.matrixRows.filter((row) => {
    const items = [...row.itemsByProgram.values()].flat();
    const text = [row.title, ...items.map((item) => item.generalCategory ?? item.classification?.categoryName ?? "")].join(" ").toLocaleLowerCase("ru-RU");
    if (query.trim() && !text.includes(query.trim().toLocaleLowerCase("ru-RU"))) return false;
    if (semester && !items.some((item) => item.semesterKey === semester)) return false;
    if (category && !items.some((item) => (item.generalCategory ?? item.classification?.categoryName ?? "Категория не указана") === category)) return false;
    return true;
  });

  return (
    <section className={styles.section} aria-labelledby="matrix-title">
      <div className={styles.sectionHeading}><div><p className={styles.kicker}>ДИСЦИПЛИНЫ</p><h2 id="matrix-title">Матрица предметов</h2><p>{data.curriculum.matrixRows.length} названий · совпадения по названию используются только для отображения.</p></div></div>
      <details className={styles.matrixDetails}>
        <summary>Открыть таблицу и фильтры</summary>
        <p className={styles.matrixIdentityNote}>{data.curriculum.matrixIdentityNote} Категория без подтверждённой таксономии остаётся «не указана».</p>
        <div className={styles.matrixControls}>
          <label className={styles.matrixField} htmlFor="curriculum-search"><span>Найти дисциплину или категорию</span><input id="curriculum-search" type="search" placeholder="Например, алгоритмы" value={query} onChange={(event) => setQuery(event.currentTarget.value)} /></label>
          <label className={styles.matrixField} htmlFor="curriculum-semester"><span>Семестр</span><select id="curriculum-semester" value={semester} onChange={(event) => setSemester(event.currentTarget.value)}><option value="">Все семестры</option>{semesterOptions.map((value) => <option key={value} value={value}>{value === "unknown" ? "Семестр не указан" : `${value} семестр`}</option>)}</select></label>
          <label className={styles.matrixField} htmlFor="curriculum-category"><span>Категория</span><select id="curriculum-category" value={category} onChange={(event) => setCategory(event.currentTarget.value)}><option value="">Все категории</option>{categoryOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        </div>
        <p className={styles.matrixResult} aria-live="polite">Показано {visibleRows.length} из {data.curriculum.matrixRows.length} названий.</p>
        <p className={styles.tableNote}>Под каждой дисциплиной указаны программа, семестр и нагрузка.</p>
        <div className={styles.tableWrap}>
          <table className={`${styles.table} ${styles.matrixTable}`}>
            <caption className={styles.srOnly}>Матрица дисциплин по выбранным образовательным программам.</caption>
            <thead><tr><th scope="col">Дисциплина</th>{data.programs.map((program) => <th scope="col" key={program.external_key}><ProgramIdentity program={program} /></th>)}</tr></thead>
            <tbody>{visibleRows.length ? visibleRows.map((row) => (
              <tr key={row.visualKey}>
                <th scope="row"><span className={styles.matrixTitle}>{row.title}</span>{row.itemsByProgram.size === data.programs.length ? <span className={styles.commonTag}>Название встречается во всех</span> : null}</th>
                {data.curriculum.programs.map((program) => {
                  const items = [...(row.itemsByProgram.get(program.programKey) ?? [])].sort((left, right) => (
                    (left.semester ?? Number.POSITIVE_INFINITY) - (right.semester ?? Number.POSITIVE_INFINITY)
                  ));
                  return <td key={program.programKey} data-program-label={data.programs.find((entry) => entry.external_key === program.programKey)?.code ?? program.programKey}>{items.length ? items.map((item, index) => <MatrixCourseEntry item={item} key={`${item.externalKey}:${index}`} />) : <MatrixMissingCell program={program} />}</td>;
                })}
              </tr>
            )) : <tr><td colSpan={data.programs.length + 1}>По этим фильтрам дисциплин нет.</td></tr>}</tbody>
          </table>
        </div>
        <p className={styles.matrixFootnote}>«Нет позиции с таким названием» формируется только для загруженного подтверждённого плана. При неоднозначной, непроверенной или недоступной версии отсутствие не выводится.</p>
      </details>
    </section>
  );
}

function CurriculumStatus({ data }: { data: LoadedProgramComparison }) {
  const unavailable = data.curriculum.programs.filter((program) => (
    program.planSelection.status !== "ready" || program.itemsStatus === "unavailable"
  ));
  if (!unavailable.length) return null;
  return (
    <section className={styles.section} aria-labelledby="plan-status-title">
      <div className={styles.sectionHeading}><div><p className={styles.kicker}>УЧЕБНЫЕ ПЛАНЫ</p><h2 id="plan-status-title">Статус данных</h2><p>Для непроверенных или неоднозначных версий таблица показывает причину и не подставляет прежний план.</p></div></div>
      <div className={styles.selectionList}>{unavailable.map((entry, index) => {
        const program = data.programs.find((candidate) => candidate.external_key === entry.programKey);
        return <article className={styles.selectionCard} key={entry.programKey} style={{ "--program-color": SERIES_COLORS[index % SERIES_COLORS.length] } as CSSProperties}><div className={styles.selectionCopy}><span>{program?.code ?? entry.programKey}</span><strong>{planStatusMessage(entry)}</strong></div></article>;
      })}</div>
    </section>
  );
}

export default function CompareRoute() {
  const hydrated = useHydrated();
  const storedKeys = useComparisonSelection();
  const [searchParams, setSearchParams] = useSearchParams();
  const sharedKeys = useMemo(() => hydrated ? comparisonKeys(searchParams) : null, [searchParams, hydrated]);
  const invalidSharedLink = hydrated && (searchParams.has("program") || searchParams.has("shared")) && sharedKeys === null;
  const selectedKeys = sharedKeys ?? storedKeys;
  useEffect(() => {
    if (sharedKeys !== null) comparisonSelection.set(sharedKeys, false);
  }, [sharedKeys]);
  function updateSelection(keys: readonly string[]) {
    if (sharedKeys !== null) setSearchParams(new URLSearchParams(comparisonPath(keys).split("?")[1]), { preventScrollReset: true });
    return comparisonSelection.set(keys);
  }
  const selectionSignature = selectedKeys.join("\u001f");
  const [retryCount, setRetryCount] = useState(0);
  const signature = `${selectionSignature}\u001e${retryCount}`;
  const [loadState, setLoadState] = useState<ComparisonLoadState | null>(null);
  const matchingState = loadState?.signature === signature ? loadState : null;

  useEffect(() => {
    if (!selectedKeys.length) return;
    const controller = new AbortController();
    const abortOnPageHide = () => controller.abort();
    const resumeOnPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setRetryCount((count) => count + 1);
    };
    window.addEventListener("pagehide", abortOnPageHide);
    window.addEventListener("beforeunload", abortOnPageHide);
    window.addEventListener("pageshow", resumeOnPageShow);
    loadProgramComparison(selectedKeys, controller.signal, (data) => {
      if (!controller.signal.aborted) setLoadState({ signature, kind: "preview", data });
    }, (data) => {
      if (!controller.signal.aborted) setLoadState({ signature, kind: "selection", data });
    }).then((data) => {
      if (controller.signal.aborted) return;
      setLoadState({ signature, kind: "ready", data });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      controller.abort();
      const releaseChanged = error instanceof AcademicReleaseMismatchError;
      trackEvent("comparison_load_failed", { release_changed: releaseChanged, selected_count: selectedKeys.length });
      const message = releaseChanged
        ? "Во время загрузки активный академический выпуск изменился. Обновите страницу, чтобы сравнение использовало единые данные."
        : "Не удалось загрузить программы и учебные планы из FastAPI. Проверьте соединение и повторите попытку.";
      setLoadState({ signature, kind: "error", message, recovery: releaseChanged ? "reload" : "retry" });
    }).finally(() => window.removeEventListener("beforeunload", abortOnPageHide));
    return () => {
      window.removeEventListener("pagehide", abortOnPageHide);
      window.removeEventListener("beforeunload", abortOnPageHide);
      window.removeEventListener("pageshow", resumeOnPageShow);
      controller.abort();
    };
  }, [retryCount, selectedKeys, signature]);

  const data = matchingState?.kind === "ready" ? matchingState.data : null;
  const overview = matchingState?.kind === "preview" || matchingState?.kind === "ready" ? matchingState.data : null;
  const selectedData = matchingState && matchingState.kind !== "error" ? matchingState.data : null;
  const error = matchingState?.kind === "error" ? matchingState.message : null;
  const recovery = matchingState?.kind === "error" ? matchingState.recovery : "retry";
  const isLoading = Boolean(selectedKeys.length && (!matchingState || matchingState.kind === "selection"));

  const comparison = (
    <div className={styles.page} style={{ "--comparison-count": selectedData?.programs.length || Math.min(selectedKeys.length, 3) || 3 } as CSSProperties}>
      <AndromedaHeader />
      <main className={styles.main}>
        <section className={styles.intro} aria-labelledby="compare-title">
          <div className={styles.introCopy}>
            <h1 className={styles.title} id="compare-title">Сравни программы</h1>
            <p className={styles.description}>Сравнение направлений и образовательных программ МГТУ им. Баумана: как поступить, что изучать и какая будет нагрузка.</p>
          </div>
          <div className={styles.count}><strong>{selectedKeys.length} / 3</strong><span>программ выбрано</span></div>
        </section>

        {invalidSharedLink ? <div className={styles.retryNotice} role="alert"><p>Ссылка на сравнение повреждена. Ваш сохранённый выбор остался на месте.</p><Link className={styles.button} to="/compare" replace preventScrollReset>Продолжить со своим выбором</Link></div> : null}
        <ProgramPicker selectedKeys={selectedKeys} onSelectionChange={updateSelection} />
        {selectedKeys.length ? <SelectionCards selectedKeys={selectedKeys} data={selectedData} onSelectionChange={updateSelection} /> : null}
        {data && data.programs.length > 0 && <ShareActions key={selectionSignature} title="Поделиться сравнением" description="Отправь ссылку родителям или друзьям либо скачай PDF. Ссылка сохранит выбор программ, PDF — данные на момент скачивания." getLink={() => absoluteLink(comparisonPath(data.programs.map(p => p.external_key)))} getReport={() => comparisonReport(data, absoluteLink(comparisonPath(data.programs.map(p => p.external_key))))} />}
        {!selectedKeys.length ? (
          <section className={styles.state}>
            <h2>Добавь программы для сравнения</h2>
            <p>Найди программы в поиске выше или выбери их в каталоге. Выбор сохранится в этом браузере.</p>
            <Link viewTransition className={`${styles.button} ${styles.buttonBlue}`} to="/programs">Открыть каталог</Link>
          </section>
        ) : null}
        {isLoading ? <ComparisonSkeleton /> : null}
        {error ? <section className={`${styles.state} ${styles.error}`} role="alert"><h2>Сравнение временно недоступно</h2><p>{error}</p><button className={`${styles.button} ${styles.buttonBlue}`} type="button" onClick={() => recovery === "reload" ? window.location.reload() : setRetryCount((value) => value + 1)}>{recovery === "reload" ? "Обновить страницу" : "Повторить загрузку"}</button></section> : null}
        {overview && overview.programs.length === 0 && overview.invalidSelectionKeys.length > 0 ? <section className={`${styles.state} ${styles.error}`} role="alert"><h2>Выбор отсутствует в активном выпуске</h2><p>Удалите сохранённые ключи из списка выше и выберите программы заново.</p></section> : null}
        {overview && overview.programs.length > 0 ? (
          <>
            {overview.invalidSelectionKeys.length ? <p className={styles.warning}>Некоторые сохранённые ключи не найдены в активном выпуске. Они показаны выше и исключены из академических данных.</p> : null}
            <AdmissionComparison data={overview} />
            {overview.admissionUnavailable.size ? <div className={styles.retryNotice} role="status"><p>Условия приёма для части программ не загрузились. Это ошибка соединения, а не отсутствие данных.</p><button className={styles.button} type="button" onClick={() => setRetryCount((value) => value + 1)}>Повторить загрузку</button></div> : null}
            {!data ? <ComparisonSkeleton curriculumOnly /> : null}
          </>
        ) : null}
        {data && data.programs.length > 0 ? (
          <>
            <CurriculumStatus data={data} />
            <p className={styles.tableNote}>Нагрузка указана в академических часах за соответствующий семестр. Факультативы и физкультура без зачётных единиц учитываются отдельно от основной программы.</p>
            <CategoryComparison data={data} />
            <Suspense fallback={<div className={styles.deferredChart}><ScreenLoader label="Загружаем диаграмму нагрузки" /></div>}><WorkloadChart data={data} /></Suspense>
            <CurriculumMatrix data={data} />
            <p className={styles.releaseNote} data-qa="active-release-note">Активный академический выпуск: <code data-qa="active-release-key">{data.releaseKey}</code>. Все таблицы и планы сверены с этим ключом.</p>
          </>
        ) : null}
      </main>
    </div>
  );

  return __ANDROMEDA_REACT_PROFILE__
    ? <Profiler id="comparison" onRender={recordComparisonProfile}>{comparison}</Profiler>
    : comparison;
}

function ComparisonSkeleton({ curriculumOnly = false }: { curriculumOnly?: boolean }) {
  return <section id="curriculum-loading" className={styles.loading} aria-busy="true">
    <ScreenLoader label={curriculumOnly ? "Загружаем учебные планы" : "Собираем сравнение"} />
  </section>;
}
