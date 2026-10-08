> Historical package architecture from before the v1.1 ownership migration. Current code ownership is documented in [architecture](../architecture/ARCHITECTURE.md); the package was moved to `packages/db` and API composition is under `services/api`.

---

# Academic data package architecture

This directory is the standalone academic-data package inside the Andromeda
monorepo. Its active components are SQLAlchemy models, Alembic migrations,
offline bundle validation and mapping, and transactional persistence. There is
no FastAPI application in this package.

The importer creates a deterministic release key from the normalized bundle
digest and mapper version. Academic rows are release-scoped. Evidence tables
retain source provenance and explicit relationships. The active pointer is
updated only after row-count reconciliation, source-observation reconciliation,
and requirement-tree checks pass.

`settings.py` rejects core/archive database names and enforces PostgreSQL 16.
The local test configuration accepts only localhost `academic_data_test` in
`test` mode. The root Compose file provides this disposable database.

For data ownership across packages, see the monorepo
[architecture](../architecture/ARCHITECTURE.md). For migration decisions, see the
[migration report](../architecture/MIGRATION_REPORT.md).
