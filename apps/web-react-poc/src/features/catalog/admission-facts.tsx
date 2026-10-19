import type { ApiSchemas } from "@/shared/api/client";
import { subjectLabel, type AdmissionSummary } from "./admission-model";
import { SCORE_ROWS, scoreCell } from "./admission-table-model";
import styles from "./admission-facts.module.css";

export interface AdmissionColumn {
  readonly key: string;
  readonly label: string;
  readonly summary: AdmissionSummary | undefined;
}

function Source({ href }: { href: string }) {
  return <a className={styles.source} href={href} target="_blank" rel="noopener noreferrer">Источник ↗</a>;
}

export function AdmissionScoreTable({ columns, year }: { columns: readonly AdmissionColumn[]; year: number }) {
  const hasBvi = columns.some((column) => SCORE_ROWS.some((row) => scoreCell(column.summary, year, row).kind === "bvi"));
  return <section className={styles.section}>
    <h3>Проходные баллы · {year}</h3>
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className={styles.srOnly}>Минимальные баллы зачисленных в {year} году по видам конкурса</caption>
        <thead><tr><th scope="col">Конкурс</th>{columns.map((column) => <th scope="col" key={column.key}>{columns.length === 1 ? "Проходной балл" : column.label}</th>)}</tr></thead>
        <tbody>{SCORE_ROWS.map((row) => <tr key={row.key}>
          <th scope="row">{row.label}</th>
          {columns.map((column) => {
            const result = scoreCell(column.summary, year, row);
            return <td key={column.key} data-program-label={column.label}>
              <div className={styles.result} data-kind={result.kind}>
                <strong>{result.value}</strong>
                {result.note ? <span>{result.note}</span> : null}
                {result.sourceUrl ? <Source href={result.sourceUrl} /> : null}
              </div>
            </td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
    <p className={styles.note}>{hasBvi
      ? "БВИ — без вступительных испытаний. Числовой проходной для такого зачисления не применяется."
      : "Минимальные баллы среди опубликованных зачислений."}</p>
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
