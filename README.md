# Andromeda BMSTU academic data

This repository contains the BMSTU academic-data bundle, its PostgreSQL 16
schema/importer, and the fixture-first parser pipeline. Published releases are
immutable; updates are reviewed before the active pointer changes. The first
read-only FastAPI v1 and optional Directus viewer now consume only the active
academic release. A public website and applicant profile are not implemented.

## Repository map

```text
academic-data/       SQLAlchemy models, Alembic history, importer, read queries
data/bmstu-2026/     reviewed normalized bundle and provenance
parsers/             BMSTU capture, parsing, candidate, and review CLI
services/api/        read-only FastAPI v1 composition layer
infra/               disposable PostgreSQL 16 Compose service
tests/               offline fixtures and PostgreSQL lifecycle checks
docs/                architecture, API, Directus, operations, live check, limits
```

Start with [architecture](docs/ARCHITECTURE.md), then follow the
[operator workflow](docs/INGESTION_OPERATIONS.md). The [live validation
report](docs/LIVE_VALIDATION.md) records the bounded 2026-10-07 probe and its
source gaps. See [API](docs/API.md), [Directus](docs/DIRECTUS.md),
[API readiness](docs/API_READINESS.md), and
[known limitations](docs/KNOWN_ISSUES.md) before building on these contracts.

## Local setup

Requirements: Python 3.11+, `uv` 0.11.28, Docker Compose, and Poppler
(`pdftotext`) for curriculum PDFs.

```powershell
python -m pip install uv==0.11.28
$env:UV_NO_EDITABLE = "1"
uv sync --locked --all-packages --group dev --no-editable
docker compose -p andromeda -f infra/compose.yaml up -d --wait academic-data-db

$env:ACADEMIC_DATA_ENV = "test"
$env:ACADEMIC_DATA_DATABASE_URL = "postgresql+psycopg://andromeda_test:andromeda_test@localhost:55433/academic_data_test"
uv run --package andromeda-academic-data-db academic-data db upgrade
uv run --package andromeda-academic-data-db academic-data db check
```

The Compose database is disposable and isolated on port `55433`. Set
`ANDROMEDA_DB_PORT` before `docker compose up` if that port is occupied, and
use the same port in the database URL. Never point the test environment at a
shared or production database.

For a newly created empty test database only, check `academic-data release
show` and seed the first active release from the checked-in baseline:

```powershell
uv run --package andromeda-academic-data-db academic-data bundle import `
  --input data/bmstu-2026 --commit
uv run --package andromeda-academic-data-db academic-data release show
```

Do not run this bootstrap over an existing active release; normal updates must
start from the current release as described in
[ingestion operations](docs/INGESTION_OPERATIONS.md).

## Run the read-only API

Provision a password for `andromeda_api_runtime` in a trusted PostgreSQL
session, then use its restricted login for the API URL. The API reads the
currently active release and publishes OpenAPI at `/openapi.json`:

```powershell
$env:ACADEMIC_DATA_ENV = "test"
$env:ACADEMIC_DATA_DATABASE_URL = "postgresql+psycopg://andromeda_api_runtime:<url-encoded-password>@localhost:55433/academic_data_test"
uv run --package andromeda-api uvicorn andromeda_api.main:app --host 127.0.0.1 --port 8000
```

See [API.md](docs/API.md) for route contracts and filters. This local command
uses the isolated test database; do not use the test environment against a
shared database.

## Start the Directus viewer

After provisioning `andromeda_directus_runtime` and setting local Directus
secrets, start the opt-in service:

```powershell
docker compose -p andromeda -f infra/compose.yaml --profile directus up -d --wait
```

Directus binds to localhost and reads a DB-maintained projection of the active
release. It cannot write academic facts or alter releases. See
[DIRECTUS.md](docs/DIRECTUS.md) for role permissions and setup details.

## Validate the checked-in bundle

These checks are offline and do not need PostgreSQL:

```powershell
uv run --package andromeda-academic-data-db academic-data bundle validate --input data/bmstu-2026
uv run --package andromeda-academic-data-db academic-data bundle import --input data/bmstu-2026 --dry-run
```

## Reproduce fixture capture and parsing

The checked-in corpus contains seven sanitized snapshots. HTML and JSON
fixtures are checked out as LF; capture hashes describe those bytes, while
the original `source_sha256` pins remain unchanged. Capture and parse stay
local; raw files go under ignored `artifacts/` storage.

```powershell
uv run --package andromeda-bmstu-parsers andromeda-bmstu ingest capture `
  --mode fixture --fixture-dir tests/fixtures/bmstu/ingestion `
  --output artifacts/bmstu-ingestion/capture
uv run --package andromeda-bmstu-parsers andromeda-bmstu ingest parse `
  --input artifacts/bmstu-ingestion/capture `
  --output artifacts/bmstu-ingestion/parsed.json
```

For a normal update, `ingest stage` exports and uses the latest active
release. It requires the test database settings above and does not fall back
to the checked-in snapshot. Use `--bootstrap --base data/bmstu-2026` only to
create the first release when the active slot is empty. Review, validate,
dry-run, and commit commands are documented in
[INGESTION_OPERATIONS.md](docs/INGESTION_OPERATIONS.md).

## Verify

With the isolated PostgreSQL service running and the environment set above:

```powershell
uv run --package andromeda-academic-data-db python -c "from alembic import command; from academic_data_service.cli import build_alembic_config; command.check(build_alembic_config())"
uv run pytest -q
```

GitHub Actions runs the locked install, bundle validation, Alembic check, and
full test suite against PostgreSQL 16. For update safety, source coverage,
and remaining constraints, see [known issues](docs/KNOWN_ISSUES.md).
