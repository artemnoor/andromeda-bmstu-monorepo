# Academic data package

This package owns the active PostgreSQL schema, its Alembic migrations, the
release-scoped academic models, source evidence, and the normalized-bundle
importer. It does not provide an HTTP API, fetch university sites, or own user
profiles.

Run project commands from the monorepo root; setup and the disposable
PostgreSQL 16 test database are documented in the root [README](../README.md).

```powershell
uv run --no-editable --package andromeda-academic-data-db academic-data db upgrade
uv run --no-editable --package andromeda-academic-data-db academic-data bundle validate --input data/bmstu-2026
uv run --no-editable --package andromeda-academic-data-db academic-data bundle import --input data/bmstu-2026 --dry-run
```

Only use `bundle import --commit` with the dedicated local test database during
development. The CLI validates the target before writing and only activates a
release after persistence and reconciliation succeed. Reimporting the same
bundle digest and mapper version is a no-op.

The eight migration revisions in `migrations/versions/` are this package's
complete migration history. Do not combine them with the migration chains from
the two source repositories.
