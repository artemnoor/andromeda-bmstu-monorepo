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
profiles and application behavior are not stored in this schema. The active
parser command only reads local captures; it never fetches university sites.
See [the architecture](docs/ARCHITECTURE.md) and [the migration report](docs/MIGRATION_REPORT.md)
for scope and source decisions.

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

## Run a BMSTU parser on a local file

```powershell
uv run --no-editable --package andromeda-bmstu-parsers andromeda-bmstu list
uv run --no-editable --package andromeda-bmstu-parsers andromeda-bmstu parse admission-information `
  --input tests/fixtures/bmstu/admission-information.html `
  --source-url https://course.bmstu.ru/edu/abiturient/ `
  --output artifacts/admission-information.json
```

Supported parsers are catalog HTML, catalog API JSON, program cards, admission
information, and tuition pages. Inputs must be local files and provenance URLs
must use HTTPS on `bmstu.ru` or one of its subdomains. The parser CLI emits
JSON; it does not turn ad hoc parser output into a database release. The
checked-in bundle remains the only import input until a reviewed bundle builder
is added.

## Verify

With the local PostgreSQL service running and the environment variables above
set:

```powershell
uv run --no-editable --package andromeda-academic-data-db python -c "from alembic import command; from academic_data_service.cli import build_alembic_config; command.check(build_alembic_config())"
uv run --no-editable pytest -q
```

See [known issues](docs/KNOWN_ISSUES.md) for unverified parser paths and next
work before building the site.
