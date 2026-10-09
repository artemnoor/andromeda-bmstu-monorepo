# Demo snapshots

These JSON files are the local snapshots included with the original Andromeda frontend. They are retained only as opt-in demo fixtures. They are not the active release and are not the default data source.

Open a page with `?data=demo` to use them. The app marks this mode with a visible `ДЕМО-ДАННЫЕ` banner across its pages. Normal operation requests academic data through the current same-origin FastAPI `/api/v1` routes. API failures do not trigger a snapshot fallback.

The snapshot metadata is in `snapshot.json`; the data was exported on 2026-10-04. These files are not automatically refreshed. The archived Yandex Cloud gateway and its refresh/deployment scripts were intentionally excluded from the app.
