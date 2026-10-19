import { useEffect, useState } from "react";
import type { CatalogProgram } from "./model";
import { getProgramAdmission } from "./admission-api";
import { buildAdmissionSummary, type AdmissionSummary } from "./admission-model";
import { AdmissionExams, AdmissionScoreTable } from "./admission-facts";
import styles from "./programs.module.css";

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly summary: AdmissionSummary; readonly releaseKey: string };

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
  const columns = [{ key: program.external_key, label: program.code, summary }];
  const previousYear = summary.year === null ? null : summary.year - 1;
  return (
    <div className={styles.admissionPanel}>
      {previousYear !== null ? <AdmissionScoreTable columns={columns} year={previousYear} /> : null}
      {summary.year !== null ? <AdmissionScoreTable columns={columns} year={summary.year} /> : null}
      <section className={styles.admissionSection} aria-labelledby={`admission-requirements-${program.external_key}`}>
        <h3 id={`admission-requirements-${program.external_key}`}>Необходимые экзамены{summary.year !== null ? ` · ${summary.year}` : ""}</h3>
        <AdmissionExams summary={summary} />
      </section>
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
