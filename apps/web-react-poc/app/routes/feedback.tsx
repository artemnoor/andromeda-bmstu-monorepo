import { useState } from "react";
import { Link } from "react-router";
import { AndromedaHeader } from "@/widgets/andromeda-navigation/andromeda-header";
import styles from "./feedback.module.css";
import { pageMeta } from "@/shared/seo";

export function meta() {
  return pageMeta("/feedback");
}

export default function FeedbackRoute() {
  const [menuOpen, setMenuOpen] = useState(false);

  return <>
    <AndromedaHeader onOpenChange={setMenuOpen} />
    <main className={styles.page} inert={menuOpen}>
      <div className={styles.intro}>
        <p className={styles.eyebrow}>На связи с тобой</p>
        <h1>Обратная связь<span aria-hidden="true">.</span></h1>
        <p className={styles.description}>Есть идея, вопрос или заметил ошибку? Расскажи нам — вместе сделаем Андромеду удобнее.</p>
      </div>
      <nav className={styles.contacts} aria-label="Связаться с Андромедой">
        <a className={styles.contact} href="https://t.me/proximart" target="_blank" rel="noreferrer">
          <img src="/assets/andromeda-telegram.svg" width="40" height="40" alt="" />
          <div><h2>Telegram</h2><p>Открыть Андромеду в Telegram</p></div>
          <span className={styles.arrow} aria-hidden="true">↗</span>
          <span className={styles.srOnly}> — откроется в новой вкладке</span>
        </a>
        <a className={styles.contact} href="https://vk.ru/club236804216" target="_blank" rel="noreferrer">
          <img src="/assets/andromeda-vk.svg" width="40" height="40" alt="" />
          <div><h2>ВКонтакте</h2><p>Перейти в наше сообщество</p></div>
          <span className={styles.arrow} aria-hidden="true">↗</span>
          <span className={styles.srOnly}> — откроется в новой вкладке</span>
        </a>
      </nav>
      <div className={styles.note}>
        <h2>Заметил неточность в программе?</h2>
        <p>Пришли ссылку на страницу и опиши, что нужно исправить. Скриншот тоже поможет разобраться.</p>
      </div>
      <Link viewTransition className={styles.back} to="/">← На главную</Link>
    </main>
  </>;
}
