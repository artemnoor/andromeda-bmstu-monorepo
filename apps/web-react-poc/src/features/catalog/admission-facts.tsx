import { useEffect, useRef, useState } from "react";
import type { ApiSchemas } from "@/shared/api/client";
import { publicSourceUrl } from "@/shared/links/public-source-url";
import type { CatalogProgram } from "./model";
import { ProgramIdentity, programIdentityText } from "./program-identity";
import { subjectLabel, type AdmissionSummary } from "./admission-model";
import { ENROLLMENT_ROWS, SCORE_ROWS, enrollmentCell, scoreCell } from "./admission-table-model";
import styles from "./admission-facts.module.css";

export interface AdmissionColumn {
  readonly key: string;
  readonly label: string;
  readonly summary: AdmissionSummary | undefined;
  readonly program?: CatalogProgram;
}

export function AdmissionFreshness({ year }: { year: number | null | undefined }) {
  if (!year) return <p className={styles.note}>Год условий приёма не подтверждён. Перед подачей документов проверьте действующие правила университета.</p>;
  const now = new Date();
  const nextCampaign = now.getUTCFullYear() + (now.getUTCMonth() >= 8 ? 1 : 0);
  return <aside className={styles.freshness} aria-label="Актуальность данных приёма">
    <strong>Условия приёма · {year}</strong>
    <p>Места, экзамены и стоимость относятся к указанной кампании. Проходные баллы — опубликованные результаты конкурса за свой год, они не гарантируют поступление в следующем наборе.</p>
    {nextCampaign > year ? <p>Условия набора {nextCampaign} в этой выгрузке не подтверждены. Для поступления в {nextCampaign} году сверьтесь с <a href="https://priem.bmstu.ru/" target="_blank" rel="noopener noreferrer">приёмной комиссией МГТУ</a>.</p> : null}
  </aside>;
}

function ColumnIdentity({ column }: { column: AdmissionColumn }) {
  return column.program ? <ProgramIdentity program={column.program} /> : <>{column.label}</>;
}

function columnDetails(column: AdmissionColumn): string {
  return column.program ? programIdentityText(column.program) : column.label;
}

function Source({ href, label = "Источник" }: { href: string; label?: string }) {
  const publicHref = publicSourceUrl(href);
  return publicHref ? <a className={styles.source} href={publicHref} target="_blank" rel="noopener noreferrer">{label} ↗</a> : null;
}

