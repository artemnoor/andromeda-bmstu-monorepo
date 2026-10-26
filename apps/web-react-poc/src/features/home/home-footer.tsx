import { Link } from "react-router";
import styles from "./home-footer.module.css";

export function HomeFooter() {
  return <footer className={styles.footer} aria-label="Подвал сайта">
    <div className={styles.top}>
      <div className={styles.intro}>
        <Link viewTransition to="/" className={styles.brand} aria-label="Андромеда — на главную">
          <img src="/assets/andromeda-symbol.webp" alt="" width="48" height="48" loading="lazy" />
          <span>Андромеда</span>
        </Link>
        <p>От первого интереса<br /> до своего направления.</p>
        <span className={styles.description}>Навигатор образовательных программ МГТУ имени Баумана.</span>
      </div>
      <nav className={styles.nav} aria-label="Разделы сайта">
        <h2>Твой выбор</h2>
        <Link viewTransition to="/programs">Каталог программ <span aria-hidden="true">↗</span></Link>
        <Link viewTransition to="/discover">Профориентационный тест <span aria-hidden="true">↗</span></Link>
        <Link viewTransition to="/compare">Сравнение программ <span aria-hidden="true">↗</span></Link>
      </nav>
      <div className={styles.about}>
        <h2>Выбирай осознанно</h2>
        <p>Изучай дисциплины, сравнивай учебные планы и проверяй условия поступления по источникам университета.</p>
        <a className={styles.backToTop} href="#top">Вернуться наверх <span aria-hidden="true">↑</span></a>
      </div>
    </div>
    <nav className={styles.socials} aria-label="Соцсети Андромеды">
      <a className={`${styles.socialLink} ${styles.telegram}`} href="https://t.me/proximart" target="_blank" rel="noreferrer" aria-label="Андромеда в Telegram">
        <span className={styles.socialIcon} aria-hidden="true" />
      </a>
      <a className={`${styles.socialLink} ${styles.vk}`} href="https://vk.ru/club236804216" target="_blank" rel="noreferrer" aria-label="Андромеда во ВКонтакте">
        <span className={styles.socialIcon} aria-hidden="true" />
      </a>
    </nav>
    <div className={styles.bottom}>
      <span>© {new Date().getFullYear()} Андромеда</span>
      <span>Твоё будущее начинается с выбора.</span>
      <span className={styles.palette} aria-hidden="true"><i /><i /><i /><i /></span>
    </div>
  </footer>;
}
