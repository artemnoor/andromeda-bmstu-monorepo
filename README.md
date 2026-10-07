# Andromeda BMSTU academic data

This repository contains the BMSTU academic-data bundle, its PostgreSQL 16
schema/importer, and the fixture-first parser pipeline. Published releases are
immutable; updates are reviewed before the active pointer changes. There is no
FastAPI runtime, website, Directus instance, or applicant profile yet.

## Repository map

```text
academic-data/       SQLAlchemy models, Alembic history, importer, read queries
data/bmstu-2026/     reviewed normalized bundle and provenance
parsers/             BMSTU capture, parsing, candidate, and review CLI
infra/               disposable PostgreSQL 16 Compose service
tests/               offline fixtures and PostgreSQL lifecycle checks
docs/                architecture, operations, live check, readiness, limits
```

Start with [architecture](docs/ARCHITECTURE.md), then follow the
[operator workflow](docs/INGESTION_OPERATIONS.md). The [live validation
report](docs/LIVE_VALIDATION.md) records the bounded 2026-10-07 probe and its
source gaps. See [API readiness](docs/API_READINESS.md) and
[known limitations](docs/KNOWN_ISSUES.md) before building on these contracts.

## Local setup

Requirements: Python 3.11+, `uv` 0.11.28, Docker Compose, and Poppler
(`pdftotext`) for curriculum PDFs.

```powershell
python -m pip install uv==0.11.28
$env:UV_NO_EDITABLE = "1"
uv sync --locked --all-packages --group dev --no-editable
docker compose -f infra/compose.yaml up -d --wait

$env:ACADEMIC_DATA_ENV = "test"
$env:ACADEMIC_DATA_DATABASE_URL = "postgresql+psycopg://andromeda_test:andromeda_test@localhost:55433/academic_data_test"
uv run --package andromeda-academic-data-db academic-data db upgrade
uv run --package andromeda-academic-data-db academic-data db check
```

The Compose database is disposable and isolated on port `55433`. Set
`ANDROMEDA_DB_PORT` before `docker compose up` if that port is occupied, and
use the same port in the database URL. Never point the test environment at a
shared or production database.

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
