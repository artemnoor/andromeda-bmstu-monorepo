import { useId, useState } from "react";
import { Link } from "react-router";
import type { PdfReport } from "./report-model";
import styles from "./share-actions.module.css";
import { trackEvent } from "@/shared/analytics/analytics";

export function ShareActions({ title, description, getLink, getReport, disabled = false, comparisonTo }: {
  title: string;
  description: string;
  getLink: () => string;
  getReport: () => PdfReport | Promise<PdfReport>;
  disabled?: boolean;
  comparisonTo?: string;
}) {
  const id = useId();
  const [link, setLink] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function copyLink() {
    const value = getLink();
    setLink(value);
    let copied = false;
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
    } catch { /* HTTP pages and browsers without Clipboard API use selection. */ }
    if (!copied) {
      const field = document.createElement("textarea");
      const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      field.value = value;
      field.readOnly = true;
      field.style.cssText = "position:fixed;left:0;top:0;opacity:0;pointer-events:none";
      document.body.append(field);
      try { field.select(); copied = document.execCommand("copy"); } catch { /* The visible field remains available. */ }
      finally { field.remove(); focused?.focus({ preventScroll: true }); }
    }
    setMessage(copied ? "Ссылка скопирована. Отправь её родителям или друзьям." : "Выдели ссылку ниже и скопируй её. Она откроется на другом устройстве.");
    trackEvent("share_link_created", { report_type: comparisonTo ? "prof_test" : "comparison", copied });
  }

  async function download() {
    if (busy) return;
    setBusy(true);
    setMessage("Готовим PDF…");
    const reportType = comparisonTo ? "prof_test" : "comparison";
    trackEvent("pdf_download_requested", { report_type: reportType });
    try {
      const { downloadReport } = await import("./download-report");
      await downloadReport(await getReport());
      setMessage("PDF готов. Файл передан браузеру для скачивания.");
      trackEvent("pdf_download_initiated", { report_type: reportType });
    } catch {
      trackEvent("pdf_download_failed", { report_type: reportType });
      setMessage("Не получилось создать PDF. Проверь соединение и попробуй ещё раз.");
    } finally { setBusy(false); }
  }

  return <section className={styles.panel} aria-labelledby={id} data-qa="share-actions">
    <h2 className={styles.heading} id={id}>{title}</h2>
    <p className={styles.description}>{description}</p>
    <div className={styles.actions}>
      <button type="button" className={styles.button} disabled={disabled} onClick={() => void copyLink()}>Получить ссылку</button>
      <button type="button" className={styles.button} disabled={disabled || busy} onClick={() => void download()} aria-busy={busy}>{busy ? "Готовим PDF…" : "Скачать PDF"}</button>
      {comparisonTo && <Link viewTransition className={styles.button} to={comparisonTo}>Сравнить рекомендации</Link>}
    </div>
    {link && <div className={styles.linkRow}><label className={styles.label} htmlFor={`${id}-link`}>Ссылка для отправки</label><input className={styles.link} id={`${id}-link`} readOnly value={getLink()} onFocus={event => event.currentTarget.select()} /></div>}
    {message && <p className={styles.status} role="status">{message}</p>}
  </section>;
}
