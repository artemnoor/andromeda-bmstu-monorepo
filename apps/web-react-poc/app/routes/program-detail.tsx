import { useState, type CSSProperties } from "react";
import { Link, isRouteErrorResponse, useLocation, useRevalidator, useRouteError } from "react-router";
import { ArrowLeft, ArrowUpRight, Clock3, GraduationCap, Layers3, Wallet } from "lucide-react";
import type { Route } from "./+types/program-detail";
import { AndromedaHeader } from "@/widgets/andromeda-navigation/andromeda-header";
import { loadCatalog } from "@/shared/api/client";
import { programPath } from "@/features/catalog/program-path";
import { ProgramDonut } from "@/features/catalog/program-donut";
import { loadProgramComparison } from "@/features/comparison/api";
import { AdmissionExams, AdmissionFreshness, RelatedAdmissionPlaces } from "@/features/catalog/admission-facts";
import { ENROLLMENT_ROWS, SCORE_ROWS, enrollmentCell, scoreCell } from "@/features/catalog/admission-table-model";
import { colorFor, formatMetric } from "@/features/comparison/presentation";
import { safeExternalUrl } from "@/features/catalog/model";
import { publicSourceUrl } from "@/shared/links/public-source-url";
import { comparisonSelection, useHydrated, useIsCompared } from "@/shared/browser-state/hooks";
import { getComparisonSnapshot, MAX_COMPARE_PROGRAMS } from "@/shared/browser-state/storage";
import { showComparisonLimitNotice } from "@/shared/ui/comparison-limit-notice";
import { ComparisonMorph } from "@/shared/ui/comparison-morph";
import { SITE_ORIGIN } from "@/shared/seo";
import styles from "@/features/catalog/program-detail.module.css";
import { NotFoundPage } from "@/shared/ui/not-found-page";

async function programData(request: Request, slug: string) {
  const catalog = await loadCatalog(request.signal);
  const record = catalog.programs.items.find((program) => programPath(program) === `/programs/${slug}`);
  if (!record) throw new Response("Программа не найдена", { status: 404 });
  const result = await loadProgramComparison([record.external_key], request.signal);
  const program = result.programs[0];
  if (!program) throw new Response("Программа не найдена", { status: 404 });
  const direction = catalog.directions.items.find((item) => item.external_key === program.direction_key);
  return {
    program,
    duration: direction?.duration_label ?? null,
    degree: direction?.degree_label ?? direction?.qualification_label ?? null,
    summary: result.admission.get(program.external_key),
    curriculum: result.curriculum.programs[0],
  };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  return programData(request, params.slug);
}
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  return programData(request, params.slug);
}

export function meta({ data }: Route.MetaArgs) {
  if (!data) return [{ title: "Программа не найдена — Андромеда" }];
  const { program } = data;
  const title = `${program.name} — ${program.code} · Андромеда`;
  const description = `${program.name} в МГТУ им. Н. Э. Баумана: условия поступления, экзамены, учебный план, предметы и распределение нагрузки.`;
  const url = SITE_ORIGIN + programPath(program);
  return [
    { title }, { name: "description", content: description },
    { tagName: "link" as const, rel: "canonical", href: url },
    { property: "og:type", content: "website" }, { property: "og:title", content: title },
    { property: "og:description", content: description }, { property: "og:url", content: url },
    { property: "og:image", content: `${SITE_ORIGIN}/social-preview.png` },
    { name: "twitter:card", content: "summary_large_image" },
    { "script:ld+json": { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Андромеда", item: SITE_ORIGIN },
      { "@type": "ListItem", position: 2, name: "Каталог программ", item: `${SITE_ORIGIN}/programs` },
      { "@type": "ListItem", position: 3, name: program.name, item: url },
    ] } },
  ];
}

function Source({ href }: { href?: string | null | undefined }) {
  const url = href ? publicSourceUrl(href) : null;
  return url ? <a className={styles.source} href={url} target="_blank" rel="noopener noreferrer">Источник <ArrowUpRight size={13} aria-hidden="true" /></a> : null;
}

const number = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value);

