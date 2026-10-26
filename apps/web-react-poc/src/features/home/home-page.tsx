import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useReducedMotion } from "motion/react";
import { AndromedaHeader } from "@/widgets/andromeda-navigation/andromeda-header";
import { RotatingText } from "@/shared/ui/rotating-text";
import { LearningOverviewAccordion } from "./learning-overview-accordion";
import { HomeFooter } from "./home-footer";
import { TrajectoryFinale } from "./trajectory-finale";
import styles from "./home-page.module.css";

const ComparisonShowcase = lazy(() => import("./comparison-showcase"));

export function HomePage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const showcaseRef = useRef<HTMLDivElement>(null);
  const [showcaseEnabled, setShowcaseEnabled] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    document.documentElement.classList.add("andromeda-home-active");
    document.body.classList.add("andromeda-home-active");
    return () => {
      document.documentElement.classList.remove("andromeda-home-active");
      document.body.classList.remove("andromeda-home-active");
    };
  }, []);

  useEffect(() => {
    const target = showcaseRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setShowcaseEnabled(true);
        observer.disconnect();
      }
    }, { rootMargin: "320px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={`${styles.homeRoot} ${menuOpen ? styles.menuOpen : ""}`}>
      <AndromedaHeader onOpenChange={setMenuOpen} />
      <div className={styles.pageScene} inert={menuOpen}>
        <main className={styles.page} id="top">
          <div className={styles.firstScreen} data-header-background-trigger>
            <section className={styles.hero} aria-label="МГТУ имени Баумана и Андромеда">
              <div className={styles.heroBackdrop} aria-hidden="true">
                <picture className={styles.campusPicture}>
                  <source
                    media="(max-width: 700px)"
                    srcSet="/assets/bmstu-campus-mobile-480.webp 480w, /assets/bmstu-campus-mobile-800.webp 800w, /assets/bmstu-campus-mobile-1122.webp 1122w"
                    sizes="max(100vw, 80svh)"
                  />
                  <img
                    className={styles.campusImage}
                    src="/assets/bmstu-campus-wide.webp"
                    alt=""
                    aria-hidden="true"
                    fetchPriority="high"
                    decoding="async"
                  />
                </picture>
              </div>
              <div className={styles.heroIntro}>
                <div>
                  <h1 className={styles.universityName}>
                    <span className={styles.sloganLead}>
                      <span className={styles.sloganPrefix}>Выбери</span>
                      <span className={styles.rotatingWordGroup}>
                        <RotatingText
                          texts={["направление", "программу", "специальность", "траекторию"]}
                          mainClassName={styles.rotatingWord ?? ""}
                          splitLevelClassName={styles.rotatingWordSplit ?? ""}
                          staggerFrom="last"
                          initial={prefersReducedMotion ? false : { y: "70%", opacity: 0 }}
                          animate={{ y: 0, opacity: 1 }}
                          exit={prefersReducedMotion ? { y: 0 } : { y: "-35%", opacity: 0 }}
                          staggerDuration={0.018}
                          transition={prefersReducedMotion ? { duration: 0 } : { type: "spring", duration: 0.52, bounce: 0 }}
                          rotationInterval={2600}
                          splitBy="characters"
                          auto={!prefersReducedMotion}
                          loop
                        />
                      </span>
                    </span>
                    <span className={styles.sloganFollowup}>Спроектируй своё будущее.</span>
                  </h1>
                </div>
              </div>
              <div className={styles.heroActions} role="group" aria-label="Основные действия">
                <Link viewTransition to="/discover" className={styles.heroPrimary}>Пройти профтест</Link>
                <Link viewTransition to="/compare" className={styles.heroSecondary}>Сравнить направление</Link>
              </div>
            </section>
          </div>

          <section className={`${styles.contentSection} ${styles.storySection} ${styles.comparisonOverviewSection}`} id="comparison-overview">
            <div className={styles.comparisonFeature}>
              <div className={styles.comparisonCopy}>
                <header className={styles.sectionHeading}>
                  <h2 className={styles.sectionTitle}>Всё для осознанного выбора направления</h2>
                </header>
              </div>
              <div className={styles.comparisonSwapViewport} ref={showcaseRef}>
                {showcaseEnabled ? <Suspense fallback={<div className={styles.comparisonPlaceholder} aria-label="Загружаем пример сравнения" />}>
                  <ComparisonShowcase />
                </Suspense> : <div className={styles.comparisonPlaceholder} aria-hidden="true" />}
              </div>
            </div>
          </section>

          <section className={`${styles.contentSection} ${styles.storySection} ${styles.learningOverviewSection}`} id="career-guidance">
            <header className={`${styles.sectionHeading} ${styles.learningOverviewHeading}`}>
              <h2 className={styles.learningOverviewTitle}>Индивидуальный подход</h2>
              <p className={styles.learningOverviewDescription}>Ещё ищешь своё направление или уже выбрал? Выбери подходящий путь: профтест и рекомендации либо сравнение программ.</p>
            </header>
            <LearningOverviewAccordion />
            <Link viewTransition className={styles.sectionAction} to="/programs">Открыть каталог программ</Link>
          </section>

          <TrajectoryFinale />
        </main>
        <HomeFooter />
      </div>

    </div>
  );
}
