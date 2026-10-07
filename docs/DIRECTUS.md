# Directus read-only viewer POC

Previous: [Read-only API](API.md) · Next: [Known limitations](KNOWN_ISSUES.md)

## Scope

Directus is an optional internal visual viewer for the active BMSTU academic
release. It is not the ingestion UI, a moderation writer, or a second canonical
database. The `directus` service is pinned to Directus **12.4.1** and is behind
the `directus` Compose profile; its port binds to localhost by default.

The database migration defines safe active-release SQL views under
`academic_read` and a derived read model of ordinary PostgreSQL tables under
`directus_read`. Directus 12.4.1's PostgreSQL inspector lists ordinary tables
and excludes SQL views, so the tables let Directus render the data while
preserving the same projected fields. A database trigger refreshes the
projection in the active-pointer transaction; publish and rollback therefore
switch the Directus data atomically. The tables are a disposable projection,
not academic canonical storage or another source of truth.

## PostgreSQL boundary

The Alembic migration creates two non-login grants groups and two runtime
logins:

| Role | Allowed access |
|---|---|
| `andromeda_api_readonly` | SELECT on the explicit read-query table allowlist |
| `andromeda_api_runtime` | Member of the API read-only group; no DML or CREATE on `public` |
| `andromeda_directus_readonly` | SELECT on `directus_read` projection tables only |
| `andromeda_directus_runtime` | Member of the Directus read-only group; may create Directus-owned metadata in `directus_meta` |

All runtime logins are created without passwords and have
`NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`. Provision
passwords in the deployment secret store after migrations; no credentials are
checked in.

Every source view joins `active_data_release` and returns only rows from its
one active release. `directus_read` mirrors the safe view columns for
directions, departments, programs and their links, plans, curriculum items,
campaigns, calendar, offerings, competition pools, places/quotas, exams,
requirement sets/nodes, tuition, current/historical statistics, review
metadata, source relationships, source artifacts, evidence and evidence
bridges. `active_release` exposes release identity and reconciliation metadata.

Source artifact views omit local raw file paths. The source-observation view
contains only observation key, dataset name and source-artifact ID; its payload
is deliberately excluded. Applicant result-source tables are not exposed.

Directus receives no `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, or
`TRIGGER` privileges on `directus_read`, and it receives no privileges on
canonical base tables or `academic_read`. It does not own `directus_read` or
its tables, so SQL ownership prevents `ALTER`/`DROP`. Its administrator UI
cannot grant the database login new PostgreSQL rights. Its own system metadata
belongs in the separate `directus_meta` schema.

The migration refuses to downgrade while `directus_meta` contains Directus
metadata objects. This prevents a schema rollback from cascading through the
viewer configuration; preserve or explicitly remove Directus metadata before
an operator retries a downgrade.

The PostgreSQL integration test connects as the actual runtime login and
asserts that reads through `directus_read` work, the projection follows active
release rollback, and base-table reads, projection updates/drops, and canonical
updates fail.

The local Directus 12.4.1 smoke test authenticated through the admin API,
discovered 12 key academic collections (directions, departments, programs,
plans/items, campaigns, exams/requirements, tuition, statistics, and source
evidence), and returned a direction item through `/items/directions`. The
smoke ran against the isolated PostgreSQL 16 test database; the service was
stopped and the temporary database-role password was cleared afterward.

## Start locally

Run the migration against the disposable PostgreSQL 16 database first. Ensure
the active slot contains a reviewed release (for a new empty disposable
database, follow the one-time bootstrap in the [README](../README.md#local-setup)).
Then set a password for the Directus login interactively with `\password` in a
trusted `psql` session. Set local environment variables without committing
them:

```powershell
$env:DIRECTUS_SECRET = "<long-random-secret>"
$env:ANDROMEDA_DIRECTUS_DB_PASSWORD = "<the-provisioned-role-password>"
$env:DIRECTUS_ADMIN_EMAIL = "team@example.invalid"
$env:DIRECTUS_ADMIN_PASSWORD = "<local-admin-password>"
docker compose -p andromeda -f infra/compose.yaml --profile directus up -d --wait directus
```

Open `http://127.0.0.1:8055`. The database connection uses the Knex array
setting `DB_SEARCH_PATH=array:directus_meta,directus_read`, so Directus system
tables belong to the metadata schema while the viewer inspects the active
academic projection. The PostgreSQL connection uses the directus runtime
role; the Directus admin account does not change that database role.

## Current POC limits

- This POC defines the protected collections and local service, but does not
  ship a curated Directus role/policy export or custom relation metadata.
  Foreign-key UUID columns can be inspected; user-friendly cross-collection
  navigation may need explicit Directus relation metadata later.
- Directus API access is for an internal team only. Do not publish its port or
  change it to a production credential without a separate deployment/security
  review.
- Release activation is reflected by the SQL views on the next query; this
  POC does not promise a synchronized cache invalidation event.
- The projection refresh truncates and reloads all viewer tables inside the
  active-pointer transaction. This keeps release switches atomic but increases
  publish/rollback time, WAL, and lock contention as the academic corpus grows;
  the 21,911-record baseline is a POC-scale check, not a production benchmark.

See [architecture](ARCHITECTURE.md), [API contract](API.md), and the
ANDROMEDA_ARCHITECTURE_v1.1 baseline supplied for this implementation.
