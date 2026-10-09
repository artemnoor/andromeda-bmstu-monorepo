import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import styles from "./home-page.module.css";

const stats = [
  ["14000+", "учебных дисциплин"],
  ["22", "факультета"],
  ["600+", "образовательных программ"],
  ["13", "областей исследований"],
  ["50+", "НОЦ и лабораторий"],
  ["3", "филиала"],
  ["9000+", "сотрудников"],
  ["31000+", "студентов и аспирантов"],
  ["5000+", "выпускников ежегодно"],
  ["32%", "доля гособоронзаказа"],
] as const;

const legacyWebBase = (import.meta.env.VITE_LEGACY_WEB_BASE_URL || "http://127.0.0.1:4173").replace(/\/$/, "");
const discoverUrl = `${legacyWebBase}/discover.html`;
const admissionUrl = `${legacyWebBase}/admission.html`;

function legacyLinkNote() {
  return <span className={styles.srOnly}>Откроется в исходной версии Andromeda в новой вкладке.</span>;
}

function HeroVisual() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const shapeRef = useRef<SVGPathElement>(null);
  const outlineRef = useRef<SVGPathElement>(null);
  const photoRef = useRef<SVGImageElement>(null);
  const photoEdgeRef = useRef<SVGImageElement>(null);
  const photoClipRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const svg = svgRef.current;
    const shape = shapeRef.current;
    const outline = outlineRef.current;
    const photo = photoRef.current;
    const photoEdge = photoEdgeRef.current;
    const photoClip = photoClipRef.current;
    if (!wrap || !svg || !shape || !outline || !photo || !photoEdge || !photoClip) return;

    const clamp = (min: number, value: number, max: number) => Math.max(min, Math.min(value, max));
    const update = () => {
      const width = wrap.clientWidth;
      const height = wrap.clientHeight;
      if (!width || !height) return;

      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      const mobile = width < 700;
      const tablet = width >= 700 && width < 1100;
      const photoAspect = mobile ? "xMidYMid slice" : "none";
      photo.setAttribute("preserveAspectRatio", photoAspect);
      photoEdge.setAttribute("preserveAspectRatio", photoAspect);

      const padding = mobile ? clamp(18, width * 0.055, 28) : clamp(24, width * 0.032, 52);
      const radius = mobile ? clamp(18, width * 0.065, 30) : clamp(22, width * 0.024, 38);
      const topY = mobile ? clamp(72, height * 0.12, 105) : clamp(85, height * 0.17, 135);
      const towerWidth = mobile
        ? clamp(72, width * 0.22, 110)
        : tablet ? clamp(95, width * 0.15, 145) : clamp(120, width * 0.09, 170);
      const towerX = width - padding - towerWidth;
      const rightX = width - padding;
      const leftX = padding;

      wrap.style.setProperty("--university-name-left", `${leftX + 18}px`);
      wrap.style.setProperty("--university-name-top", `${topY - (mobile ? 54 : 34)}px`);
      wrap.style.setProperty("--university-name-right", `${width - towerX + 24}px`);

      const leftStepY = mobile ? clamp(220, height * 0.34, 300) : clamp(250, height * 0.49, 410);
      const bottomY = height - padding;
      const lowerStepWidth = mobile
        ? clamp(86, width * 0.28, 145)
        : tablet ? clamp(150, width * 0.19, 220) : clamp(250, width * 0.19, 390);
      const lowerStepX = width - padding - lowerStepWidth;
      const rightStepY = mobile
        ? clamp(height * 0.68, height - 190, height * 0.78)
        : clamp(height * 0.73, height - 120, height * 0.82);
      const lowerLeftX = mobile ? clamp(45, width * 0.16, 78) : clamp(80, width * 0.075, 135);

      const pathData = `
        M ${leftX + radius} ${topY}
        L ${towerX - radius} ${topY}
        Q ${towerX} ${topY} ${towerX} ${topY - radius}
        L ${towerX} ${padding + radius}
        Q ${towerX} ${padding} ${towerX + radius} ${padding}
        L ${rightX - radius} ${padding}
        Q ${rightX} ${padding} ${rightX} ${padding + radius}
        L ${rightX} ${rightStepY - radius}
        Q ${rightX} ${rightStepY} ${rightX - radius} ${rightStepY}
        L ${lowerStepX + radius} ${rightStepY}
        Q ${lowerStepX} ${rightStepY} ${lowerStepX} ${rightStepY + radius}
        L ${lowerStepX} ${bottomY - radius}
        Q ${lowerStepX} ${bottomY} ${lowerStepX - radius} ${bottomY}
        L ${lowerLeftX + radius} ${bottomY}
        Q ${lowerLeftX} ${bottomY} ${lowerLeftX} ${bottomY - radius}
        L ${lowerLeftX} ${leftStepY + radius}
        Q ${lowerLeftX} ${leftStepY} ${lowerLeftX - radius} ${leftStepY}
        L ${leftX + radius} ${leftStepY}
        Q ${leftX} ${leftStepY} ${leftX} ${leftStepY - radius}
        L ${leftX} ${topY + radius}
        Q ${leftX} ${topY} ${leftX + radius} ${topY}
        Z
      `;
      shape.setAttribute("d", pathData);
      outline.setAttribute("d", pathData);
      photoClip.setAttribute("d", pathData);
    };

    const observer = new ResizeObserver(update);
    observer.observe(wrap);
    window.addEventListener("orientationchange", update);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return (
    <div className={styles.heroShape} ref={wrapRef}>
      <svg ref={svgRef} aria-hidden="true" focusable="false">
        <defs>
          <clipPath id="homeHeroPhotoClip" clipPathUnits="userSpaceOnUse">
            <path ref={photoClipRef} />
          </clipPath>
          <linearGradient id="homeHeroPhotoFadeGradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#000" />
            <stop offset=".02" stopColor="#000" />
            <stop offset=".13" stopColor="#fff" />
            <stop offset=".87" stopColor="#fff" />
            <stop offset=".98" stopColor="#000" />
            <stop offset="1" stopColor="#000" />
          </linearGradient>
          <mask id="homeHeroPhotoFade" maskUnits="objectBoundingBox" maskContentUnits="objectBoundingBox" x="0" y="0" width="1" height="1">
            <rect x="0" y="0" width="1" height="1" fill="url(#homeHeroPhotoFadeGradient)" />
          </mask>
          <filter id="homeHeroSoftGlow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy="8" stdDeviation="12" floodColor="#1388ff" floodOpacity=".20" />
          </filter>
          <filter id="homeHeroPhotoEdgeBlur" x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>
        <path className={styles.heroFill} ref={shapeRef} />
        <image
          ref={photoEdgeRef}
          className={styles.heroPhotoEdge}
          href="/assets/bmstu-glass-campus-clouds.png"
          x="0"
          y="0"
          width="100%"
          height="100%"
          preserveAspectRatio="none"
          clipPath="url(#homeHeroPhotoClip)"
          filter="url(#homeHeroPhotoEdgeBlur)"
        />
        <image
          ref={photoRef}
          className={styles.heroPhoto}
          href="/assets/bmstu-glass-campus-clouds.png"
          x="0"
          y="0"
          width="100%"
          height="100%"
          preserveAspectRatio="none"
          clipPath="url(#homeHeroPhotoClip)"
          mask="url(#homeHeroPhotoFade)"
        />
        <path className={styles.heroOutline} ref={outlineRef} />
      </svg>
      <h1 className={styles.universityName}>МГТУ имени Баумана × Андромеда</h1>
    </div>
  );
}

