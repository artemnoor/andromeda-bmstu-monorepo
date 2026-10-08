# Local development environment

The repository supports an isolated local PostgreSQL 16 database and an
optional Directus 12.4.1 viewer through the root `docker-compose.yml`. This is
a developer runtime; it is not a shared staging or production environment.

## Start the database

1. Copy `.env.example` to `.env` and replace the local placeholders. `.env` is
   ignored by Git. Keep passwords and tokens there or in the shell environment.
2. Set `ACADEMIC_DATA_ENV=test` with a URL naming `academic_data_test`, or set
   `ACADEMIC_DATA_ENV=development` with a local database name ending in `_dev`.
3. Run `docker compose up -d --wait academic-data-db`, then
   `make migrate`.

The database is published only on `127.0.0.1:${ANDROMEDA_DB_PORT:-55433}` and
persists in the named `academic-data-postgres` volume. `make down` stops the
services and preserves that volume.

## Local variables

| Variable | Use |
|---|---|
| `ACADEMIC_DATA_ENV` | `test` or `development`; development URLs must name a local database ending in `_dev`. |
| `ACADEMIC_DATA_DATABASE_URL` | Local application/operator URL. Keep it on localhost and URL-encode reserved characters in credentials. |
| `ANDROMEDA_DB_PORT` | Host port for PostgreSQL; Compose binds it to loopback. |
| `DIRECTUS_SECRET` | Long random local secret, required only for the Directus profile. |
| `ANDROMEDA_DIRECTUS_DB_PASSWORD` | Password provisioned for `andromeda_directus_runtime` in the local database. |
| `DIRECTUS_ADMIN_EMAIL` | Local Directus admin account. |
| `DIRECTUS_ADMIN_PASSWORD` | Local Directus admin password. |
| `DIRECTUS_PORT` | Loopback host port for Directus; defaults to `8055`. |
| `DIRECTUS_TEST_URL` | Local Directus URL used by the optional HTTP smoke test, for example `http://127.0.0.1:8055`. |

The database-only Compose service needs no Directus credentials. The Directus
profile checks for missing credentials and exits with a configuration message.
The default profile exposes only PostgreSQL; the optional Directus service is
also bound to loopback. Directus can read approved `directus_read` projections
and write only its own `directus_meta` schema.

`make directus` starts the optional service and applies the Core metadata from
`platform/directus/metadata`. It requires the local Directus admin values and
an operator `ACADEMIC_DATA_DATABASE_URL` in the shell. The HTTP smoke test is
skipped unless `DIRECTUS_TEST_URL`, `DIRECTUS_ADMIN_EMAIL`, and
`DIRECTUS_ADMIN_PASSWORD` are set.

Use `infra/database/backup.ps1 -Target test -OutputPath <new-file>` and
`infra/database/restore-check.ps1 -Target test -BackupPath <backup-file>` for
local database backups. These scripts accept only explicit local `test` or
`dev` targets and require PostgreSQL 16 client tools.