export function AdmissionEnrollmentTable({ columns, year }: { columns: readonly AdmissionColumn[]; year: number }) {
  return <section className={styles.section}>
    <h3>Зачислено на направление подготовки · {year}</h3>
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className={styles.srOnly}>Зачислено на всё направление подготовки по видам финансирования и квотам за {year} год</caption>
        <thead><tr><th scope="col">Показатель</th>{columns.map((column) => <th scope="col" key={column.key}><ColumnIdentity column={column} /></th>)}</tr></thead>
        <tbody>{ENROLLMENT_ROWS.map((row) => <tr key={row.key}>
          <th scope="row">{row.label}</th>
          {columns.map((column) => {
            const result = enrollmentCell(column.summary, year, row);
            return <td key={column.key} data-program-label={column.label} data-program-details={columnDetails(column)}><div className={styles.result}>
              <strong>{result.value}</strong>
              {result.note ? <span>{result.note}</span> : null}
              {result.sourceUrls.map((href) => <Source key={href} href={href} />)}
            </div></td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
    <p className={styles.note}>Зачислено на всё направление подготовки, включая все его профили, по опубликованным приказам. Квоты входят в бюджетный итог и показаны отдельно как его часть.</p>
  </section>;
}

/** Related PDF rows are evidence to review, never seats assigned to this profile. */
export function RelatedAdmissionPlaces({ summary }: { summary: AdmissionSummary | undefined }) {
  if (!summary?.relatedSeatFacts.length) return null;
  return <aside className={styles.relatedPlaces} aria-label="Связанные строки плана приёма">
    <h4>Что найдено в плане приёма</h4>
    <p>Для этой кафедры и направления есть строки с другим названием программы. Связь с выбранным профилем не подтверждена; эти места показаны отдельно.</p>
    <Source href="https://bmstu.ru/documents" label="Сверить актуальный план МГТУ" />
    <ul>{summary.relatedSeatFacts.map(fact => <li key={fact.key}>
      <span>{[fact.departmentCode, fact.sourceProgramName].filter(Boolean).join(" · ")}</span>
      <strong>{fact.fundingType === "budget" ? "Бюджет" : "Платное"} · {fact.value}</strong>
      {fact.note ? <p>{fact.note}</p> : null}
      {fact.sourceUrl ? <Source href={fact.sourceUrl} /> : null}
    </li>)}</ul>
  </aside>;
}

export function AdmissionPlacesTable({ columns, year }: { columns: readonly AdmissionColumn[]; year: number }) {
  return <section className={styles.section} aria-label={`План мест приёма · ${year}`}>
    <h3>Места по плану приёма · {year}</h3>
    <div className={styles.tableWrap}><table className={styles.table}>
      <caption className={styles.srOnly}>План мест и область действия сведений, отдельно от фактического зачисления</caption>
      <thead><tr><th scope="col">Финансирование</th>{columns.map(column => <th scope="col" key={column.key}><ColumnIdentity column={column} /></th>)}</tr></thead>
      <tbody>{["Бюджет", "Платное обучение"].map((label, index) => <tr key={label}><th scope="row">{label}</th>{columns.map(column => {
        const fact = column.summary?.seats[index];
        return <td key={column.key} data-program-label={column.label} data-program-details={columnDetails(column)}><div className={styles.result}>
          <strong>{!column.summary ? "Не удалось загрузить" : fact?.value === "—" || !fact ? "Не подтверждено" : fact.value}</strong>
          <span>{column.summary?.seatScope}</span>
          {fact?.note ? <span>{fact.note}</span> : null}
          {fact?.sourceUrl ? <Source href={fact.sourceUrl} /> : null}
        </div></td>;
      })}</tr>)}</tbody>
    </table></div>
    {columns.map(column => <div key={column.key}>
      {column.summary?.seatNote ? <p className={styles.note}><strong>{column.program?.code ?? column.label}:</strong> {column.summary.seatNote}</p> : null}
      <RelatedAdmissionPlaces summary={column.summary} />
    </div>)}
  </section>;
}

interface EducationColumn extends AdmissionColumn {
  readonly program: CatalogProgram;
}

export function ProgramEducationTable({ columns, showDescription = true }: { columns: readonly EducationColumn[]; showDescription?: boolean }) {
  return <section className={styles.section}>
    <h3>Об обучении</h3>
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead><tr><th scope="col">Программа</th>{columns.map((column) => <th scope="col" key={column.key}><ColumnIdentity column={column} /></th>)}</tr></thead>
        <tbody>
          {showDescription ? <tr><th scope="row">Описание</th>{columns.map((column) => <td key={column.key} data-program-label={column.label} data-program-details={columnDetails(column)}><ProgramDescription text={column.program.description?.trim() || "Описание не опубликовано"} /></td>)}</tr> : null}
          <tr><th scope="row">Стоимость обучения</th>{columns.map((column) => <td key={column.key} data-program-label={column.label} data-program-details={columnDetails(column)}><div className={styles.result}>
            {column.summary?.tuitionFacts?.length ? column.summary.tuitionFacts.map((fact, index) => <div className={styles.result} key={`${fact.note}:${index}`}>
              <strong>{fact.value}</strong><span>{fact.note}</span>{fact.sourceUrl ? <Source href={fact.sourceUrl} /> : null}
            </div>) : <span>{column.summary ? "Стоимость не опубликована в доступных данных" : "Не удалось загрузить стоимость"}</span>}
          </div></td>)}</tr>
        </tbody>
      </table>
    </div>
  </section>;
}

function ProgramDescription({ text }: { readonly text: string }) {
  const textRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    if (expanded) return;
    const element = textRef.current;
    if (!element) return;
    const updateTruncation = () => setTruncated(element.scrollHeight > element.clientHeight + 1);
    updateTruncation();
    const observer = new ResizeObserver(updateTruncation);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, text]);

  return <div className={styles.programDescriptionBlock}>
    <p ref={textRef} className={`${styles.programDescription} ${expanded ? styles.programDescriptionExpanded : ""}`}>
      {text}
    </p>
    <div className={styles.programDescriptionAction}>
      {truncated ? <button className={styles.programDescriptionButton} type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        {expanded ? "Свернуть" : "Подробнее"}
      </button> : null}
    </div>
  </div>;
}

export function AdmissionScoreTable({ columns, year }: { columns: readonly AdmissionColumn[]; year: number }) {
  return <section className={styles.section}>
    <h3>Проходные баллы · {year}</h3>
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className={styles.srOnly}>Проходные баллы по официальной карточке или основному приказу и сведения БВИ за {year} год</caption>
        <thead><tr><th scope="col">Конкурс</th>{columns.map((column) => <th scope="col" key={column.key}>{column.program && columns.length > 1 ? <ColumnIdentity column={column} /> : columns.length === 1 ? "Проходной балл" : column.label}</th>)}</tr></thead>
        <tbody>{SCORE_ROWS.map((row) => <tr key={row.key}>
          <th scope="row">{row.label}</th>
          {columns.map((column) => {
            const result = scoreCell(column.summary, year, row);
            return <td key={column.key} data-program-label={column.label} data-program-details={columnDetails(column)}>
              <div className={styles.result} data-kind={result.kind}>
                <strong>{result.value}</strong>
                {result.note ? <span>{result.note}</span> : null}
                {result.sourceUrl ? <Source href={result.sourceUrl} /> : null}
                {result.bviSourceUrl ? <Source href={result.bviSourceUrl} label="Приказ о зачислении БВИ" /> : null}
              </div>
            </td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
    <p className={styles.note}>Числовые баллы сначала берём из официальной карточки направления МГТУ. Если там числа нет, используем минимум по общему конкурсу из проверенного основного приказа. Если числа нет ни в карточке, ни в приказе, показываем «Не опубликован». БВИ — без вступительных испытаний; такая отметка подтверждается отдельно приказом о зачислении вне квот. Прочерк сам по себе не подтверждает БВИ. Баллы по отдельным квотам в карточке не опубликованы.</p>
  </section>;
}

type RequirementNode = ApiSchemas["RequirementTreeRecord"]["root"];

function ExamCondition({ node }: { node: RequirementNode }) {
  if (node.kind === "leaf") {
    const minimum = node.minimum_score == null ? null : Number(node.minimum_score);
    return <div className={styles.exam}>
      <span>{subjectLabel(node.subject_name || node.subject_code || "Предмет не указан")}</span>
      <strong>{minimum !== null && Number.isFinite(minimum) ? `от ${minimum}` : "Минимум не указан"}</strong>
    </div>;
  }
  const label = node.operator === "AND" ? "Все условия обязательны"
    : node.operator === "OR" ? "Один вариант на выбор"
      : `Не менее ${node.threshold ?? "указанного числа"} из списка`;
  return <div className={styles.condition}>
    <p className={styles.conditionLabel}>{label}</p>
    <ul>{node.children.map((child) => <li key={child.node_key}><ExamCondition node={child} /></li>)}</ul>
  </div>;
}

export function AdmissionExams({ summary }: { summary: AdmissionSummary | undefined }) {
  if (!summary) return <p className={styles.note}>Не удалось загрузить экзамены. Повторите загрузку.</p>;
  if (!summary.requirements.length) return <p className={styles.note}>Экзамены не опубликованы в доступных данных.</p>;
  if (summary.requirements.length > 1) return <div className={styles.exams}>
    <p className={styles.note}>Минимальные баллы для выбранной программы требуют уточнения по правилам приёма.</p>
    <div className={styles.sources}>{[...new Set(summary.requirements.flatMap((item) => item.sourceUrls))].map((href) => <Source key={href} href={href} />)}</div>
  </div>;
  return <div className={styles.exams}>
    <p className={styles.note}>Минимальные баллы для допуска к конкурсу · {summary.year ?? "год не указан"}</p>
    <div className={styles.variants}>
      {summary.requirements.map((requirement) => <section className={styles.variant} key={`${requirement.category}:${requirement.text}`}>
        {requirement.applicantCategory ? <h4>{requirement.applicantCategory}</h4> : null}
        <ExamCondition node={requirement.root} />
        <div className={styles.sources}>{requirement.sourceUrls.map((href) => <Source key={href} href={href} />)}</div>
      </section>)}
    </div>
  </div>;
}
