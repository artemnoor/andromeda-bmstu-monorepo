# Directus internal viewer

> Verification status, 2026-10-08: the moved configuration has 5 passing metadata tests and both Compose profiles validate. PostgreSQL-backed permission checks and the Directus runtime smoke have not been rerun against the moved tree because Docker Desktop could not start. The smoke checklist below is retained as a prior procedure and result record, not as current migration evidence.

Previous: [Read-only API](../../api/API.md) · Next: [Directus UX](DIRECTUS_UX.md)

## Purpose and boundary

Directus 12.4.1 is an optional internal Data Studio for browsing the active
BMSTU academic release. It is a read-only consumer. It does not ingest,
moderate, approve, publish, or roll back academic data. Use the existing CLI
workflow for those operations.

The consumer path is:

```text
immutable active release
  -> active-release SQL views in academic_read
  -> transactionally refreshed ordinary tables in directus_read
  -> Directus Data Studio
```

Directus 12.4.1 discovers ordinary PostgreSQL tables, not the SQL views. The
projection tables are rebuilt inside the active-pointer transaction, so a
publish or rollback exposes one release at a time. They are disposable read
models, not another canonical store.

## Database access

The migration provides these separate runtime roles:

| Role | Access |
|---|---|
| `andromeda_directus_runtime` | `SELECT` on the approved `directus_read` projection; `USAGE` and `CREATE` in `directus_meta` for Directus-owned metadata |
| `andromeda_directus_readonly` | Grant group for `SELECT` on `directus_read` |

The runtime login has no access to canonical `public` tables or `academic_read`
views. PostgreSQL denies `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `ALTER`, and
`DROP` on academic canonical and projection tables. The login is not their
owner and cannot create objects in those schemas. It can manage the Directus
system objects it owns under `directus_meta`.

This database boundary applies even when a user is a Directus administrator.
The metadata applier also marks academic fields read-only in the Data Studio,
but that UI setting is convenience only; PostgreSQL grants are the security
control. No Directus permission/policy export for separate viewer roles is
currently shipped. Keep Directus available only to the internal team and do
not publish the localhost-bound service.

The projection excludes applicant-level records and local raw-file paths.
`source_observations` exposes only observation key, dataset name, and the
source-artifact link; its unmodeled payload is not exposed. Source artifacts
include requested/final URLs, fetch metadata, hashes, content type, status,
and storage status.

## Local setup

Use the isolated PostgreSQL 16 database described in the [local development guide](../LOCAL_DEVELOPMENT.md#local-postgresql-16).
Run migrations and seed the first active release before starting Directus. Do
not bootstrap over an existing active release. The database runtime role has
no password until provisioned. Start a trusted `psql` session and set one
interactively; do not put the password in Git:

```powershell
docker compose -p andromeda exec academic-data-db `
  psql -U andromeda_test -d academic_data_test
```

At the `psql` prompt:

```text
\password andromeda_directus_runtime
\q
```

Set the local environment variables required by Compose. Use private values
for your machine; the values below are placeholders, not credentials:

```powershell
$env:DIRECTUS_SECRET = "<long-random-secret>"
$env:ANDROMEDA_DIRECTUS_DB_PASSWORD = "<same-password-provisioned-in-psql>"
$env:DIRECTUS_ADMIN_EMAIL = "team@example.invalid"
$env:DIRECTUS_ADMIN_PASSWORD = "<local-admin-password>"
docker compose -p andromeda --profile directus `
  up -d --wait directus
```

Open `http://127.0.0.1:8055`. Compose binds the service to loopback. The
`DB_SEARCH_PATH=array:directus_meta,directus_read` setting keeps Directus
system tables under `directus_meta` and makes the active-release projection
available for discovery. The Directus account and PostgreSQL login are
separate credentials: the Directus admin does not change the DB role.

## Apply the checked-in viewer metadata

The reproducible presentation config is in
[`platform/directus/metadata`](../../../platform/directus/metadata/README.md):

- `collections.json` defines navigation folders, collection labels,
  display templates, field visibility/order, and global default tabular lists.
- `relations.json` defines Directus-only relationships over existing UUID
  columns. These relationships have `schema: null`; they do not add database
  foreign keys or alter canonical tables.
