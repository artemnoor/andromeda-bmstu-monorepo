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
  const hasScoreResult = numeric || result.status === "bvi";
  return <li>
    <strong>{funding} · {COMPETITION_LABELS[result.competitionType ?? ""] ?? "Вид конкурса не указан"}</strong>
    {hasScoreResult ? <span className={styles.campaignScore}>{admissionResultValue(result)}</span> : null}
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
  const seenCountKeys = new Set<string>();
  const enrollmentCounts = summary.campaignResults.flatMap((result) => {
    const countKey = `${result.funding}:${result.stage}:${result.competitionType}`;
    if (result.admittedCount === null || seenCountKeys.has(countKey)) return [];
    seenCountKeys.add(countKey);
    return [{ result, countKey }];
  });
  const scoreResults = summary.campaignResults.filter((result) => result.status !== "count_only");
  return (
    <div className={styles.admissionPanel}>
      <section className={styles.admissionSection} aria-labelledby={`admission-enrolled-${program.external_key}`}>
        <h3 id={`admission-enrolled-${program.external_key}`}>Зачислено по приказам · {summary.year ?? "год не указан"}</h3>
        <p className={styles.admissionNote}>Фактическое число строк в официальных списках. Оно показано по направлению, этапу и виду конкурса; приказы разных этапов не складываются.</p>
        {enrollmentCounts.length ? <div className={styles.admissionMetrics}>
          {enrollmentCounts.map(({ result, countKey }) => (
            <article className={styles.admissionMetric} key={countKey}>
              <span>{result.funding === "budget" ? "Бюджет" : result.funding === "paid" ? "Платное" : "Основа не указана"} · {COMPETITION_LABELS[result.competitionType ?? ""] ?? "Вид конкурса не указан"}</span>
              <strong>Зачислено: {new Intl.NumberFormat("ru-RU").format(result.admittedCount ?? 0)}</strong>
              <span>{result.stage === "main" ? "Основной этап" : result.stage === "first" ? "Приоритетный этап" : "Этап не указан"} · {result.scopeNote}</span>
              <SourceLink href={result.sourceUrl} />
            </article>
          ))}
        </div> : <p className={styles.admissionMuted}>Число зачисленных не опубликовано в доступных приказах.</p>}
      </section>

      <section className={styles.admissionSection} aria-labelledby={`admission-seats-${program.external_key}`}>
        <h3 id={`admission-seats-${program.external_key}`}>План приёма и квоты · {summary.year ?? "год не указан"}</h3>
        <p className={styles.admissionNote}>{summary.seatScope}. Эти значения относятся к плану приёма. Фактическое число зачисленных показано отдельно по опубликованным приказам.</p>
        <div className={styles.admissionMetrics}>
          {summary.seats.map((metric) => (
            <article className={styles.admissionMetric} key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value === "—"
                ? "Нет подтверждённых данных"
                : metric.value}</strong>
              {metric.note ? <span>{metric.note}</span> : null}
              <SourceLink href={metric.sourceUrl} />
            </article>
          ))}
        </div>
        {summary.seatNote ? <p className={styles.admissionMuted}>{summary.seatNote}</p> : null}
        {summary.quotas.length ? (
          <ul className={styles.admissionList} aria-label="Плановые квоты">
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
        <h3 id={`admission-results-${program.external_key}`}>Проходные баллы и зачисление · приём {summary.year ?? "год не указан"}</h3>
        <p className={styles.admissionNote}>Общий конкурс и квоты показаны раздельно. У каждого результата указан уровень данных.</p>
        {scoreResults.length ? <ul className={styles.admissionList}>
          {scoreResults.map((result, index) => (
            <CampaignResult
              key={`${result.funding}:${result.competitionType}:${result.stage}:${result.status}:${result.snapshotDate}:${index}`}
              result={result}
            />
          ))}
        </ul> : <p className={styles.admissionMuted}>{enrollmentCounts.length
          ? "Число зачисленных опубликовано выше, но баллы для этих записей в приказе не распознаны."
          : "Результаты текущего приёма не найдены в доступных источниках. История прошлых лет показана ниже."}</p>}
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
