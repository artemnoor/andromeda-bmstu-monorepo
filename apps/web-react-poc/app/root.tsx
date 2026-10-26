import { useEffect, useRef, type ReactNode, type MouseEvent } from "react";
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
import { ComparisonLimitNotice } from "@/shared/ui/comparison-limit-notice";
import { RouteAnalytics } from "@/shared/analytics/route-analytics";
import { indexingPolicy, pageMeta } from "@/shared/seo";
import { useHydrated } from "@/shared/browser-state/hooks";
import styles from "./root.module.css";
import { NotFoundPage } from "@/shared/ui/not-found-page";
import { ScreenLoader } from "@/shared/ui/screen-loader";

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const hydrated = useHydrated();
  return (
    <html lang="ru">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#111111" />
        <meta name="application-name" content="Андромеда" />
        <meta name="robots" content={indexingPolicy(location.pathname, hydrated ? location.search : "")} />
        <link rel="icon" type="image/x-icon" href="/favicon.ico" sizes="16x16 32x32 48x48 64x64 96x96 120x120 128x128 256x256" />
        <link rel="icon" type="image/png" href="/favicon-96x96.png" sizes="96x96" />
        <link rel="icon" type="image/png" href="/favicon-120x120.png" sizes="120x120" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
        <link rel="manifest" href="/site.webmanifest" />
        <Meta />
        <Links />
      </head>
      <body>
        <a className={styles.skipLink} href="#main-content" onClick={() => document.querySelector<HTMLElement>("main")?.focus()}>К содержимому</a>
        <div className={styles.root}>{children}</div>
        <div className={styles.noise} aria-hidden="true" />
        <ComparisonLimitNotice />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function meta() {
  return pageMeta("/");
}

export default function App() {
  const { pathname } = useLocation();
  const navigation = useNavigation();
  const previousPath = useRef<string | null>(null);
  function setNavigationMotion(event: MouseEvent<HTMLDivElement>) {
    if (!(event.target instanceof Element) || !event.target.closest("a[href]")) return;
    document.documentElement.dataset.navigationMotion = event.detail === 0 ? "none" : "full";
  }
  useEffect(() => {
    if (navigation.state !== "idle") return;
    const main = document.querySelector<HTMLElement>("main");
    if (!main) return;
    main.id = "main-content";
    main.tabIndex = -1;
    if (previousPath.current !== pathname) main.focus({ preventScroll: true });
    previousPath.current = pathname;
  }, [pathname, navigation.state]);
  return <div className={styles.routeScene} data-navigating={navigation.state !== "idle"} onClickCapture={setNavigationMotion}>
    <span className={styles.srOnly} role="status" aria-live="polite">{navigation.state !== "idle" ? "Открываем страницу…" : ""}</span>
    <Outlet />
    {navigation.state !== "idle" ? <ScreenLoader overlay /> : null}
    <RouteAnalytics />
  </div>;
}

export function HydrateFallback() {
  return <><AndromedaHeader /><main className={styles.loading} id="main-content" tabIndex={-1} aria-busy="true"><ScreenLoader label="Открываем Андромеду" /></main></>;
}

export function ErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
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
