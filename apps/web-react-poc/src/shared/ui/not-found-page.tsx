import { Link } from "react-router";
import { useEffect } from "react";
import { ArrowLeft, ArrowUpRight, Compass, Layers3 } from "lucide-react";
import { AndromedaHeader } from "@/widgets/andromeda-navigation/andromeda-header";
import styles from "./not-found-page.module.css";
import { trackEvent } from "@/shared/analytics/analytics";

export function NotFoundPage({ title = "Страница не найдена", description = "Возможно, ссылка устарела или в адресе есть опечатка. Продолжим искать твоё направление?" }: { title?: string; description?: string }) {
  useEffect(() => { trackEvent("page_not_found"); }, []);
  return <div className={styles.page}>
    <AndromedaHeader />
    <main className={styles.main} id="main-content" tabIndex={-1}>
      <div className={styles.hero}>
        <div className={styles.copy}>
          <h1>{title}</h1>
          <p className={styles.description}>{description}</p>
          <div className={styles.actions}>
            <Link to="/" viewTransition className={styles.primary}><ArrowLeft size={17} aria-hidden="true" />На главную</Link>
            <Link to="/programs" viewTransition className={styles.secondary}>Открыть каталог<ArrowUpRight size={18} aria-hidden="true" /></Link>
          </div>
        </div>
        <div className={styles.illustration} aria-hidden="true">
          <div className={styles.glow} />
          <svg viewBox="0 0 640 420" fill="none">
            <circle cx="320" cy="210" r="157" stroke="currentColor" strokeOpacity=".06" />
            <circle cx="320" cy="210" r="119" stroke="currentColor" strokeOpacity=".08" strokeDasharray="2 8" />
            <text x="128" y="310" textAnchor="middle" fill="currentColor" fontSize="282" fontWeight="500" letterSpacing="-18">4</text>
            <text x="512" y="310" textAnchor="middle" fill="currentColor" fontSize="282" fontWeight="500" letterSpacing="-18">4</text>
            <circle cx="320" cy="210" r="79" stroke="#d9b8fe" strokeWidth="17" />
            <ellipse className={styles.orbit} cx="320" cy="210" rx="158" ry="50" transform="rotate(-30 320 210)" stroke="#d9b8fe" strokeOpacity=".85" strokeWidth="3.5" strokeDasharray="10 12" strokeLinecap="round" />
            <circle cx="450" cy="136" r="17" stroke="#d9b8fe" strokeOpacity=".18" />
            <path d="M505 61v18m-9-9h18M141 99v10m-5-5h10M566 331v12m-6-6h12" stroke="currentColor" strokeOpacity=".6" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="75" cy="249" r="2" fill="currentColor" fillOpacity=".4" />
            <circle cx="398" cy="49" r="2" fill="currentColor" fillOpacity=".35" />
          </svg>
          <span className={styles.orbitCaption}>Немного за пределами маршрута</span>
        </div>
      </div>
      <section className={styles.explore} aria-labelledby="not-found-explore">
        <div className={styles.exploreHeading}><h2 id="not-found-explore">Найдём другой маршрут</h2><p>Твой выбор всё ещё впереди.</p></div>
        <nav className={styles.routes} aria-label="Продолжить выбор направления">
          <Link to="/discover" viewTransition className={styles.route}><span className={styles.routeIcon}><Compass size={23} aria-hidden="true" /></span><span><strong>Пройти профтест</strong><small>Начни со своих интересов</small></span><ArrowUpRight className={styles.routeArrow} size={20} aria-hidden="true" /></Link>
          <Link to="/compare" viewTransition className={styles.route}><span className={styles.routeIcon}><Layers3 size={23} aria-hidden="true" /></span><span><strong>Сравнить программы</strong><small>Посмотри на различия в деталях</small></span><ArrowUpRight className={styles.routeArrow} size={20} aria-hidden="true" /></Link>
        </nav>
      </section>
      <footer className={styles.footer}><span>Андромеда · Навигатор образовательных программ</span><Link to="/feedback" viewTransition>Сообщить о неработающей ссылке <ArrowUpRight size={14} aria-hidden="true" /></Link></footer>
    </main>
  </div>;
}
