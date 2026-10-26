// Adapted from Amicro AddToCartMorph (MIT). Original source and license: ./vendor/amicro/.
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Transition } from "motion/react";
import { Check, Plus, RotateCcw } from "lucide-react";
import { createPortal } from "react-dom";
import { getComparisonSnapshot, MAX_COMPARE_PROGRAMS } from "@/shared/browser-state/storage";
import { showComparisonLimitNotice } from "./comparison-limit-notice";
import styles from "./comparison-morph.module.css";

export function ComparisonMorph({ selected, onToggle, label }: {
  selected: boolean;
  onToggle: () => boolean | void;
  label?: string;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const [isAdded, setIsAdded] = useState(false);
  const [flight, setFlight] = useState<{ x: number; y: number; dx: number; dy: number; id: number } | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReduceMotion = useReducedMotion();
  const spring: Transition = shouldReduceMotion
    ? { duration: 0 }
    : { type: "spring", stiffness: 380, damping: 32, mass: 0.7 };

  useEffect(() => () => { if (timeout.current !== null) clearTimeout(timeout.current); }, []);

  function handleToggle() {
    if (!selected && getComparisonSnapshot().length >= MAX_COMPARE_PROGRAMS) showComparisonLimitNotice();
    if (onToggle() === false) return;
    if (timeout.current !== null) clearTimeout(timeout.current);
    setIsAdded(!selected);
    setFlight(null);
    if (!selected && !shouldReduceMotion) {
      const source = button.current?.getBoundingClientRect();
      const target = document.querySelector("[data-comparison-target]")?.getBoundingClientRect();
      if (source && target) setFlight({ x: source.x + source.width / 2 - 10, y: source.y + source.height / 2 - 10, dx: target.x + target.width / 2 - source.x - source.width / 2, dy: target.y + target.height / 2 - source.y - source.height / 2, id: performance.now() });
    }
    if (!selected) timeout.current = setTimeout(() => {
      setIsAdded(false);
      setFlight(null);
    }, 1400);
  }

  return <>
    <div className={styles.wrapper}>
      <div className={styles.row}>
        <motion.button
          ref={button}
          layout={!shouldReduceMotion}
          type="button"
          onClick={handleToggle}
          whileTap={{ scale: shouldReduceMotion ? 1 : 0.97 }}
          transition={spring}
          className={styles.action}
          data-added={isAdded && selected}
          aria-pressed={selected}
          aria-label={label ?? (selected ? "✓ В сравнении" : "Добавить в сравнение")}
          title={selected ? "Убрать из сравнения" : "Добавить в сравнение"}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {isAdded && selected ? <motion.span key="added" initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: shouldReduceMotion ? 0 : -10 }} transition={spring} className={styles.buttonLabel}>
              <Check strokeWidth={2.5} />Добавлено
            </motion.span> : <motion.span key={selected ? "selected" : "add"} initial={{ opacity: 0, y: shouldReduceMotion ? 0 : -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: shouldReduceMotion ? 0 : 10 }} transition={spring} className={styles.buttonLabel}>
              {selected ? <Check /> : <Plus />}{selected ? "В сравнении" : "Добавить"}
            </motion.span>}
          </AnimatePresence>
        </motion.button>
        {selected && <button type="button" onClick={handleToggle} className={styles.reset} title="Убрать программу из сравнения" aria-label="Убрать программу из сравнения"><RotateCcw size={14} aria-hidden="true" /></button>}
      </div>
    </div>
    {flight && createPortal(<motion.span key={flight.id} className={styles.flight} style={{ left: flight.x, top: flight.y }} initial={{ x: 0, y: 0, scale: 1 }} animate={{ x: flight.dx, y: flight.dy, scale: .8 }} transition={{ type: "spring", stiffness: 340, damping: 28 }} onAnimationComplete={() => setFlight(null)} aria-hidden="true">+1</motion.span>, document.body)}
  </>;
}