- `apply_metadata.py` authenticates and preflights through the Directus API,
  then applies collection/field/preset metadata through that API. Directus
  12.4.1's `POST /relations` attempts to add a PostgreSQL foreign key even when
  `schema: null` is supplied, so the applier instead upserts the 97 virtual
  relation rows and 97 reverse O2M alias-field rows directly in
  `directus_meta`. This writes only Directus-owned metadata; it performs no
  DDL and does not write academic item data or schemas.

The default `core` mode registers exactly 25 visible read collections and the
six visible navigation folders; the hidden technical folder is omitted. The
32 technical read-model tables remain in PostgreSQL but are not registered as
Directus collections in this mode. A licensed Directus instance can use
`--mode licensed` (or `DIRECTUS_METADATA_MODE=licensed`) with
`DIRECTUS_LICENSE_KEY` set; that mode registers the full grouped catalog,
including technical collections under the hidden technical group. The
licensed mode has not been covered by the local runtime smoke.

The metadata apply needs both Directus admin credentials and an operator
database connection in `ACADEMIC_DATA_DATABASE_URL`. For this local workflow,
use the isolated PostgreSQL 16 `academic_data_test` operator URL already set
in [local setup](../LOCAL_DEVELOPMENT.md#local-postgresql-16). Do not point this writer at a
production or shared database. A dry-run performs authentication and API
preflight only; it does not open the operator database connection.

After Directus is healthy, provide the same admin email/password used by the
local instance and run the preflight before applying:

```powershell
$env:DIRECTUS_ADMIN_EMAIL = "team@example.invalid"
$env:DIRECTUS_ADMIN_PASSWORD = "<local-admin-password>"
$env:ACADEMIC_DATA_DATABASE_URL = "postgresql+psycopg://andromeda_test:andromeda_test@localhost:55433/academic_data_test"
uv run python platform/directus/metadata/apply_metadata.py --dry-run
uv run python platform/directus/metadata/apply_metadata.py
docker compose -p andromeda --profile directus restart directus
```

The applier is idempotent for the metadata it manages. Re-run it after a
manifest change, then restart Directus so it reloads virtual relationships.
It updates only the listed collection/field metadata, relations, and global
presets; in Core mode it removes registrations for technical collections but
leaves their `directus_read` tables intact. It does not remove unrelated
metadata. It intentionally leaves project language, admin users, and other
Directus settings untouched. Set the project default language or each user's
language to Russian to render `ru-RU` translations; this is a manual setting.

For a fresh local database, run the normal migration and first-release
bootstrap, provision the Directus DB password, start Directus, then apply the
metadata as above. For recovery of an existing installation, restore the
database backup including `directus_meta`; the repository manifests can
re-apply the listed UI metadata but are not a full backup of Directus users,
project settings, or other manually created metadata.

## Smoke checklist

An earlier version of this guide recorded an authenticated REST API smoke
against isolated PostgreSQL 16 and Directus 12.4.1 after applying and
restarting the Core-mode metadata. That record is retained as historical
context; it has not been rerun against the moved tree. It described checks for
25 read collections in six visible folders, an unregistered hidden technical
folder, and virtual relation rows without a physical `schema`, including:

- Program → Department through `department_links.department_id.official_code`;
  a bounded scan of up to 25 programs returned at least one official code.
- Program → Study Plan → Curriculum Items, plus a semester-filtered curriculum
  request.
- Curriculum Item `evidence_links` → Evidence → Source Artifact SHA-256.
- Campaign → Offerings and Requirement Sets → Nodes → Exams.
- Statistics, Source Evidence → Source Artifact, and the Active Release row.
- A second release activation changes the Directus Active Release response
  and leaves projected rows on only the new active release.
- `GET /items/admission_result_sources` returns HTTP 403.

The previous record was an authenticated API smoke, not a manual browser/Data
Studio review. It does not verify the licensed full-catalog mode, completeness
of department links across every program, or every evidence bridge outside the
tested curriculum-item path. The separate PostgreSQL integration test uses the
actual Directus runtime role to verify academic DML/DDL denials; that check is
pending against the moved tree.
See [`tests/test_directus_runtime.py`](../../../tests/test_directus_runtime.py) and
[`tests/test_directus_permissions.py`](../../../tests/test_directus_permissions.py)
for the automated checks; rerun them on the isolated PostgreSQL 16 test DB.

## See also

- [Directus navigation and relations](DIRECTUS_UX.md)
- [Architecture and database boundaries](../../architecture/CURRENT_STATE.md)
- [Known data and product limitations](../KNOWN_ISSUES.md)
