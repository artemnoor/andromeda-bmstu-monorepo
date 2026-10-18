import { Link } from "react-router";
import { AndromedaHeader } from "@/widgets/andromeda-navigation/andromeda-header";
import styles from "../root.module.css";

export function meta() {
  return [{ title: "Страница не найдена — Андромеда" }];
}

export default function NotFoundRoute() {
  return <><AndromedaHeader /><main className={styles.error}>
    <p>404</p>
    <h1>Страница не найдена</h1>
    <p>Возможно, адрес изменился. Продолжи подбор с каталога или главной страницы.</p>
    <nav aria-label="Куда перейти"><Link to="/programs">Каталог программ</Link><Link to="/">Главная</Link></nav>
  </main></>;
}
