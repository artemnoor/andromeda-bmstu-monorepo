# Andromeda React proof of concept

This is an isolated prototype for the original home, program catalog, and comparison screens. The existing vanilla app in `apps/web/` remains independent and unchanged; this app has its own lockfile, build output, and development port.

## Stack and boundaries

- React Router v7 Framework Mode with client-side rendering and route modules.
- Vite, TypeScript strict mode, CSS Modules, Vitest, and Playwright.
- The OpenAPI artifact and generated TypeScript declarations come from the FastAPI application. Screen components call a single typed API adapter; they do not form backend URLs.
- Route loaders own route data. TanStack Query is intentionally omitted because the prototype has no cross-route server cache requirement that justifies a second cache owner.
- Program selections and favorites use the browser-state adapter, including the existing and legacy storage keys. Academic records remain server-owned.
- Every composed academic read is pinned to one active `release_key`; if the active release changes while the screen is loading, the UI fails closed and asks the user to reload.
- The API currently exposes BMSTU records without a university identity/scope field. This prototype does not fabricate one; multi-university filtering needs an explicit backend contract first.

## Run locally

Use Node.js 22.12 or newer and npm 10:

```powershell
Push-Location apps/web-react-poc
npm ci
$env:API_PROXY_TARGET = "http://127.0.0.1:8000"
$env:VITE_LEGACY_WEB_BASE_URL = "http://127.0.0.1:4173"
npm run dev
Pop-Location
```

The React app is at `http://127.0.0.1:4180`. Vite proxies `/api/*` and `/openapi.json` to `API_PROXY_TARGET` (default `http://localhost:8000`). `VITE_LEGACY_WEB_BASE_URL` is used for links to screens that are not part of the prototype; point it to the separately running vanilla app. These variables do not configure a Node business API. A deployed frontend must route `/api/*` to FastAPI or set the supported API origin.

## Screens

- `/` — the original landing page, with the hero, navigation, imagery, motion, and feature links.
- `/programs` — active-release catalog loaded from FastAPI, URL-backed search and filters, program details, admissions data, favorites, and compare selection.
- `/compare` — up to three selected programs, admission data, SVG workload/category charts, and a curriculum matrix. Only uniquely latest, parsed, verified plans contribute. Missing and unverified data remain explicit; title matching only groups matrix rows for display.

Unavailable API data is shown as an error or unknown state. The app does not fall back to old JSON snapshots or merge live and demo data.

## Checks

Run from this directory:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

Playwright browser tests use the live FastAPI API. For a full local E2E run, start the repo’s disposable test stack and point `API_PROXY_TARGET` to its read-only FastAPI process; do not point this POC at production data. The CI browser job migrates and seeds PostgreSQL 16, starts FastAPI with its read-only runtime account, then runs both the existing vanilla E2E suite and this POC suite against that same isolated database.

`npm run api:generate` exports `create_app().openapi()` from the local Python workspace and updates `openapi.json` and `src/shared/api/schema.d.ts`. `npm run api:check` verifies both artifacts are current. Install the locked workspace first with `uv sync --locked --all-packages --group dev --no-editable`.

## Scope and migration decision

This is an architecture experiment, not a replacement for `apps/web/`. It demonstrates three routes and the current BMSTU read contracts; it does not implement the other vanilla screens, user accounts, server-side profile storage, or university selection. Keep the prototype separately deployable until its visual, data-correctness, performance, and maintenance evidence has been reviewed. Do not switch production routes as part of this experiment.
