# Andromeda web

This app preserves the original vanilla, multi-page Andromeda interface. It has no framework or runtime package dependencies. The pages are `index.html`, `first-screen.html`, `programs.html`, `compare.html`, `favorites.html`, `profile.html`, `admission.html`, `discover.html`, and `workspace.html`.

## Run locally

Use Node.js 22 or later. Install the empty, locked app dependency set and start the static server:

```powershell
npm ci --prefix apps/web
npm run dev --prefix apps/web -- --port 4173
```

The dev server serves the original static files and forwards same-origin `/api/*`, `/docs`, `/openapi.json`, and `/redoc` requests to FastAPI. The default API origin is `http://127.0.0.1:8000`; set `API_ORIGIN` if FastAPI runs elsewhere. The browser client itself defaults to same-origin `/api/v1` and does not connect to PostgreSQL.

## Build and checks

```powershell
npm run build --prefix apps/web
npm test --prefix apps/web
npm run preview --prefix apps/web -- --port 4174
```

The build validates page references, JavaScript syntax, data JSON, and the absence of the archived API gateway, then copies the static app into ignored `apps/web/dist/`.

## Academic data modes

Normal navigation uses the current read-only FastAPI `/api/v1` contracts. API errors remain visible as unavailable data; the app never silently substitutes a local JSON snapshot.

The JSON files in `data/` are preserved demo fixtures from the original frontend. To opt into them explicitly, open a page with `?data=demo`. Demo mode persists for the browser session, displays a `ДЕМО-ДАННЫЕ` banner, and offers a link back to API mode. The fixtures are not refreshed from the API and are not presented as current academic data.

No archived gateway configuration, data-refresh scripts, or SQL exports are part of the runnable app.
