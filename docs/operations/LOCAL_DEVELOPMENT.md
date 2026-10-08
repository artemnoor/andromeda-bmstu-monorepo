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

Install the locked workspace, start its database, and run the full local suite:

```powershell
python -m pip install uv==0.11.28
make setup
make up
make migrate
make test
```

`make migrate` and `make test` load `.env`. The default local database password
matches the `.env.example` placeholder and should remain local. The test target
uses the isolated `academic_data_test` PostgreSQL database; its destructive
integration fixture refuses any other database identity.

```powershell
uv run --env-file .env academic-data db check
```

The `test` environment accepts only the isolated local test database. Keep the
operator URL separate from restricted API and Directus runtime credentials.
The corresponding explicit install and full-suite commands are:

```powershell
uv sync --locked --all-packages --group dev --no-editable
uv run --env-file .env pytest -q
```

PostgreSQL integration tests require the database to be running and upgraded.
The authenticated Directus HTTP smoke skips until local Directus credentials
replace the sample placeholders and the service is running.

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
to reload relationships. PostgreSQL permission checks passed in the migration
CI run. The optional authenticated HTTP smoke still requires a local Directus
service and credentials; see the [migration report](../architecture/MIGRATION_REPORT.md).

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
