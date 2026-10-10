import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import styles from "./andromeda-header.module.css";

const legacyBase = (import.meta.env.VITE_LEGACY_WEB_BASE_URL || "http://127.0.0.1:4173").replace(/\/$/, "");

const links = [
  { label: "Главная", to: "/", internal: true },
  { label: "Проф-тест", to: `${legacyBase}/discover.html`, internal: false },
  { label: "Сравнить программы", to: "/compare", internal: true },
  { label: "Каталог программ", to: "/programs", internal: true },
] as const;

function isCurrentPath(pathname: string, target: string): boolean {
  return pathname === target || (target === "/" && pathname === "/index.html");
}

export function AndromedaHeader() {
  const [isOpen, setIsOpen] = useState(false);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useLayoutEffect(() => {
    if (isOpen) firstLinkRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    const main = document.querySelector<HTMLElement>("main");
    const previousMainInert = main?.inert ?? false;
    document.body.style.overflow = "hidden";
    if (main) main.inert = true;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        requestAnimationFrame(() => openButtonRef.current?.focus());
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
    return () => {
      document.body.style.overflow = previousOverflow;
      if (main) main.inert = previousMainInert;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  function closeMenu(returnFocus = true) {
    setIsOpen(false);
    if (returnFocus) requestAnimationFrame(() => openButtonRef.current?.focus());
  }

  return (
    <div className={`${styles.headerRoot} ${isOpen ? styles.menuOpen : ""}`}>
      <header className={styles.siteHeader} aria-hidden="true" />
      <Link className={styles.logo} to="/" aria-label="Andromeda × BMSTU — главная" inert={isOpen} onClick={() => closeMenu(false)}>
        <img src="/assets/andromeda-symbol.png" alt="" />
      </Link>
      {!isOpen && (
        <button
          ref={openButtonRef}
          className={styles.menuButton}
          type="button"
          aria-label="Открыть меню"
          aria-expanded="false"
          aria-controls="andromeda-react-menu"
          onClick={() => setIsOpen(true)}
        >
          <span />
          <span />
        </button>
      )}
      <div className={styles.backdrop} aria-hidden="true" onClick={() => closeMenu()} />
      <div
        ref={menuPanelRef}
        className={styles.menuShell}
        id="andromeda-react-menu"
        aria-label="Основная навигация"
        aria-modal="true"
        role="dialog"
        aria-hidden={!isOpen}
        inert={!isOpen}
      >
        {isOpen && (
          <button
            ref={closeButtonRef}
            className={styles.menuButton}
            type="button"
            aria-label="Закрыть меню"
            aria-expanded="true"
            aria-controls="andromeda-react-menu"
            onClick={() => closeMenu()}
          >
            <span />
            <span />
          </button>
        )}
        <aside className={styles.menuPanel}>
          <div className={styles.menuContent}>
            <nav aria-label="Разделы сайта">
              <ul className={styles.menuList}>
                {links.map((item, index) => {
                  const current = item.internal && isCurrentPath(location.pathname, item.to);
                  const className = styles.menuLink;
                  return (
                    <li className={styles.menuItem} key={item.label}>
                      {item.internal ? (
                        <Link
                          ref={index === 0 ? firstLinkRef : undefined}
                          to={item.to}
                          className={className}
                          aria-current={current ? "page" : undefined}
                          onClick={() => closeMenu(false)}
                        >
                          <span className={styles.menuNumber} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                          <span className={styles.menuLabel}>{item.label}</span>
                        </Link>
                      ) : (
                        <a
                          href={item.to}
                          className={className}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => closeMenu(false)}
                        >
                          <span className={styles.menuNumber} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                          <span className={styles.menuLabel}>{item.label}</span>
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </nav>
            <div className={styles.menuFooter}>
              <span>ANDROMEDA × BMSTU</span>
              <span>Навигация по разделам проекта</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
