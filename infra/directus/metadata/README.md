# Directus viewer metadata

These files reproduce the Directus 12.4.1 internal viewer configuration:

- `collections.json` describes 25 everyday read collections, six visible
  navigation folders, labels, display templates, field presentation and 14
  global tabular defaults. Thirty-two technical read-model tables and the
  hidden `90_technical` folder are left unregistered in Core mode.
- `relations.json` declares 97 virtual relationships on existing columns in
  `directus_read`. Each relationship has `schema: null`; no academic foreign
  key is created.
- `apply_metadata.py` preflights the manifests, updates collection/field/preset
  metadata through the Directus API, and upserts relation/reverse-alias rows
  directly in `directus_meta`.

Directus 12.4.1's `POST /relations` attempts a physical foreign-key DDL change
even when `schema: null` is provided. Direct metadata writes are limited to
Directus-owned tables in `directus_meta`; no academic item or schema is
modified. They use a separate operator URL, restricted in code to local
PostgreSQL 16 `academic_data_test` or `*_dev` databases. The applier refuses
remote hosts, production database names, and the Directus runtime role before
changing any metadata.

## Apply the Core viewer

Start the isolated PostgreSQL 16 database, apply the normal migrations, import
the reviewed fixture bundle, provision the runtime DB password, and start
Directus as described in [`docs/DIRECTUS.md`](../../../docs/DIRECTUS.md). Set
the local Directus admin credentials and the operator connection to the same
database Directus uses:

```powershell
$env:DIRECTUS_ADMIN_EMAIL = "team@example.invalid"
$env:DIRECTUS_ADMIN_PASSWORD = "<local-admin-password>"
$env:DIRECTUS_URL = "http://127.0.0.1:8055"
$env:ACADEMIC_DATA_DATABASE_URL = "postgresql+psycopg://andromeda_test:<local-password>@localhost:55433/academic_data_test"

uv run python infra/directus/metadata/apply_metadata.py --dry-run
uv run python infra/directus/metadata/apply_metadata.py --mode core
docker compose -p andromeda -f infra/compose.yaml --profile directus restart directus
```

The Directus admin URL/password and PostgreSQL operator URL/password must not
be committed. The dry-run authenticates and checks the API manifests but does
not open the operator connection. Applying requires local PostgreSQL 16 and a
matching initialized `directus_meta` schema with metadata DML privileges.
Restart Directus after relation or alias rows are created/updated so its
in-memory schema cache reloads. Reapplying an unchanged manifest is idempotent
and does not require a restart.

## Licensed full catalog

Core mode registers only the 25 everyday collections. The six visible folders
do not count toward Directus Core's 25 active collection entitlement because
their schema is null. Technical tables remain available through relations for
the read paths that need them, but are not registered as everyday menu
collections. To register all 57 collections under a valid Directus license,
set `DIRECTUS_LICENSE_KEY` and run:

```powershell
$env:DIRECTUS_METADATA_MODE = "licensed"
uv run python infra/directus/metadata/apply_metadata.py --mode licensed
```

The authenticated Core-mode smoke verified that `90_technical` is not
registered. Licensed full-catalog mode has not been smoke-tested.

Directus translations are stored as `ru-RU`; set the project or each user's
language to Russian in Directus settings. The applier intentionally leaves
project settings and user profiles untouched.

`readonly` field presentation and hidden collection metadata are UX settings,
not authorization. PostgreSQL grants keep academic canonical and projection
tables read-only, including for a Directus administrator. See the [viewer
setup and permissions](../../../docs/DIRECTUS.md) and [navigation/relationship
coverage](../../../docs/DIRECTUS_UX.md).
