import { useEffect, useRef } from "react";
import styles from "./trajectory-finale.module.css";

/** Native scroll timeline; no scroll handlers or React updates per frame. */
export function TrajectoryFinale() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || (typeof CSS !== "undefined" && CSS.supports?.("animation-timeline", "view()"))) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      element.dataset.revealed = "true";
      observer.disconnect();
    }, { threshold: .15 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <section ref={ref} className={styles.section} aria-labelledby="trajectory-title">
    <h2 id="trajectory-title">У каждого —<br /><em>своя траектория.</em></h2>
    <div className={styles.universe} aria-hidden="true">
      <div className={styles.orbits}>
        <svg viewBox="0 0 920 390" fill="none">
          <ellipse cx="460" cy="195" rx="416" ry="104" transform="rotate(-14 460 195)" stroke="currentColor" strokeWidth="1.2" />
          <ellipse cx="460" cy="195" rx="330" ry="145" transform="rotate(18 460 195)" stroke="#d9b8fe" strokeOpacity=".45" strokeWidth="1" strokeDasharray="4 8" />
          <circle cx="100" cy="297" r="8" fill="#8dedf9" />
          <circle cx="792" cy="154" r="6" fill="#d9b8fe" />
          <circle cx="448" cy="49" r="4" fill="white" />
          <circle cx="460" cy="195" r="68" stroke="white" strokeOpacity=".12" />
        </svg>
      </div>
      <img className={styles.mark} src="/assets/andromeda-symbol.webp" width="144" height="96" alt="" loading="lazy" />
      <span className={`${styles.label} ${styles.start}`}>Интерес</span>
      <span className={`${styles.label} ${styles.finish}`}>Твоё будущее</span>
    </div>
  </section>;
}
