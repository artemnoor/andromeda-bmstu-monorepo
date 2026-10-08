# Andromeda BMSTU academic data

> A Python monorepo for source-backed BMSTU academic data, reviewed releases, and a read-only API.

Andromeda captures official academic sources, stages changes for review, and publishes immutable releases in PostgreSQL. The public API reads the active release. Directus is an optional internal viewer. The public website, applicant profiles, Dagster runtime, and Graph Explorer are not implemented.

## Quick start

Requirements: Python 3.11+, `uv` 0.11.28, Docker Compose v2, and GNU Make.
For a local checkout, create `.env` from `.env.example` only if it does not
already exist. Keep its values local.

```powershell
python -m pip install uv==0.11.28
uv sync --locked --all-packages --group dev --no-editable
docker compose up -d --wait academic-data-db
uv run academic-data db upgrade
uv run pytest -q
```

Set the local test database environment before the migration command. The
Makefile also provides the `make setup`, `make migrate`, and `make test`
convenience targets. See the [local development guide](docs/operations/LOCAL_DEVELOPMENT.md)
for environment setup and service commands.

To inspect the checked-in bundle without changing a database:

```powershell
uv run academic-data bundle validate --input data/bmstu-2026
uv run academic-data bundle import --input data/bmstu-2026 --dry-run
```

## Repository map

| Path | Owner |
|---|---|
| `domain/` | Framework-independent ontology semantics and policy ports |
| `packages/contracts/` | Versioned HTTP DTOs |
| `packages/db/` | PostgreSQL models, repositories, and Alembic history |
| `services/api/` | Read-only FastAPI v1 and the shared publication application service |
| `services/ingestion/` | BMSTU capture, parsing, candidate, review, and CLI flows |
| `platform/directus/metadata/` | Directus metadata and local viewer configuration |
| `docker-compose.yml` | Isolated PostgreSQL 16 and optional Directus |
| `data/bmstu-2026/` | Reviewed normalized bundle and provenance fixture |

The workspace packages are `andromeda-ontology`, `andromeda-contracts`,
`andromeda-db`, `andromeda-api`, and `andromeda-ingestion`. These package
boundaries establish code ownership; independent production deployment has not
been verified.

## Documentation

| Topic | Guide |
|---|---|
| Local setup | [Development and database guide](docs/operations/LOCAL_DEVELOPMENT.md) |
| Architecture | [Current architecture](docs/architecture/ARCHITECTURE.md) · [Migration evidence](docs/architecture/MIGRATION_REPORT.md) |
| API | [v1 contract](docs/api/API.md) · [Readiness and limits](docs/api/API_READINESS.md) |
| Data model | [Curriculum identity](docs/data-model/CURRICULUM_IDENTITY.md) · [Subject classification](docs/data-model/SUBJECT_CLASSIFICATION.md) |
| Ingestion | [Operator guide](docs/operations/INGESTION_OPERATIONS.md) · [Known issues](docs/operations/KNOWN_ISSUES.md) |
| Directus | [Viewer setup](docs/operations/directus/DIRECTUS.md) · [Metadata notes](docs/operations/directus/DIRECTUS_METADATA.md) |
| Decisions | [ADR index](docs/README.md) |

## Current implementation limits

- Public `/api/v1` remains GET-only. Proposal, approval, rejection, and publish HTTP routes are not implemented.
- The parser and CLI retain the review and publication flow; Dagster orchestration is deferred.
- Directus is a constrained data viewer. Its post-move database permission checks and runtime smoke remain pending.
- Production deployment, backup/restore rehearsal, SSO/RBAC, public Web, and Graph Explorer are not verified or implemented.
- The migration report distinguishes the baseline, post-move checks, and work blocked by unavailable Docker-backed PostgreSQL.

## License

See [LICENSE](LICENSE).
