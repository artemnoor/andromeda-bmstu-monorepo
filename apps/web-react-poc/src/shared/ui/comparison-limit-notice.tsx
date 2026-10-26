import { useEffect, useState } from "react";
import { Link } from "react-router";
import { getComparisonSnapshot, MAX_COMPARE_PROGRAMS, subscribe } from "@/shared/browser-state/storage";
import styles from "./comparison-limit-notice.module.css";
import { trackEvent } from "@/shared/analytics/analytics";

const limitEvent = "andromeda:comparison-limit";

export function showComparisonLimitNotice() {
  trackEvent("comparison_limit_reached");
  window.dispatchEvent(new Event(limitEvent));
}

export function ComparisonLimitNotice() {
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let sequence = 0;
    const dismiss = () => {
      clearTimeout(timer);
      setAttempt(0);
    };
    const show = () => {
      clearTimeout(timer);
      setAttempt(++sequence);
      timer = setTimeout(dismiss, 7000);
    };
    const unsubscribe = subscribe(() => {
      if (getComparisonSnapshot().length < MAX_COMPARE_PROGRAMS) dismiss();
    });
    window.addEventListener(limitEvent, show);
    return () => {
      clearTimeout(timer);
      unsubscribe();
      window.removeEventListener(limitEvent, show);
    };
  }, []);

  return <div className={styles.region} role="status" aria-live="polite" aria-atomic="true">
    {attempt > 0 ? <div key={attempt} className={styles.notice}>
      <div className={styles.copy}>
        <strong>Уже добавлено максимум программ — {MAX_COMPARE_PROGRAMS}</strong>
        <span>Уберите одну из выбранных, чтобы добавить другую.</span>
        <Link viewTransition to="/compare" onClick={() => setAttempt(0)}>Открыть сравнение</Link>
      </div>
      <button type="button" className={styles.close} aria-label="Закрыть уведомление" onClick={() => setAttempt(0)}>×</button>
    </div> : null}
  </div>;
}
