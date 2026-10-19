import { useEffect, useState } from "react";
import type { CatalogProgram } from "./model";
import { getProgramAdmission } from "./admission-api";
import { buildAdmissionSummary, type AdmissionCampaignResult, type AdmissionSummary } from "./admission-model";
import { admissionResultValue, COMPETITION_LABELS } from "./admission-results";
import styles from "./programs.module.css";

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly summary: AdmissionSummary; readonly releaseKey: string };

function SourceLink({ href }: { href: string | null }) {
  if (!href) return null;
  return <a className={styles.sourceLink} href={href} target="_blank" rel="noopener noreferrer">Источник ↗</a>;
}

function CampaignResult({ result }: { result: AdmissionCampaignResult }) {
  const funding = result.funding === "budget" ? "Бюджет" : result.funding === "paid" ? "Платное" : "Основа не указана";
  const stage = result.stage === "main" ? "основной этап" : result.stage === "first" ? "приоритетный этап" : "этап не указан";
  const numeric = result.status === "numeric" && result.score !== null;
  return <li>
    <strong>{funding} · {COMPETITION_LABELS[result.competitionType ?? ""] ?? "Вид конкурса не указан"}</strong>
    <span className={styles.campaignScore}>{admissionResultValue(result)}</span>
    <span>{result.year} · {stage} · {result.scopeNote}</span>
    {numeric ? <span>Минимум в опубликованном списке зачисленных, не гарантия поступления.</span> : null}
    <SourceLink href={result.sourceUrl} />
  </li>;
}

function Details({
  program,
  expectedReleaseKey,
  retryKey,
  onRetry,
}: {
  program: CatalogProgram;
  expectedReleaseKey: string;
  retryKey: number;
  onRetry: () => void;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    getProgramAdmission(program, { expectedReleaseKey, signal: controller.signal }).then((data) => {
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
    return () => {
      current = false;
      controller.abort();
    };
  }, [program, expectedReleaseKey, retryKey]);

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
        <p className={styles.admissionNote}>{summary.seatScope}. Бюджет — всего по приёмному плану, включая квоты; квоты повторно к нему не прибавляются.</p>
        <div className={styles.admissionMetrics}>
          {summary.seats.map((metric) => (
            <article className={styles.admissionMetric} key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value === "—"
                ? summary.relatedSeatFacts.some((fact) => fact.fundingType === (metric.label.startsWith("Бюджет") ? "budget" : "paid"))
                  ? "Иное название в приёмном плане"
                  : "Нет строки приёма для этого профиля"
                : metric.value}</strong>
              {metric.note ? <span>{metric.note}</span> : null}
              <SourceLink href={metric.sourceUrl} />
            </article>
          ))}
        </div>
        {summary.seatNote ? <p className={styles.admissionMuted}>{summary.seatNote}</p> : null}
        {summary.relatedSeatFacts.length ? <div className={styles.relatedFacts}>
          <p>Для этой кафедры приёмный план использует другие названия. Ниже — предложения именно из документа, а не места выбранного профиля.</p>
          <ul className={styles.admissionList}>{summary.relatedSeatFacts.map((fact) => <li key={fact.key}>
            <strong>{fact.fundingType === "budget" ? "Бюджет" : "Платное"} · {fact.value}</strong>
            <span>Предложение из источника: {fact.sourceProgramName}{fact.departmentCode ? ` · кафедра ${fact.departmentCode}` : ""}</span>
            {fact.note ? <span>{fact.note}</span> : null}
            <SourceLink href={fact.sourceUrl} />
          </li>)}</ul>
        </div> : null}
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
        {summary.directionQuotas.length ? <details className={styles.relatedFacts}>
          <summary>Целевые заказчики по направлению · {summary.directionQuotas.length}</summary>
          <p>Места опубликованы для направления и заказчика. Распределение по профилям не задано.</p>
          <ul className={styles.admissionList}>{summary.directionQuotas.map((quota, index) => <li key={index}><strong>{quota.label} · {quota.value}</strong><span>{quota.scope}</span><SourceLink href={quota.sourceUrl} /></li>)}</ul>
        </details> : null}
      </section>

      <section className={styles.admissionSection} aria-labelledby={`admission-results-${program.external_key}`}>
        <h3 id={`admission-results-${program.external_key}`}>Проходные баллы · приём {summary.year ?? "год не указан"}</h3>
        <p className={styles.admissionNote}>Общий конкурс и квоты показаны отдельно. У каждого результата указан уровень данных.</p>
        {summary.campaignResults.length ? <ul className={styles.admissionList}>
          {summary.campaignResults.map((result, index) => <CampaignResult key={`${result.funding}:${result.competitionType}:${result.stage}:${result.snapshotDate}:${index}`} result={result} />)}
        </ul> : <p className={styles.admissionMuted}>Результаты текущего приёма не найдены в доступных источниках. История прошлых лет показана ниже.</p>}
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

export function AdmissionDetails({ program, expectedReleaseKey }: { program: CatalogProgram; expectedReleaseKey: string }) {
  const [retryKey, setRetryKey] = useState(0);
  return (
    <Details
      key={`${expectedReleaseKey}:${program.external_key}:${retryKey}`}
      program={program}
      expectedReleaseKey={expectedReleaseKey}
      retryKey={retryKey}
      onRetry={() => setRetryKey((value) => value + 1)}
    />
  );
}