export default function ProgramDetail({ loaderData }: Route.ComponentProps) {
  const { program, summary, curriculum, duration, degree } = loaderData;
  const location = useLocation();
  const hydrated = useHydrated();
  const catalogSearch: unknown = location.state?.catalogSearch;
  const back = hydrated && typeof catalogSearch === "string" && catalogSearch.startsWith("?") ? `/programs${catalogSearch}` : "/programs";
  const selected = useIsCompared(program.external_key);
  const [feedback, setFeedback] = useState("");
  const [subjectQuery, setSubjectQuery] = useState("");
  const [semester, setSemester] = useState("all");
  const [categoryKey, setCategoryKey] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(30);
  const categories = (curriculum?.categories ?? []).map((category, index) => ({ ...category, color: colorFor(index) }));
  const total = curriculum?.total.hours.value ?? 0;
  const active = categories.find((category) => category.key === categoryKey);
  const items = (curriculum?.items ?? []).filter((item) => (
    (semester === "all" || item.semesterKey === semester)
    && (!active || active.items.some((entry) => entry.externalKey === item.externalKey))
    && item.displayName.toLocaleLowerCase("ru").includes(subjectQuery.toLocaleLowerCase("ru").trim())
  ));
  const tuition = summary?.tuitionFacts ?? [];
  const offers = summary?.offers ?? [];
  const source = publicSourceUrl(program.sourceUrl);
  const plan = safeExternalUrl(program.study_plan_url);
  const forms = [...new Set(offers.flatMap((offer) => {
    const match = offer.match(/Форма обучения: ([^·;]+)/);
    return match?.[1] ? [match[1].trim()] : [];
  }))];
  const offeringDurations = [...new Set(offers.filter((offer) => offer.startsWith("Срок обучения: ")).map((offer) => offer.slice("Срок обучения: ".length)))];
  const seats = summary?.seats ?? [];
  const seatMax = Math.max(1, ...seats.map((fact) => fact.numericValue ?? 0));
  const semesterMax = Math.max(1, ...(curriculum?.semesters ?? []).map((entry) => entry.hours.value));

  function selectCategory(key: string) {
    setCategoryKey((current) => current === key ? null : key);
    setVisibleCount(30);
  }

  function toggleComparison() {
    if (!selected && getComparisonSnapshot().length >= MAX_COMPARE_PROGRAMS) {
      showComparisonLimitNotice();
      return false;
    }
    const status = comparisonSelection.toggle(program.external_key, !selected);
    setFeedback(status === "unavailable" ? "Браузер не сохранил выбор. Разрешите сохранение данных сайта." : "");
    return status !== "unavailable";
  }

  return <div className={styles.page}>
    <AndromedaHeader />
    <main className={styles.main}>
      <Link to={back} viewTransition className={styles.back}><ArrowLeft size={16} aria-hidden="true" /> Назад в каталог</Link>
      <header className={styles.hero}>
        <p className={styles.eyebrow}>{program.code} <span>МГТУ им. Н. Э. Баумана</span></p>
        <h1>{program.name}</h1>
        <p className={styles.direction}>{program.directionCode} · {program.directionName}</p>
        {program.description ? <p className={styles.description}>{program.description}</p> : <p className={styles.description}>Описание программы пока не опубликовано.</p>}
        <div className={styles.departments}>{program.departments.map((department) => <Link key={department.externalKey} to={`/programs?department=${encodeURIComponent(department.code ?? "")}`}><span>{department.code}</span> {department.name}</Link>)}</div>
        <div className={styles.heroActions}><ComparisonMorph selected={selected} onToggle={toggleComparison} />{plan ? <a href={plan} target="_blank" rel="noopener noreferrer">Учебный план <ArrowUpRight size={15} aria-hidden="true" /></a> : null}{source ? <a href={source} target="_blank" rel="noopener noreferrer">Официальная страница <ArrowUpRight size={15} aria-hidden="true" /></a> : null}</div>
        {feedback ? <p role="status">{feedback}</p> : null}
      </header>

      <dl className={styles.facts}>
        <div><Wallet aria-hidden="true" /><dt>Стоимость обучения</dt><dd>{tuition.length ? tuition.map((fact, index) => <div key={index}><strong>{fact.value}</strong>{fact.note ? <small>{fact.note}</small> : null}<Source href={fact.sourceUrl} /></div>) : "Не опубликована"}</dd></div>
        <div><Clock3 aria-hidden="true" /><dt>Срок обучения</dt><dd>{offeringDurations.join(" / ") || duration || "Не указан"}</dd></div>
        <div><Layers3 aria-hidden="true" /><dt>Форма обучения</dt><dd>{forms.join(" / ") || "Не указана"}</dd></div>
        <div><GraduationCap aria-hidden="true" /><dt>Тип программы</dt><dd>{degree || "Не указан"}</dd></div>
      </dl>

      <nav className={styles.contents} aria-label="Разделы программы"><a href="#places">Места</a><a href="#admission">Поступление</a><a href="#workload">Учебная нагрузка</a><a href="#subjects">Предметы</a></nav>

      <section id="places" className={styles.section}>
        <AdmissionFreshness year={summary?.year} />
        <div className={styles.sectionHeading}><span>01 / Поступление</span><h2>Места для поступления{summary?.year ? ` · ${summary.year}` : ""}</h2><p>{summary?.seatScope || "План приёма по опубликованным данным университета."}</p></div>
        <div className={styles.panel}>
          {seats.length ? seats.map((fact, index) => <div className={styles.seatRow} key={index}>
            <div className={styles.rowHeading}><h3>{fact.label}</h3><strong>{fact.value === "—" ? "Не подтверждено" : fact.value}</strong></div>
            {fact.numericValue != null ? <div className={styles.segmented} aria-hidden="true">{Array.from({ length: 30 }, (_, cell) => <span key={cell} style={{ opacity: (cell + 1) / 30 <= fact.numericValue! / seatMax ? 1 : .12 }} />)}</div> : null}
            {fact.note ? <p className={styles.note}>{fact.note}</p> : null}<Source href={fact.sourceUrl} />
          </div>) : <p className={styles.note}>{summary ? "План приёма не опубликован в доступных данных." : "Не удалось загрузить условия поступления."}</p>}
          {summary?.seatNote ? <p className={styles.note}>{summary.seatNote}</p> : null}
          <RelatedAdmissionPlaces summary={summary} />
          {summary && (summary.quotas.length > 0 || summary.directionQuotas.length > 0) ? <details className={styles.quotaDetails}><summary>Квоты и область действия данных</summary>{[...summary.quotas, ...summary.directionQuotas].map((quota, index) => <div key={index} className={styles.quota}><strong>{quota.label} · {quota.value}</strong><p>{quota.scope}</p><Source href={quota.sourceUrl} /></div>)}{summary.quotaNote ? <p className={styles.note}>{summary.quotaNote}</p> : null}</details> : null}
        </div>
        {summary?.year ? <section className={`${styles.panel} ${styles.enrollment}`} aria-labelledby="enrollment-title"><h3 id="enrollment-title" className={styles.panelTitle}>Зачислено на всё направление · {summary.year}</h3><p className={styles.note}>Это результаты приказов о зачислении, включая все профили направления. Это не план мест отдельной программы. Квоты входят в бюджетный итог.</p><div className={styles.enrollmentGrid}>{ENROLLMENT_ROWS.map((row) => {
          const cell = enrollmentCell(summary, summary.year!, row);
          return <div key={row.key}><span>{row.label}</span><strong>{cell.value}</strong>{cell.sourceUrls.map((href) => <Source key={href} href={href} />)}</div>;
        })}</div></section> : null}
      </section>

      <section id="admission" className={styles.section}>
        <div className={styles.sectionHeading}><span>02 / Условия</span><h2>Приёмная кампания</h2><p>Вступительные испытания и опубликованные результаты за {summary?.year ?? "доступный год"}.</p></div>
        <div className={styles.admissionGrid}>
          <div className={styles.panel}><h3 className={styles.panelTitle}>Вступительные испытания</h3><AdmissionExams summary={summary} /></div>
          <div className={styles.panel}><h3 className={styles.panelTitle}>Проходные баллы{summary?.year ? ` · ${summary.year}` : ""}</h3>
            {SCORE_ROWS.map((row) => {
              const cell = scoreCell(summary, summary?.year ?? 2026, row);
              return <div className={styles.score} key={row.key}><span>{row.label}</span><strong>{cell.value}</strong>{cell.note ? <p>{cell.note}</p> : null}<Source href={cell.sourceUrl} /><Source href={cell.bviSourceUrl} /></div>;
            })}
            <p className={styles.note}>Минимум по отдельному экзамену — условие допуска к конкурсу. Проходной балл — результат зачисления.</p>
          </div>
        </div>

      </section>

      <section id="workload" className={styles.section}>
        <div className={styles.sectionHeading}><span>03 / Учебный план</span><h2>Что предстоит изучать</h2><p>Распределение часов по предметным категориям и семестрам.</p></div>
        {curriculum?.items.length ? <>
          <div className={styles.studyStats}><div><strong>{formatMetric(curriculum.total.hours, "ч.")}</strong><span>академических часов основной программы</span></div><div><strong>{curriculum.items.length}</strong><span>позиций основной программы</span></div><div><strong>{formatMetric(curriculum.total.credits, "з.е.")}</strong><span>трудоёмкость основной программы</span></div></div>
          <div className={`${styles.panel} ${styles.categoryLayout}`}>
            <div className={styles.donutColumn}><div className={styles.donut}><ProgramDonut categories={categories} total={total} activeKey={categoryKey} onSelect={selectCategory} /><div className={styles.donutCenter} aria-live="polite"><strong>{active && total > 0 ? `${number(active.hours.value / total * 100)}%` : formatMetric(curriculum.total.hours, "ч.")}</strong><span>{active?.name ?? "Объём учебного плана"}</span></div></div><p className={styles.note}>Нажмите на сектор круга или категорию в списке, чтобы увидеть её предметы ниже.</p></div>
            <div className={styles.legend}>{categories.map((category) => <button type="button" key={category.key} aria-pressed={categoryKey === category.key} onClick={() => selectCategory(category.key)} className={styles.category} style={{ "--category-color": category.color } as CSSProperties}><i aria-hidden="true" /><span>{category.name}</span><strong>{formatMetric(category.hours, "ч.")}</strong><small>{total > 0 && category.hours.count ? `${number(category.hours.value / total * 100)}%` : "—"}</small></button>)}{active ? <button type="button" className={styles.reset} onClick={() => setCategoryKey(null)}>Показать все категории</button> : null}</div>
          </div>
          {curriculum.total.hours.count < curriculum.items.length ? <p className={styles.note}>У части дисциплин часы не указаны. Диаграмма рассчитана по опубликованным значениям.</p> : null}
          <div className={styles.panel}><h3 className={styles.panelTitle}>Нагрузка по семестрам</h3><div className={styles.semesters}>{curriculum.semesters.map((entry) => <div key={entry.key}><span>{entry.semester !== null ? `${entry.semester} семестр` : "Без семестра"}</span><div className={styles.track}><span style={{ width: `${entry.hours.value / semesterMax * 100}%` }} /></div><strong>{formatMetric(entry.hours, "ч.")}</strong></div>)}</div></div>
        </> : <div className={styles.panel}><h3>Состав учебного плана пока недоступен</h3><p className={styles.note}>{curriculum?.itemsStatus === "unavailable" ? "Не удалось загрузить дисциплины. Повторите загрузку страницы." : curriculum?.planSelection.currentPlan?.unavailable_reason || "Для этой программы пока нет однозначно подтверждённой версии учебного плана. Дисциплины других программ не подставляем."}</p>{plan ? <a className={styles.source} href={plan} target="_blank" rel="noopener noreferrer">Открыть учебный план ↗</a> : null}</div>}
      </section>

        {curriculum?.additionalItems?.length ? <section className={styles.section}>
          <div className={styles.sectionHeading}><h2>Дополнительные дисциплины</h2><p>Факультативы и физкультура без зачётных единиц показаны отдельно. Они не входят в основную нагрузку на диаграммах и не влияют на профиль профессиональных интересов.</p></div>
          <div className={styles.panel}><ul className={styles.subjects}>{curriculum.additionalItems.map((item) => <li key={item.externalKey}><div><h3>{item.displayName}</h3><p>{item.semester ? `${item.semester} семестр` : "Распределение по семестрам не указано"}{item.generalCategory ? ` · ${item.generalCategory}` : " · Факультатив"}</p></div><div className={styles.subjectMetrics}><strong>{item.hours === null ? "Часы не указаны" : `${number(item.hours)} ч.`}</strong><span>{item.credits === null ? "Без з.е." : `${number(item.credits)} з.е.`}</span></div></li>)}</ul></div>
        </section> : null}
        <section id="subjects" className={styles.section}>
        <div className={styles.sectionHeading}><span>04 / Дисциплины</span><h2>Содержание программы</h2><p>Предметы, часы, зачётные единицы и формы контроля.</p></div>
        {curriculum?.items.length ? <div className={styles.panel}>
          <div className={styles.filters}><label><span>Найти предмет</span><input type="search" placeholder="Название дисциплины" value={subjectQuery} onChange={(event) => setSubjectQuery(event.target.value)} /></label><label><span>Семестр</span><select aria-label="Семестр" value={semester} onChange={(event) => setSemester(event.target.value)}><option value="all">Все семестры</option>{curriculum.semesters.map((entry) => <option key={entry.key} value={entry.key}>{entry.semester !== null ? `${entry.semester} семестр` : "Без семестра"}</option>)}</select></label></div>
          <div className={styles.listHeading}><p role="status">Найдено позиций: {items.length}{active ? ` · ${active.name}` : ""}</p>{active ? <button type="button" className={styles.reset} onClick={() => setCategoryKey(null)}>Сбросить категорию ×</button> : null}</div>
          <ul className={styles.subjects}>{items.slice(0, visibleCount).map((item) => <li key={item.externalKey}><div><h3>{item.displayName}</h3><p>{item.semester !== null ? `${item.semester} семестр` : "Семестр не указан"}{item.generalCategory ? ` · ${item.generalCategory}` : item.classification ? ` · ${item.classification.categoryName}` : " · Категория не определена"}</p></div><div className={styles.subjectMetrics}><strong>{item.hours !== null ? `${number(item.hours)} ч.` : "Часы не указаны"}</strong><span>{item.credits !== null ? `${number(item.credits)} з.е.` : "З.е. не указаны"}</span><span>{item.assessmentType || "Контроль не указан"}</span></div></li>)}</ul>
          {items.length > visibleCount ? <button type="button" className={styles.showMore} onClick={() => setVisibleCount((count) => count + 30)}>Показать ещё 30 · осталось {items.length - visibleCount}</button> : null}
          {!items.length ? <p className={styles.note}>Предметов с такими условиями нет. Измените запрос или фильтры.</p> : null}
        </div> : <p className={styles.note}>Дисциплины появятся после публикации подтверждённого учебного плана.</p>}
      </section>
      <footer className={styles.footer}><Link to={back} viewTransition><ArrowLeft size={16} aria-hidden="true" /> Вернуться к программам</Link><Link to="/compare" viewTransition>Открыть сравнение <ArrowUpRight size={16} aria-hidden="true" /></Link><p>Условия могут обновляться. Перед подачей документов сверяйте сведения с официальными источниками университета.</p></footer>
    </main>
  </div>;
}

export function ErrorBoundary() {
  const error = useRouteError();
  const revalidator = useRevalidator();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  if (notFound) return <NotFoundPage title="Программа не найдена" description="Возможно, ссылка устарела или программа больше не представлена в каталоге. Посмотри другие направления — среди них может быть твоё." />;
  return <div className={styles.page}><AndromedaHeader /><main className={styles.main}><h1>{notFound ? "Программа не найдена" : "Не удалось загрузить программу"}</h1><p>Вернитесь в каталог или повторите загрузку.</p><div className={styles.heroActions}><Link to="/programs">В каталог</Link>{!notFound ? <button type="button" onClick={() => void revalidator.revalidate()} disabled={revalidator.state !== "idle"}>Повторить</button> : null}</div></main></div>;
}
