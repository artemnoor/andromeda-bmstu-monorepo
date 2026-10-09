import { useEffect, useState } from "react";
import type { CatalogProgram } from "./model";
import { getProgramAdmission } from "./admission-api";
import { buildAdmissionSummary, type AdmissionSummary } from "./admission-model";
import styles from "./programs.module.css";

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly summary: AdmissionSummary; readonly releaseKey: string };

function SourceLink({ href }: { href: string | null }) {
  if (!href) return null;
  return <a className={styles.sourceLink} href={href} target="_blank" rel="noopener noreferrer">Источник ↗</a>;
}

function Details({
  program,
  retryKey,
  onRetry,
}: {
  program: CatalogProgram;
  retryKey: number;
  onRetry: () => void;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let current = true;
    getProgramAdmission(program).then((data) => {
      if (current) setState({
        kind: "ready",
        summary: buildAdmissionSummary(program, data),
        releaseKey: data.releaseKey,
      });
    }).catch(() => {
      if (current) setState({
        kind: "error",
        message: "Не удалось загрузить условия из активного академического выпуска. Попробуйте повторить запрос.",
      });
    });
    return () => { current = false; };
  }, [program, retryKey]);

  if (state.kind === "loading") {
    return <p className={styles.admissionMuted} role="status">Загружаем места, условия и учебные сведения…</p>;
  }
  if (state.kind === "error") return (
    <div role="alert">
      <p className={styles.admissionMuted}>{state.message}</p>
      <button className={styles.retryAdmission} type="button" onClick={onRetry}>Повторить загрузку</button>
    </div>
  );

  const { summary } = state;
  return (
    <div className={styles.admissionPanel}>
      <section className={styles.admissionSection} aria-labelledby={`admission-seats-${program.external_key}`}>
        <h3 id={`admission-seats-${program.external_key}`}>Места и условия поступления · {summary.year ?? "год не указан"}</h3>
        <p className={styles.admissionNote}>Общий конкурс · сведения на уровне: {summary.seatScope}. Квоты показаны отдельно.</p>
        <div className={styles.admissionMetrics}>
          {summary.seats.map((metric) => (
            <article className={styles.admissionMetric} key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              {metric.note ? <span>{metric.note}</span> : null}
              <SourceLink href={metric.sourceUrl} />
            </article>
          ))}
        </div>
        {summary.seatNote ? <p className={styles.admissionMuted}>{summary.seatNote}</p> : null}
        {summary.quotas.length ? (
          <ul className={styles.admissionList} aria-label="Места по квотам">
            {summary.quotas.map((quota, index) => (
              <li key={`${quota.label}:${quota.scope}:${index}`}>
                <strong>{quota.label}: {quota.value}</strong>
                <span>Уровень данных: {quota.scope}</span>
                <SourceLink href={quota.sourceUrl} />
              </li>
            ))}
          </ul>
        ) : <p className={styles.admissionMuted}>Не найдены квоты с подтверждённой связью с этой программой. Данные более широкого уровня без точной идентичности предложения не приписываются программе.</p>}
        {summary.quotaNote ? <p className={styles.admissionMuted}>{summary.quotaNote}</p> : null}
      </section>

      <section className={styles.admissionSection} aria-labelledby={`admission-history-${program.external_key}`}>
        <h3 id={`admission-history-${program.external_key}`}>История зачисления · {summary.historyScope}</h3>
        {summary.history.length ? (
          <div className={styles.historyWrap}>
            <table className={styles.historyTable}>
              <thead><tr><th>Год</th><th>Основа</th><th>Минимум</th><th>Средний</th><th>Максимум</th><th>Зачислено</th><th>Источник</th></tr></thead>
              <tbody>{summary.history.map((row, index) => (
                <tr key={`${row.year}:${row.funding}:${index}`}>
                  <td>{row.year}</td><td>{row.funding}</td><td>{row.minimum}</td><td>{row.average}</td><td>{row.maximum}</td><td>{row.admitted}</td>
                  <td><SourceLink href={row.sourceUrl} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className={styles.admissionMuted}>Исторические результаты для подтверждённой кафедры или направления не найдены.</p>}
      </section>

      <section className={styles.admissionSection} aria-labelledby={`admission-requirements-${program.external_key}`}>
        <h3 id={`admission-requirements-${program.external_key}`}>Вступительные требования</h3>
        {summary.requirements.length ? (
          <ul className={styles.admissionList}>{summary.requirements.map((item, index) => (
            <li key={`${item.category}:${index}`}>
              <strong>{item.category}</strong><span>{item.text}</span><SourceLink href={item.sourceUrl} />
            </li>
          ))}</ul>
        ) : <p className={styles.admissionMuted}>Требования для этого направления не указаны в активном выпуске.</p>}
      </section>

      <section className={styles.admissionSection} aria-labelledby={`admission-offer-${program.external_key}`}>
        <h3 id={`admission-offer-${program.external_key}`}>Форма обучения и сроки</h3>
        {summary.offers.length || summary.dates.length || summary.tuition.length ? (
          <ul className={styles.admissionList}>
            {summary.offers.map((item) => <li key={item}><span>{item}</span></li>)}
            {summary.dates.map((item, index) => <li key={`${item.label}:${index}`}><strong>{item.label}</strong><span>{item.date}</span><SourceLink href={item.sourceUrl} /></li>)}
            {summary.tuition.map((item) => <li key={item}><span>{item}</span></li>)}
          </ul>
        ) : <p className={styles.admissionMuted}>Точные предложения для этой программы в активном выпуске не найдены.</p>}
      </section>
      <p className={styles.releaseNote}>Академический выпуск: <code>{state.releaseKey}</code></p>
    </div>
  );
}

export function AdmissionDetails({ program }: { program: CatalogProgram }) {
  const [retryKey, setRetryKey] = useState(0);
  return (
    <Details key={retryKey} program={program} retryKey={retryKey} onRetry={() => setRetryKey((value) => value + 1)} />
  );
}