function HeroOrbits() {
  return (
    <div className={styles.heroOrbits} aria-hidden="true">
      <span className={`${styles.heroOrbit} ${styles.orbitUpperLeft}`}><span className={styles.orbitSatellite} /></span>
      <span className={`${styles.heroOrbit} ${styles.orbitUpperRight}`}><span className={styles.orbitSatellite} /></span>
      <span className={`${styles.heroOrbit} ${styles.orbitLeftSide}`}><span className={styles.orbitSatellite} /></span>
      <span className={`${styles.heroOrbit} ${styles.orbitRightSide}`}><span className={styles.orbitSatellite} /></span>
    </div>
  );
}

function HomeMenu({ open, onClose, onOpen }: { open: boolean; onClose: () => void; onOpen: () => void }) {
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const previousOverflowRef = useRef("");
  const wasOpenRef = useRef(false);

  useEffect(() => {
    let focusFrame = 0;
    if (open) {
      wasOpenRef.current = true;
      previousOverflowRef.current = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      if (typeof window.requestAnimationFrame === "function") {
        focusFrame = window.requestAnimationFrame(() => firstLinkRef.current?.focus());
      } else {
        firstLinkRef.current?.focus();
      }
    } else {
      document.body.style.overflow = previousOverflowRef.current;
      if (wasOpenRef.current) {
        wasOpenRef.current = false;
        openButtonRef.current?.focus();
      }
    }

    return () => {
      if (focusFrame) window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflowRef.current;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = [
        closeButtonRef.current,
        ...Array.from(menuPanelRef.current?.querySelectorAll<HTMLElement>('a[href]') ?? []),
      ].filter((element): element is HTMLElement => element !== null);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      const activeIndex = focusable.findIndex((element) => element === document.activeElement);
      if (event.shiftKey && activeIndex <= 0) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeIndex === -1 || activeIndex === focusable.length - 1)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return (
    <>
      <div className={styles.backdrop} aria-hidden="true" onClick={onClose} />
      {!open && (
        <button
          ref={openButtonRef}
          className={styles.menuButton}
          type="button"
          aria-label="Открыть меню"
          aria-expanded="false"
          aria-controls="homeMenuPanel"
          onClick={onOpen}
        >
          <span />
          <span />
        </button>
      )}
      <div
        ref={menuPanelRef}
        className={styles.menuShell}
        id="homeMenuPanel"
        aria-label="Основная навигация"
        aria-modal="true"
        aria-hidden={!open}
        inert={!open}
        role="dialog"
      >
        {open && (
          <button
            ref={closeButtonRef}
            className={styles.menuButton}
            type="button"
            aria-label="Закрыть меню"
            aria-expanded="true"
            aria-controls="homeMenuPanel"
            onClick={onClose}
          >
            <span />
            <span />
          </button>
        )}
        <aside className={styles.menuPanel}>
          <div className={styles.menuContent}>
            <nav aria-label="Разделы сайта">
              <ul className={styles.menuList}>
                <li className={styles.menuItem}>
                  <Link ref={firstLinkRef} to="/" className={styles.menuLink} onClick={onClose}>
                    <span className={styles.menuLabel}>Главная</span>
                  </Link>
                </li>
                <li className={styles.menuItem}>
                  <a href={discoverUrl} target="_blank" rel="noopener noreferrer" className={styles.menuLink} onClick={onClose} aria-label="Проф-тест, исходная версия Andromeda, новая вкладка">
                    <span className={styles.menuLabel}>Проф-тест</span>{legacyLinkNote()}
                  </a>
                </li>
                <li className={styles.menuItem}>
                  <Link to="/compare" className={styles.menuLink} onClick={onClose}>
                    <span className={styles.menuLabel}>Сравнить программы</span>
                  </Link>
                </li>
                <li className={styles.menuItem}>
                  <Link to="/programs" className={styles.menuLink} onClick={onClose}>
                    <span className={styles.menuLabel}>Каталог программ</span>
                  </Link>
                </li>
              </ul>
            </nav>
            <div className={styles.menuFooter}>
              <div className={styles.socials}>
                <span>Telegram</span><span>Instagram</span><span>Behance</span><span>Email</span>
              </div>
              <div className={styles.copyright}>© 2026<br />London / Moscow</div>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

export function HomePage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [headerVisible, setHeaderVisible] = useState(false);
  const heroRef = useRef<HTMLElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const openMenu = useCallback(() => setMenuOpen(true), []);

  useEffect(() => {
    document.documentElement.classList.add("andromeda-home-active");
    document.body.classList.add("andromeda-home-active");
    return () => {
      document.documentElement.classList.remove("andromeda-home-active");
      document.body.classList.remove("andromeda-home-active");
    };
  }, []);

  useEffect(() => {
    const updateHeader = () => setHeaderVisible((heroRef.current?.getBoundingClientRect().bottom ?? 1) <= 0);
    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });
    window.addEventListener("resize", updateHeader);
    return () => {
      window.removeEventListener("scroll", updateHeader);
      window.removeEventListener("resize", updateHeader);
    };
  }, []);

  return (
    <div className={`${styles.homeRoot} ${menuOpen ? styles.menuOpen : ""}`}>
      <div className={styles.pageScene} inert={menuOpen}>
        <header className={`${styles.siteHeader} ${headerVisible ? styles.siteHeaderVisible : ""}`} aria-hidden="true" />
        <div className={styles.logo} aria-hidden="true">
          <img src="/assets/andromeda-symbol.png" alt="" />
        </div>
        <main className={styles.page} id="top">
          <section className={styles.hero} ref={heroRef} aria-label="МГТУ имени Баумана и Андромеда">
            <HeroOrbits />
            <HeroVisual />
          </section>

          <section className={styles.statsMarquee} aria-label="Показатели МГТУ имени Н. Э. Баумана">
            <div className={styles.statsTrack}>
              {[0, 1].map((copy) => (
                <div className={styles.statsGroup} key={copy} role={copy === 0 ? "list" : undefined} aria-hidden={copy === 1 ? true : undefined}>
                  {stats.map(([value, label]) => (
                    <div className={styles.statsItem} key={`${copy}-${label}`} role={copy === 0 ? "listitem" : undefined}>
                      <span className={styles.statsValue}>{value}</span>
                      <span className={styles.statsLabel}>{label}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>

          <section className={styles.homeActions} id="home-actions" aria-label="Возможности сервиса">
            <a className={styles.actionCard} href={discoverUrl} target="_blank" rel="noopener noreferrer" aria-label="Пройти проф-тест, исходная версия Andromeda, новая вкладка">
              <span className={styles.featureNumber}>01</span>
              <span className={styles.actionCopy}><strong>Пройти тест</strong><span>Получить персональную подборку</span>{legacyLinkNote()}</span>
            </a>
            <Link className={styles.actionCard} to="/compare" aria-label="Сравнить программы">
              <span className={styles.featureNumber}>02</span>
              <span className={styles.actionCopy}><strong>Сравнить программы</strong><span>Учебные планы, предметы, поступление</span></span>
            </Link>
            <a className={styles.actionCard} href={admissionUrl} target="_blank" rel="noopener noreferrer" aria-label="Проверить поступление, исходная версия Andromeda, новая вкладка">
              <span className={styles.featureNumber}>03</span>
              <span className={styles.actionCopy}><strong>Проверить шансы</strong><span>Баллы ЕГЭ, олимпиады, квоты, достижения</span>{legacyLinkNote()}</span>
            </a>
            <Link className={styles.actionCard} to="/programs" aria-label="Открыть каталог образовательных программ">
              <span className={styles.featureNumber}>04</span>
              <span className={styles.actionCopy}><strong>Изучить программы</strong></span>
            </Link>
          </section>

          <section className={`${styles.contentSection} ${styles.processSection}`} id="how-it-works">
            <header className={styles.sectionHeading}>
              <h2 className={styles.sectionTitle}>Три шага к своему направлению</h2>
            </header>
            <div className={styles.stepsGrid}>
              <article className={styles.stepCard}>
                <span className={styles.stepMark} aria-hidden="true">01</span>
                <div className={styles.stepCopy}><h3 className={styles.stepTitle}>Пройдите проф-тест</h3><p className={styles.stepDescription}>Ответьте на вопросы и получите персональную подборку.</p></div>
              </article>
              <article className={styles.stepCard}>
                <span className={styles.stepMark} aria-hidden="true">02</span>
                <div className={styles.stepCopy}><h3 className={styles.stepTitle}>Просмотрите рекомендации</h3><p className={styles.stepDescription}>Изучите программы, подобранные по вашим ответам.</p></div>
              </article>
              <article className={styles.stepCard}>
                <span className={styles.stepMark} aria-hidden="true">03</span>
                <div className={styles.stepCopy}><h3 className={styles.stepTitle}>Сравните рекомендации</h3><p className={styles.stepDescription}>Сопоставьте учебные планы, предметы и условия поступления.</p></div>
              </article>
            </div>
          </section>

          <section className={`${styles.contentSection} ${styles.trustSection}`} id="trust-data">
            <header className={styles.sectionHeading}>
              <h2 className={styles.sectionTitle}>Источники данных</h2>
              <p className={styles.sectionDescription}>Мы используем официальный сайт МГТУ имени Н. Э. Баумана и открытые источники, публикующие актуальные сведения о программах и поступлении.</p>
            </header>
          </section>

          <section className={`${styles.contentSection} ${styles.finalSection}`} id="final-cta">
            <div className={styles.finalCta}>
              <div className={styles.ctaCopy}>
                <span className={`${styles.sectionKicker} ${styles.ctaKicker}`}>Твой следующий шаг</span>
                <h2 className={styles.ctaTitle}>Найди направление, которое подходит именно тебе</h2>
                <p className={styles.ctaDescription}>Начни с интересов, сравни программы и собери собственное представление о будущем.</p>
              </div>
              <a className={styles.ctaLink} href="#home-actions">Посмотреть возможности</a>
            </div>
          </section>
        </main>
      </div>

      <HomeMenu open={menuOpen} onClose={closeMenu} onOpen={openMenu} />
    </div>
  );
}
