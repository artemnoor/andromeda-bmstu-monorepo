# Andromeda BMSTU academic data

> A Python monorepo for source-backed BMSTU academic data, reviewed releases, and a read-only API.

Andromeda captures official academic sources, stages changes for review, and publishes immutable releases in PostgreSQL. The public API reads the active release. Directus is an optional internal viewer. The public website, applicant profiles, Dagster runtime, and Graph Explorer are not implemented.

## Quick start

Requirements: Python 3.11+, `uv` 0.11.28, Docker Compose v2, and GNU Make.
For a local checkout, create `.env` from `.env.example` only if it does not
already exist. Keep its values local.

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
python -m pip install uv==0.11.28
make setup
make up
make migrate
make test
```

Replace local placeholders in `.env` before starting services. `make test`
loads that file so PostgreSQL integration tests use the isolated local test
database. The optional Directus HTTP smoke skips until local admin credentials
are configured and Directus is running. See the [local development guide](docs/operations/LOCAL_DEVELOPMENT.md)
for service and role details.

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
| `tests/integration/` | PostgreSQL lifecycle, migration, and Directus permission/runtime checks |
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
- Directus remains a constrained viewer. PostgreSQL permission checks passed in CI; the optional HTTP smoke requires a locally running Directus service and credentials.
- Production deployment, production backup/restore, SSO/RBAC, public Web, and Graph Explorer are not verified or implemented.
- The migration report separates checked-in fixture evidence from unverified production parity and restore work.

## License

See [LICENSE](LICENSE).
