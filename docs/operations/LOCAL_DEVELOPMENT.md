[← Documentation index](../README.md) · [Back to repository README](../../README.md) · [Ingestion operations →](INGESTION_OPERATIONS.md)

# Local development and database setup

This guide runs the repository against an isolated PostgreSQL 16 database.
The commands use local-only credentials. Do not reuse them for a shared or
production database.

## Requirements

- Python 3.11 or newer
- `uv` 0.11.28
- Docker Compose v2
- GNU Make for the convenience targets
- Poppler (`pdftotext`) when parsing curriculum PDF documents

## Local PostgreSQL 16

If `.env` does not exist, create it from the checked-in local template. Do not
overwrite an existing `.env`:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Replace local placeholders in `.env` before starting services. The template
binds PostgreSQL to `127.0.0.1:55433`; if `ANDROMEDA_DB_PORT` changes, use that
same port in `ACADEMIC_DATA_DATABASE_URL` below.

Install the locked workspace and start its database:

```powershell
python -m pip install uv==0.11.28
uv sync --locked --all-packages --group dev --no-editable
docker compose up -d --wait academic-data-db
```

Set the database environment in the current PowerShell session. The password
below matches the local `.env.example` placeholder and should remain local:

```powershell
$env:ACADEMIC_DATA_ENV = "test"
$env:ACADEMIC_DATA_DATABASE_URL = "postgresql+psycopg://andromeda_test:local-only-change-me@127.0.0.1:55433/academic_data_test"
uv run academic-data db upgrade
uv run academic-data db check
```

The `test` environment accepts only the isolated local test database. Keep the
operator URL separate from the restricted API and Directus runtime credentials.

The convenience targets are `make setup`, `make migrate`, and `make test`.
Their corresponding install, migration, and full-suite commands are:

```powershell
uv sync --locked --all-packages --group dev --no-editable
uv run academic-data db upgrade
uv run pytest -q
```

The migration command requires `ACADEMIC_DATA_ENV=test` and
`ACADEMIC_DATA_DATABASE_URL` in the current environment. The tests that use
PostgreSQL require the database to be running and upgraded.

## Validate a bundle

Validation and dry-run import do not change the database:

```powershell
uv run academic-data bundle validate --input data/bmstu-2026
uv run academic-data bundle import --input data/bmstu-2026 --dry-run
```

Only bootstrap a brand-new, empty test database with no active release. Check
the active release before any commit. For normal updates, stage from the active
release, review and validate the candidate, then follow the
[ingestion operator guide](INGESTION_OPERATIONS.md).

## Run the read-only API

The runtime role must be provisioned separately in a trusted PostgreSQL
session. Start the API with its restricted database login after the local
release is ready:

```powershell
$env:ACADEMIC_DATA_ENV = "test"
$env:ACADEMIC_DATA_DATABASE_URL = "postgresql+psycopg://andromeda_api_runtime:<local-password>@127.0.0.1:55433/academic_data_test"
uv run --package andromeda-api uvicorn andromeda_api.main:app --host 127.0.0.1 --port 8000
```

The public `/api/v1` surface is GET-only. See the [API contract](../api/API.md).

## Run ingestion commands

Fixture capture and parsing are local and reproducible. Keep raw capture output
under ignored `artifacts/` storage and do not commit credentials or raw source
files:

```powershell
uv run --package andromeda-ingestion andromeda-bmstu list
uv run --package andromeda-ingestion andromeda-bmstu ingest capture `
  --mode fixture --fixture-dir tests/fixtures/bmstu/ingestion `
  --output artifacts/bmstu-ingestion/capture
uv run --package andromeda-ingestion andromeda-bmstu ingest parse `
  --input artifacts/bmstu-ingestion/capture `
  --output artifacts/bmstu-ingestion/parsed.json
```

Live capture is opt-in and bounded by source-specific safeguards. Use the
[operator guide](INGESTION_OPERATIONS.md) for staging, review, and publication.

## Start the optional Directus viewer

Directus requires an active test release, a provisioned
`andromeda_directus_runtime` password, and local values for `DIRECTUS_SECRET`,
`ANDROMEDA_DIRECTUS_DB_PASSWORD`, `DIRECTUS_ADMIN_EMAIL`, and
`DIRECTUS_ADMIN_PASSWORD`. Follow the [viewer setup and permissions guide](directus/DIRECTUS.md).
The metadata applier's operator URL must point to the isolated local test
database.

The canonical metadata files are under `platform/directus/metadata`. Run the
applier's dry-run before applying its Core-mode metadata, then restart Directus
to reload relationships. PostgreSQL-backed runtime and permission checks for
the moved tree remain pending; see the [migration report](../architecture/MIGRATION_REPORT.md).

## Shut down

Stop the local services with:

```powershell
docker compose down
```

This keeps the named local database volume. Use `docker compose down --volumes`
only when intentionally deleting that local test database.

## See also

- [Ingestion operations](INGESTION_OPERATIONS.md) — review and release workflow
- [Directus setup](directus/DIRECTUS.md) — viewer permissions and metadata
- [Migration report](../architecture/MIGRATION_REPORT.md) — verified and pending checks
