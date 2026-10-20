import { memo, startTransition, useEffect, useState } from "react";
import type { CatalogProgram } from "./model";
import { ProgramCard } from "./program-card";
import styles from "./programs.module.css";

// Append every result, yielding between commits so input and scrolling stay usable.
// The complete verified catalog remains the source for filtering and totals.
const BATCH_SIZE = 12;

export const ProgramList = memo(function ProgramList({ programs, expectedReleaseKey, onSelectionLimit }: {
  programs: readonly CatalogProgram[];
  expectedReleaseKey: string;
  onSelectionLimit: (message: string) => void;
}) {
  const [batch, setBatch] = useState({ programs, count: BATCH_SIZE });
  const count = batch.programs === programs ? batch.count : BATCH_SIZE;
  const pending = count < programs.length;

  useEffect(() => {
    if (!pending) return;
    const frame = requestAnimationFrame(() => startTransition(() => {
      setBatch({ programs, count: Math.min(count + BATCH_SIZE, programs.length) });
    }));
    return () => cancelAnimationFrame(frame);
  }, [programs, count, pending]);

  return <div className={styles.grid} aria-busy={pending}>
    {programs.length === 0 ? <div className={styles.state}>
      <h2>Ничего не нашлось</h2>
      <p>Измените поисковый запрос или сбросьте фильтры, чтобы увидеть другие программы.</p>
    </div> : programs.slice(0, count).map((program) => <ProgramCard
      key={program.external_key}
      program={program}
      expectedReleaseKey={expectedReleaseKey}
      onSelectionLimit={onSelectionLimit}
    />)}
  </div>;
});
