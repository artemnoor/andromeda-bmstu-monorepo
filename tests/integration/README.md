# Integration tests

This directory owns cross-component checks for Alembic discovery, PostgreSQL
release lifecycle, Directus database grants, and the optional Directus HTTP
smoke. PostgreSQL tests accept only the dedicated local PostgreSQL 16
`academic_data_test` database in `test` mode. The HTTP smoke requires local
Directus credentials and skips when only the `.env.example` placeholders are
configured.

Run the PostgreSQL checks with `ACADEMIC_DATA_ENV=test` and a loopback
`ACADEMIC_DATA_DATABASE_URL`; the destructive lifecycle fixture refuses any
other database identity. GitHub Actions provides an isolated PostgreSQL 16
service for the same tests.
