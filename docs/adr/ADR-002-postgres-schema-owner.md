# ADR-002: PostgreSQL schema ownership belongs to `packages/db`

- Status: Accepted and implemented
- Date: 2026-10-08
- Basis: Architecture v1.1, sections 1.3, 2.4, and 4

## Context

ORM models, repositories, connection settings, and Alembic history were embedded in the academic-data application package. Multiple services must use the same canonical schema without owning competing DDL or copying persistence models.

## Decision

PostgreSQL remains the canonical store for published academic records. `packages/db` is the sole source-code owner of SQLAlchemy mappings, repository adapters, connection/settings, and Alembic configuration and history. Migration history is preserved as-is during the ownership move; schema changes require a new reviewed migration.

## Consequences

- Application services use repositories through their composition boundary.
- Alembic remains the sole schema migration mechanism.
- This move does not create a second database schema, new tables, baseline migration, or production backup.

## Verification

The 11 original revision files were compared by content. IDs and parent links are unchanged, there is one head (`f4b19a7c2d61`), the version table remains `academic_data_alembic_version`, and a non-editable install discovers the packaged migrations. A disposable PostgreSQL 16 upgrade and Alembic check passed; final clean-checkout parity remains pending.
