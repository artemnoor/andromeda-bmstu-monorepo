import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Scale } from "lucide-react";
import { Link } from "react-router";
import { useComparisonSelection } from "@/shared/browser-state/hooks";
import styles from "./comparison-morph.module.css";

export function ComparisonIndicator() {
  const count = useComparisonSelection().length;
  const reduced = useReducedMotion();
  return <Link viewTransition to="/compare" data-comparison-target className={styles.headerTarget} aria-label={`Сравнение программ: выбрано ${count} из 3`} title={`Сравнение · ${count} из 3 программ`}>
    <Scale size={20} aria-hidden="true" />
    <AnimatePresence initial={false}>
      {count > 0 && <motion.span key={count} initial={{ scale: reduced ? 1 : 0 }} animate={{ scale: 1 }} exit={{ scale: reduced ? 1 : 0, opacity: 0 }} transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 32, mass: .7 }} className={styles.counter} aria-hidden="true">{count}</motion.span>}
    </AnimatePresence>
  </Link>;
}
