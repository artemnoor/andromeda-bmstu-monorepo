import styles from "./screen-loader.module.css";

export function ScreenLoader({ label = "Открываем страницу", overlay = false }: { label?: string; overlay?: boolean }) {
  return <div className={`${styles.loader} ${overlay ? styles.overlay : ""}`} role="status" aria-live="polite" aria-label={label}>
    <div className={styles.orbit} aria-hidden="true"><img src="/favicon-120x120.png" alt="" /><span /></div>
    <p>{label}<span className={styles.dots} aria-hidden="true">···</span></p>
  </div>;
}
