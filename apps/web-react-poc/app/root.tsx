import type { ReactNode } from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
} from "react-router";
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
        <div className={styles.root}>{children}</div>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function meta() {
  return [{ title: "Andromeda × BMSTU — React proof of concept" }];
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `Не удалось открыть страницу (HTTP ${error.status}).`
    : "Не удалось загрузить страницу. Попробуйте обновить её.";

  return (
    <main className={styles.error} role="alert">
      <h1>Страница временно недоступна</h1>
      <p>{message}</p>
      <a href="/">Вернуться на главную</a>
    </main>
  );
}
