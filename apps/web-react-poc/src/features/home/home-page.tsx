import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useReducedMotion } from "motion/react";
import { AndromedaHeader } from "@/widgets/andromeda-navigation/andromeda-header";
import CardSwap, { Card } from "@/shared/ui/card-swap";
import { RotatingText } from "@/shared/ui/rotating-text";
import { LearningOverviewAccordion } from "./learning-overview-accordion";
import styles from "./home-page.module.css";

export function HomePage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);
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
    const media = window.matchMedia("(max-width: 600px)");
    const updateViewport = () => setIsNarrowViewport(media.matches);

    updateViewport();
    media.addEventListener("change", updateViewport);
    return () => media.removeEventListener("change", updateViewport);
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
                    srcSet="/assets/bmstu-campus-mobile.webp"
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
              <p className={styles.heroBrand}>
                МГТУ имени Баумана <span>× Андромеда</span>
              </p>
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
                <Link to="/discover" className={styles.heroPrimary}>Пройти профтест</Link>
                <Link to="/compare" className={styles.heroSecondary}>Сравнить направление</Link>
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
              <div className={styles.comparisonSwapViewport}>
                <CardSwap
                  className={styles.comparisonSwap ?? ""}
                  width={isNarrowViewport ? 840 : 900}
                  height={isNarrowViewport ? 500 : 560}
                  cardDistance={isNarrowViewport ? 10 : 35}
                  verticalDistance={isNarrowViewport ? 24 : 36}
                  depth={isNarrowViewport ? 24 : 42}
                  skewAmount={6}
                  visibleCards={4}
                  delay={4000}
                  speed={1}
                  bounce={0.35}
                  parallax={0.5}
                  hoverSpread={0.12}
                  dim={0.5}
                  cardRadius={18}
                  theme="dark"
                  autoplay
                  pauseOnHover
                  draggable
                >
                <Card customClass={styles.comparisonCard ?? ""}>
                  <div className={styles.comparisonCardCopy}>
                    <h3 className={styles.comparisonCardTitle}>Учебные планы рядом</h3>
                    <p className={styles.comparisonCardDescription}>Сравнивай дисциплины и предметные категории в программах.</p>
                  </div>
                </Card>
                <Card customClass={styles.comparisonCard ?? ""}>
                  <div className={styles.comparisonCardCopy}>
                    <h3 className={styles.comparisonCardTitle}>Куда уходит учебное время</h3>
                    <p className={styles.comparisonCardDescription}>Изучай распределение опубликованных часов по категориям.</p>
                  </div>
                </Card>
                <Card customClass={styles.comparisonCard ?? ""}>
                  <div className={styles.comparisonCardCopy}>
                    <h3 className={styles.comparisonCardTitle}>Условия по каждому направлению</h3>
                    <p className={styles.comparisonCardDescription}>Сопоставляй опубликованные места, баллы и вступительные требования.</p>
                  </div>
                </Card>
                <Card customClass={styles.comparisonCard ?? ""}>
                  <div className={styles.comparisonCardCopy}>
                    <h3 className={styles.comparisonCardTitle}>Проверяй основу сравнения</h3>
                    <p className={styles.comparisonCardDescription}>Смотри год и источник опубликованных сведений.</p>
                  </div>
                </Card>
                </CardSwap>
              </div>
            </div>
          </section>

          <section className={`${styles.contentSection} ${styles.storySection} ${styles.learningOverviewSection}`} id="career-guidance">
            <header className={`${styles.sectionHeading} ${styles.learningOverviewHeading}`}>
              <h2 className={styles.learningOverviewTitle}>Индивидуальный подход</h2>
              <p className={styles.learningOverviewDescription}>Ещё ищешь своё направление или уже выбрал? Выбери подходящий путь: профтест и рекомендации либо сравнение программ.</p>
            </header>
            <LearningOverviewAccordion />
            <Link className={styles.sectionAction} to="/programs">Открыть каталог программ</Link>
          </section>

          <section className={`${styles.contentSection} ${styles.storySection}`} id="program-catalog">
            <header className={styles.sectionHeading}>
              <h2 className={styles.sectionTitle}>Изучи содержание каждой программы</h2>
              <p className={styles.sectionDescription}>Найди направление по названию или коду, открой карточку программы и изучи учебный план и сведения о поступлении.</p>
            </header>
            <div className={styles.storyGrid}>
              <article className={styles.storyCard}>
                <span className={styles.storyLabel}>Поиск</span>
                <h3 className={styles.storyTitle}>Найди нужное направление</h3>
                <p className={styles.storyDescription}>Ищи программы в каталоге и переходи к подробной карточке.</p>
              </article>
              <article className={styles.storyCard}>
                <span className={styles.storyLabel}>Содержание</span>
                <h3 className={styles.storyTitle}>Разберись, чему учат</h3>
                <p className={styles.storyDescription}>Открой доступные учебные сведения и первичные документы программы.</p>
              </article>
            </div>
            <Link className={styles.sectionAction} to="/programs">Открыть каталог программ</Link>
          </section>

          <section className={`${styles.contentSection} ${styles.storySection}`} id="admission-and-sources">
            <header className={styles.sectionHeading}>
              <h2 className={styles.sectionTitle}>Смотри на условия вместе с их контекстом</h2>
              <p className={styles.sectionDescription}>В карточках программ собраны опубликованные сведения о приёме. Указаны год и уровень данных; ссылка на источник доступна там, где она опубликована.</p>
            </header>
            <div className={`${styles.storyGrid} ${styles.admissionStoryGrid}`}>
              <article className={styles.storyCard}>
                <span className={styles.storyLabel}>Места</span>
                <h3 className={styles.storyTitle}>План набора и квоты</h3>
                <p className={styles.storyDescription}>Числа сопровождаются пояснением, к какому конкурсу и уровню данных они относятся.</p>
              </article>
              <article className={styles.storyCard}>
                <span className={styles.storyLabel}>Проходные баллы</span>
                <h3 className={styles.storyTitle}>Результаты прошлых кампаний</h3>
                <p className={styles.storyDescription}>Для опубликованных результатов видны год, этап конкурса и ссылка на источник.</p>
              </article>
              <article className={styles.storyCard}>
                <span className={styles.storyLabel}>Требования</span>
                <h3 className={styles.storyTitle}>Предметы и минимумы</h3>
                <p className={styles.storyDescription}>Открой условия направления и проверь опубликованные требования к поступлению.</p>
              </article>
            </div>
            <Link className={styles.sectionAction} to="/programs">Изучить условия поступления</Link>
          </section>

          <section className={`${styles.contentSection} ${styles.finalSection}`} id="final-cta">
            <div className={styles.finalCta}>
              <div className={styles.ctaCopy}>
                <span className={`${styles.sectionKicker} ${styles.ctaKicker}`}>Твой следующий шаг</span>
                <h2 className={styles.ctaTitle}>Выбери, с чего начать</h2>
                <p className={styles.ctaDescription}>Пройди тест, чтобы сузить выбор, или сравни два направления, которые уже тебя заинтересовали.</p>
              </div>
              <div className={styles.finalActions}>
                <Link className={styles.sectionAction} to="/discover">Пройти профтест</Link>
                <Link className={styles.sectionAction} to="/compare">Открыть сравнение</Link>
              </div>
            </div>
          </section>
        </main>
      </div>

    </div>
  );
}
