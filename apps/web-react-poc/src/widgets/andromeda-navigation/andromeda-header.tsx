import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import styles from "./andromeda-header.module.css";

const links = [
  { label: "Главная", to: "/", internal: true },
  { label: "Проф-тест", to: "/discover", internal: true },
  { label: "Сравнить программы", to: "/compare", internal: true },
  { label: "Каталог программ", to: "/programs", internal: true },
] as const;

function isCurrentPath(pathname: string, target: string): boolean {
  return pathname === target || (target === "/" && pathname === "/index.html");
}

export function AndromedaHeader({ onOpenChange }: { onOpenChange?: (open: boolean) => void } = {}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const siteHeaderRef = useRef<HTMLElement>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef(false);
  const location = useLocation();

  useLayoutEffect(() => {
    if (isOpen) firstLinkRef.current?.focus();
    else if (returnFocusRef.current) {
      openButtonRef.current?.focus();
      returnFocusRef.current = false;
    }
  }, [isOpen]);

  useEffect(() => {
    const updateHeaderBackground = () => {
      const headerBottom = siteHeaderRef.current?.getBoundingClientRect().bottom ?? 0;
      const firstScreen = document.querySelector<HTMLElement>("[data-header-background-trigger]");
      const shouldShowBackground = firstScreen
        ? firstScreen.getBoundingClientRect().bottom <= headerBottom
        : window.scrollY >= headerBottom;
      setIsScrolled(shouldShowBackground);
    };

    updateHeaderBackground();
    window.addEventListener("scroll", updateHeaderBackground, { passive: true });
    window.addEventListener("resize", updateHeaderBackground);
    return () => {
      window.removeEventListener("scroll", updateHeaderBackground);
      window.removeEventListener("resize", updateHeaderBackground);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    const main = document.querySelector<HTMLElement>("main");
    const previousMainInert = main?.inert ?? false;
    document.body.style.overflow = "hidden";
    if (main) main.inert = true;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        returnFocusRef.current = true;
        setIsOpen(false);
        onOpenChange?.(false);
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
  }, [isOpen, onOpenChange]);

  function closeMenu(returnFocus = true) {
    returnFocusRef.current = returnFocus;
    setIsOpen(false);
    onOpenChange?.(false);
  }

  return (
    <div className={`${styles.headerRoot} ${isOpen ? styles.menuOpen : ""} ${isScrolled ? styles.headerScrolled : ""}`}>
      <header ref={siteHeaderRef} className={styles.siteHeader} aria-hidden="true" />
      <Link className={styles.brandLockup} to="/" aria-label="Andromeda × МГТУ имени Баумана — главная" inert={isOpen} onClick={() => closeMenu(false)}>
        <img className={styles.andromedaMark} src="/assets/andromeda-symbol.webp" alt="" width="384" height="256" />
        <span className={styles.brandSeparator} aria-hidden="true">×</span>
        <img className={styles.bmstuMark} src="/assets/bmstu-seal.png" alt="" width="116" height="140" />
      </Link>
        <button
          ref={openButtonRef}
          hidden={isOpen}
          style={isOpen ? { display: "none" } : undefined}
          className={styles.menuButton}
          type="button"
          aria-label="Открыть меню"
          aria-expanded="false"
          aria-controls="andromeda-react-menu"
          onClick={() => {
            setIsOpen(true);
            onOpenChange?.(true);
          }}
        >
          <span />
          <span />
        </button>
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
                          <span className={styles.menuLabel}>{item.label}</span>
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>
        </aside>
      </div>
    </div>
  );
}
