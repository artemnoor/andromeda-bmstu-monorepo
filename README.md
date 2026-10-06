# Andromeda

Minimal monorepo for the BMSTU 2026 academic-data snapshot, its PostgreSQL
schema/importer, and a small offline parser package. The first release has no
website, API, Directus instance, or production database connection.

## Layout

```text
academic-data/             PostgreSQL models, Alembic history, bundle importer
data/bmstu-2026/            reviewed, normalized BMSTU bundle
parsers/src/                installable local-file BMSTU parser subset
parsers/deferred/hse/       HSE adapter sources, excluded from the build
infra/compose.yaml          disposable PostgreSQL 16 for local verification
tests/                      offline parser/importer and PostgreSQL checks
docs/                       architecture, migration report, known issues
```

The academic database owns sourced academic facts and their provenance. User
profiles and application behavior are not stored in this schema. The ingestion
CLI defaults to local fixtures; live capture is a separate explicit mode. See
[the architecture](docs/ARCHITECTURE.md), [the migration report](docs/MIGRATION_REPORT.md),
and [the ingestion audit](docs/INGESTION_AUDIT.md) for scope and source decisions.

## Set up

Requirements: Python 3.11+, `uv` 0.11.28, and Docker Compose.

```powershell
python -m pip install uv==0.11.28
$env:UV_NO_EDITABLE = "1"
uv sync --locked --all-packages --group dev --no-editable
docker compose -f infra/compose.yaml up -d --wait

$env:ACADEMIC_DATA_ENV = "test"
$env:ACADEMIC_DATA_DATABASE_URL = "postgresql+psycopg://andromeda_test:andromeda_test@localhost:55433/academic_data_test"

uv run --no-editable --package andromeda-academic-data-db academic-data db upgrade
uv run --no-editable --package andromeda-academic-data-db academic-data db check
```

The Compose database is disposable and isolated on port `55433`. If that port
is occupied, set `ANDROMEDA_DB_PORT` before `docker compose up` and use the same
port in `ACADEMIC_DATA_DATABASE_URL`. Do not point test commands at a shared or
production database.

## Validate and import the checked-in bundle

These first commands do not need PostgreSQL and make no network requests:

```powershell
uv run --no-editable --package andromeda-academic-data-db academic-data bundle validate --input data/bmstu-2026
uv run --no-editable --package andromeda-academic-data-db academic-data bundle import --input data/bmstu-2026 --dry-run
```

After starting the local database and applying migrations, the explicit commit
mode writes and activates a release in that local test database:

```powershell
uv run --no-editable --package andromeda-academic-data-db academic-data bundle import --input data/bmstu-2026 --commit
```

The importer is idempotent for an already committed bundle digest and mapper
version. It activates a new release only after its transaction and
reconciliation succeed.

## Run the fixture-first BMSTU ingestion flow

The checked-in fixture corpus contains a minimal university identity page,
redacted public BMSTU catalog/detail/API copies, and public curriculum PDFs.
Capture and parse stay local, and raw files are written under ignored
`artifacts/` storage:

```powershell
uv run --no-editable --package andromeda-bmstu-parsers andromeda-bmstu ingest capture `
  --mode fixture --fixture-dir tests/fixtures/bmstu/ingestion `
  --output artifacts/bmstu-ingestion/capture
uv run --no-editable --package andromeda-bmstu-parsers andromeda-bmstu ingest parse `
  --input artifacts/bmstu-ingestion/capture `
  --output artifacts/bmstu-ingestion/parsed.json
uv run --no-editable --package andromeda-bmstu-parsers andromeda-bmstu ingest stage `
  --base data/bmstu-2026 --parse-report artifacts/bmstu-ingestion/parsed.json `
  --output artifacts/bmstu-ingestion/candidate
```

The candidate is deliberately review-only. Copy its `external_key` from
`ingestion_candidate_manifest.json` into a CSV with the exact headers
`external_key,decision,reviewed_at`; use `accept_observation` or `reject` and
an ISO timestamp with a timezone. Then materialize and inspect the reviewed
bundle:

```powershell
uv run --no-editable --package andromeda-bmstu-parsers andromeda-bmstu ingest review `
  --input artifacts/bmstu-ingestion/candidate `
  --decisions artifacts/bmstu-ingestion/review.csv `
  --output artifacts/bmstu-ingestion/reviewed
uv run --no-editable --package andromeda-bmstu-parsers andromeda-bmstu ingest validate `
  --input artifacts/bmstu-ingestion/reviewed
uv run --no-editable --package andromeda-bmstu-parsers andromeda-bmstu ingest dry-run `
  --input artifacts/bmstu-ingestion/reviewed
```

An accepted parser snapshot is stored as a reviewed source observation. It does
not automatically overwrite typed program, curriculum, admission, or other
academic facts. New typed facts require a separate exact-key mapping and review.
`ingest commit` uses the existing guarded academic importer and should only be
run against the isolated local database described above after reviewing the
dry-run output.

Live capture is opt-in (`ingest capture --mode live`). It uses direct HTTP,
approved BMSTU/public-plan hosts, a one-second default request interval,
bounded retries/timeouts/body sizes, and no browser fallback. Tests never use
live mode. DEBUG is the default; URL queries and credential-like values are
redacted and response bodies are not logged.

## Run a BMSTU parser on a local file

```powershell
uv run --no-editable --package andromeda-bmstu-parsers andromeda-bmstu list
uv run --no-editable --package andromeda-bmstu-parsers andromeda-bmstu parse admission-information `
  --input tests/fixtures/bmstu/admission-information.html `
  --source-url https://course.bmstu.ru/edu/abiturient/ `
  --output artifacts/admission-information.json
```

Supported standalone parsers are catalog HTML, catalog API JSON, program
cards, admission information, and tuition pages. Inputs must be local files and
provenance URLs must use HTTPS on `bmstu.ru` or one of its subdomains. The
standalone parser CLI emits JSON; use the review-gated ingestion flow above for
importer-compatible bundles.

## Verify

With the local PostgreSQL service running and the environment variables above
set:

```powershell
uv run --no-editable --package andromeda-academic-data-db python -c "from alembic import command; from academic_data_service.cli import build_alembic_config; command.check(build_alembic_config())"
uv run --no-editable pytest -q
```

See [known issues](docs/KNOWN_ISSUES.md) for unverified live-source paths and
remaining typed-mapping work before building the site.
