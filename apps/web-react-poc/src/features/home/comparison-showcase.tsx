import { useEffect, useState } from "react";
import CardSwap, { Card } from "@/shared/ui/card-swap";
import { comparisonPreview as preview, type PreviewProgram } from "./comparison-preview-data";
import HoursPreview from "./comparison-hours-preview";
import comparisonStyles from "@/features/comparison/comparison.module.css";
import admissionStyles from "@/features/catalog/admission-facts.module.css";
import identityStyles from "@/features/catalog/program-identity.module.css";
import styles from "./comparison-showcase.module.css";

const ACTIVE_CARD_KEY = "home-comparison-active-card";
const readActiveCard = () => {
  try {
    const saved = window.sessionStorage.getItem(ACTIVE_CARD_KEY);
    const index = Number(saved);
    return { index: Number.isInteger(index) && index >= 0 && index < 4 ? index : 0, restored: saved !== null };
  } catch {
    return { index: 0, restored: false };
  }
};
const saveActiveCard = (index: number) => {
  try { window.sessionStorage.setItem(ACTIVE_CARD_KEY, String(index)); } catch { /* Storage can be unavailable in restricted browsers. */ }
};

function PreviewIdentity({ program }: { program: PreviewProgram }) {
  return <span className={identityStyles.identity}>
    <span className={identityStyles.code}>{program.code}</span>
    <span className={identityStyles.name + " " + styles.previewName}>{program.name}</span>
    <span className={identityStyles.department}>
      <span className={styles.departmentFull}>{program.department}</span>
      <span className={styles.departmentShort}>{program.department.split(" · ")[0]}</span>
    </span>
  </span>;
}

function CurriculumPreview() {
  return <table className={comparisonStyles.table + " " + comparisonStyles.matrixTable}>
    <caption className={comparisonStyles.srOnly}>Пример сравнения дисциплин программ ИУ9 и ФН11</caption>
    <thead><tr><th scope="col">Дисциплина</th>{preview.programs.map(program => <th scope="col" key={program.key}><PreviewIdentity program={program} /></th>)}</tr></thead>
    <tbody>{preview.curriculum.map(row => <tr key={row.key}>
      <th scope="row"><span className={comparisonStyles.matrixTitle}>{row.title}</span></th>
      {row.cells.map((items, index) => <td key={index}>{items.length ? items.map((item, itemIndex) => <div className={comparisonStyles.courseEntry} key={itemIndex}>
        <span className={comparisonStyles.courseCategory}>{item.category}</span><span className={comparisonStyles.courseMeta}>{item.details}</span>
      </div>) : <span className={comparisonStyles.matrixMissing}>Нет позиции с таким названием в подтверждённом плане</span>}</td>)}
    </tr>)}</tbody>
  </table>;
}

function AdmissionPreview({ kind }: { kind: "enrollment" | "scores" }) {
  return preview.admissions.map(admission => <section className={admissionStyles.section} key={admission.year}>
    <h3>{kind === "enrollment" ? "Зачислено на направление подготовки" : "Проходные баллы"} · {admission.year}</h3>
    <div className={admissionStyles.tableWrap}><table className={admissionStyles.table}>
      <thead><tr><th scope="col">{kind === "enrollment" ? "Показатель" : "Конкурс"}</th>{preview.programs.map(program => <th scope="col" key={program.key}><PreviewIdentity program={program} /></th>)}</tr></thead>
      <tbody>{admission[kind].map(row => <tr key={row.key}>
        <th scope="row">{row.label}</th>
        {row.cells.map((cell, index) => <td key={index}><div className={admissionStyles.result} data-kind={cell.kind}>
          <strong>{cell.value}</strong>{cell.note && <span>{cell.note}</span>}
          {cell.sources.map(source => <a className={admissionStyles.source} key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.label} ↗</a>)}
          {"bviSourceUrl" in cell && cell.bviSourceUrl && <a className={admissionStyles.source} href={cell.bviSourceUrl} target="_blank" rel="noopener noreferrer">Приказ о зачислении БВИ ↗</a>}
        </div></td>)}
      </tr>)}</tbody>
    </table></div>
    <p className={admissionStyles.note}>{kind === "enrollment"
      ? "Зачислено на всё направление подготовки, включая все его профили, по опубликованным приказам. Квоты входят в бюджетный итог и показаны отдельно как его часть."
      : "Числовые баллы сначала берём из официальной карточки направления МГТУ. Если там числа нет, используем минимум по общему конкурсу из проверенного основного приказа. Если числа нет ни в карточке, ни в приказе, показываем «Не опубликован». БВИ — без вступительных испытаний; такая отметка подтверждается отдельно приказом о зачислении вне квот. Прочерк сам по себе не подтверждает БВИ. Баллы по отдельным квотам в карточке не опубликованы."}</p>
  </section>);
}

// Keep every preview mounted and stable throughout animation and route restores.
const CARDS = [
  { title: "Учебные планы рядом", description: "Сравнивай дисциплины и предметные категории в программах.", content: <CurriculumPreview /> },
  { title: "Куда уходит учебное время", description: "Изучай распределение опубликованных часов по категориям.", content: <HoursPreview /> },
  { title: "Условия по каждому направлению", description: "Сопоставляй опубликованные места, баллы и вступительные требования.", content: <AdmissionPreview kind="enrollment" /> },
  { title: "Проверяй основу сравнения", description: "Смотри год и источник опубликованных сведений.", content: <AdmissionPreview kind="scores" /> },
].map(card => <Card customClass={styles.stackCard ?? ""} key={card.title}>
  <header className={styles.cardHeader}><h3>{card.title}</h3><p>{card.description}</p></header>
  <div className={styles.previewFrame} data-swap-interactive tabIndex={0} role="region" aria-label={"Пример сравнения: " + card.title}>{card.content}</div>
</Card>);

export default function ComparisonShowcase() {
  const [deckState] = useState(readActiveCard);
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 600px)").matches);
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const size = window.matchMedia("(max-width: 600px)");
    const updateMotion = () => setReducedMotion(motion.matches);
    const updateSize = () => setNarrow(size.matches);
    motion.addEventListener("change", updateMotion);
    size.addEventListener("change", updateSize);
    return () => { motion.removeEventListener("change", updateMotion); size.removeEventListener("change", updateSize); };
  }, []);

  return <CardSwap className={styles.stack ?? ""} width={narrow ? 600 : 900} height={narrow ? 600 : 560} cardDistance={narrow ? 10 : 35} verticalDistance={narrow ? 24 : 36} depth={narrow ? 24 : 42} skewAmount={6} visibleCards={4} initialIndex={deckState.index} onChange={saveActiveCard} intro={!deckState.restored} delay={6000} speed={1} bounce={0.35} parallax={0.5} hoverSpread={0.12} dim={0.5} cardRadius={18} theme="dark" renderAtDisplaySize autoplay={!reducedMotion} pauseOnHover={!narrow} draggable={!narrow} interactive={!narrow}>
    {CARDS}
  </CardSwap>;
}
