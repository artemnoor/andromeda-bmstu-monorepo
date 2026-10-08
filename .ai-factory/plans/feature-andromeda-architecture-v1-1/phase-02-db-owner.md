# Phase 2: Database Ownership

Plan: [index.md](index.md)
Tasks: 2
Depends on: Task 1

## Objective

Move the sole ORM, repository and Alembic owner to packages/db while keeping API reads, importer behavior, Directus projections and existing DB compatibility intact.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|------|-----------------|----------------|
| academic-data/src/academic_data_service/infrastructure/database | Base, model modules, connection, revisions, read_repository | Existing ORM metadata and adapter |
| academic-data/migrations/env.py | metadata and version table | Migration discovery |
| academic-data/migrations/versions | linear 11-revision chain | Immutable migration history |
| academic-data/pyproject.toml | data-files fallback | Non-editable migration discovery |
| services/api/src/andromeda_api/dependencies/queries.py | DB session provider | API consumer |

## Files to Change

| Path | Action | Required change |
|------|--------|-----------------|
| packages/db/pyproject.toml | create | Define andromeda-db workspace distribution |
| packages/db/src/andromeda_db/** | create/move | Own models, connection, revisions and repositories |
| packages/db/migrations/** | move | Preserve revision names, IDs, parents and operations |
| pyproject.toml and uv.lock | modify | Register package and explicit dependencies |
| academic-data/** | modify/delete | Remove DB ownership after consumers move |
| tests/** | modify | Update DB imports and migration discovery checks |

## Task 2: Establish packages/db as the only persistence owner

### Intent

Make the DB package independently installable while preserving the schema from the existing Alembic chain. This is a code move only; do not create a parallel chain or data migration.

### Implementation Steps

1. Create distribution andromeda-db with import root andromeda_db. Move model modules, Base/mixins, connection and schema revision code, repositories, Alembic env/template and all version files.
2. Preserve migration filenames, revision IDs, parent links, custom academic_data_alembic_version table, metadata imports and sole head f4b19a7c2d61.
3. Move DB-only settings/identity checks into packages/db. Remove DB imports from academic_data_service.application.ports; use neutral repository result types and keep HTTP pagination errors in services/api.
4. Update consumers to import andromeda_db. DB adapters must not import routers, parser code, API settings or services.
5. Package Alembic files as wheel data and test discovery from source and non-editable install layouts.
6. Delete academic-data/migrations and old ORM modules only after all references are updated.

### Required Interfaces and Contracts

- Export andromeda_db.models.Base, andromeda_db.connection.create_service_engine, andromeda_db.revisions.current_schema_revision plus repository interfaces.
- Alembic discovers packages/db/migrations in a checkout and the installed migration resource when source is absent.
- Keep PostgreSQL table/role names unchanged. The final revision remains owner of Directus projections and grants.
- Preserve operator command names through the ingestion/operator CLI; it invokes the DB migration runner.

### Requirement Evidence

- User task attachment sections 3, 21, 22, 23 and 28.
- Architecture v1.1 sections 1.3, 4.2, 11.3 and phase 2 of section 14.

### Error Handling and Logging

- Preserve DB target identity validation and refuse unsafe hosts/database names.
- Keep structured migration start/completion/failure logs with database name, revision and outcome; never log credentials.

### Tests

- Migration discovery tests for source and installed layouts.
- PG16 clean migration, current=head, one head and Alembic command.check.
- Run release, Directus permission/metadata and API contract regression tests after imports move.

### Acceptance Criteria

- packages/db is the only owner of ORM metadata, Alembic revisions and persistence adapters.
- All 11 revision IDs and parent links are unchanged; one head remains f4b19a7c2d61.
- Clean PostgreSQL 16 upgrade and non-editable migration discovery pass.
- DB package imports no services, Directus or parser code.

### Verification

- uv sync --locked --all-packages --group dev --no-editable
- academic-data db upgrade/check through the preserved CLI
- Alembic current, heads, upgrade head and command.check on PG16
- Compare migration filenames, IDs, parent IDs and metadata to Task 1

## Phase Risks and Mitigations

- Risk: source checkout masks a broken installed wheel. Mitigation: test a non-editable install with source migration path unavailable.
- Risk: API types create a reverse DB dependency. Mitigation: move neutral ports/results below both consumers.

## Phase Completion Checklist

- One package owns DDL, ORM and persistence.
- Clean-install and DB checks pass.
- Task 2 checkbox is updated in index.md.

## Completion Evidence — 2026-10-08

- `andromeda-db` owns the ORM, repository implementation, connection identity checks and Alembic history; no source imports from `academic_data_service` remain under `packages/db/`.
- All 11 revision files are text-identical to the original chain, with one head `f4b19a7c2d61` and version table `academic_data_alembic_version`.
- Locked non-editable sync built the package and discovered migrations from `.venv/share/andromeda-db/migrations`.
- PostgreSQL 16 clean upgrade/check and Alembic current/head/schema-drift checks passed on isolated port 55435.
- Targeted verification: 19 passed, 1 existing Starlette/httpx deprecation warning.
- Follow-up carried into Tasks 3/5: move the legacy application’s repository protocol/error dependency to the final neutral port and API error boundaries.
