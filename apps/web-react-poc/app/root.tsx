import { useEffect, useRef, type ReactNode } from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
  useLocation,
  useNavigation,
} from "react-router";
import { AndromedaHeader } from "@/widgets/andromeda-navigation/andromeda-header";
import styles from "./root.module.css";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <a className={styles.skipLink} href="#main-content" onClick={() => document.querySelector<HTMLElement>("main")?.focus()}>К содержимому</a>
        <div className={styles.root}>{children}</div>
        <div className={styles.noise} aria-hidden="true" />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function meta() {
  return [{ title: "Андромеда × МГТУ имени Баумана" }];
}

export default function App() {
  const { pathname } = useLocation();
  const navigation = useNavigation();
  const previousPath = useRef<string | null>(null);
  useEffect(() => {
    if (navigation.state !== "idle") return;
    const main = document.querySelector<HTMLElement>("main");
    if (!main) return;
    main.id = "main-content";
    main.tabIndex = -1;
    if (previousPath.current !== pathname) main.focus({ preventScroll: true });
    previousPath.current = pathname;
  }, [pathname, navigation.state]);
  return <>
    {navigation.state !== "idle" ? <div className={styles.navigationStatus} role="status">Открываем страницу…</div> : null}
    <Outlet />
  </>;
}

export function HydrateFallback() {
  return <><AndromedaHeader /><main className={styles.loading} id="main-content" tabIndex={-1} aria-busy="true"><p role="status">Открываем Андромеду…</p><div className={styles.skeleton} aria-hidden="true" /></main></>;
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `Не удалось открыть страницу (HTTP ${error.status}).`
    : "Не удалось загрузить страницу. Попробуйте обновить её.";

  return (
    <><AndromedaHeader /><main className={styles.error} id="main-content" tabIndex={-1} role="alert">
      <h1>Страница временно недоступна</h1>
      <p>{message}</p>
      <a href="/">Вернуться на главную</a>
    </main></>
  );
}
