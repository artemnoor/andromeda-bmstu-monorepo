# Phase 2: Reproducible metadata and navigation

Plan: [index.md](index.md)
Tasks: 3-4
Depends on: Phase 1 / Tasks 1-2

## Objective

Add a repository-backed, repeatable way to configure the Directus Data Studio without changing academic table contents or schema.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|---|---|---|
| `infra/compose.yaml` | `directus` service | Directus 12.4.1 is optional and isolated behind the profile. |
| `infra/directus/metadata/collections.json` | new `folders`, `collections`, defaults | Declares all labels, groups, display templates, fields, hidden technical collections and global defaults. |
| `infra/directus/metadata/relations.json` | new `relations` | Declares virtual relations over existing projection UUID columns. |
| `infra/directus/metadata/apply_metadata.py` | new CLI | Authenticates to Directus, preflights exact allowlists, applies presentation metadata through its API, and writes only virtual relation metadata into the guarded local `directus_meta` schema. |
| `academic-data/migrations/versions/f4b19a7c2d61_add_readonly_runtime_roles_and_views.py` | `DIRECTUS_READ_TABLES` | Exact allowlist source for preflight. |

## Files to Change

| Path | Action | Required change |
|---|---|---|
| `infra/directus/metadata/collections.json` | create | Collection folders, Russian translations, templates, field visibility/order, table defaults, source quality and active-release settings. |
| `infra/directus/metadata/relations.json` | create | Verified virtual relation mappings and reverse fields. |
| `infra/directus/metadata/apply_metadata.py` | create | Idempotent validated metadata applier; API for presentation metadata and guarded SQL upserts limited to Directus-owned `directus_meta` relation/field tables. |
| `tests/test_directus_metadata.py` | create | Fast manifest validation and no-schema-write contract tests. |

## Task 3: Declare collections, folders, display templates, field visibility, and tabular presets

### Intent

Make the primary navigation usable for the internal Russian-speaking team while ensuring the manifest describes only records already exposed by the safe projection.

### Implementation Steps
1. Add exactly the seven folder records to the manifest: six visible ordered groups and one hidden technical group. Core mode registers the six visible folders; the technical folder and 32 hidden collections are not registered in Core mode. Folder definitions remain metadata-only with `schema: null`.
2. Declare all 57 projection collection names exactly once. Core mode registers 25 daily-use collections; hide evidence bridges and technical links from the primary menu while leaving essential virtual relation paths intact. Licensed mode may register all 57.
3. Set Russian translations and readable display templates using actual columns: direction/program code + name, department code + name, plan profile/year/form, discipline/semester, campaign year/kind, artifact type/fetch time, and active release key.
4. Set compact collection list fields and sensible ordering for programs, plans, curriculum items, admission, statistics, sources/reviews and release. Keep semester, assessment, department/program, campaign/funding/quota/year columns visible or filterable.
5. Store global default column/sort presets in the manifest only where the 12.4.1 API supports them. Do not create empty dashboard placeholders or claim saved dynamic filters if only default layout fields are available.

### Required Interfaces and Contracts
- The manifest must carry `directus_version: "12.4.1"` and `metadata_only: true`.
- Every `list_fields` value must be a direct column in its mapped projection collection.
- Do not include `admission_result_sources`, applicant data, raw artifact paths, or source-observation payload fields.
- `active_release` exposes release key, committed timestamp, bundle SHA, mapper version, reconciliation status, and schema revision; it is read-only and singleton only if supported.
- URL values remain exact source values. Use an actual supported URL display if the pinned UI provides it; otherwise show the URL column and record clickability as a limitation.

### Error Handling and Logging
- Invalid/missing fields or duplicated collection keys fail validation before any API call.
- Verbose logs show manifest version, collection counts and changed metadata keys only; do not print metadata tokens or personal data.

### Tests
- `uv run pytest -q tests/test_directus_metadata.py` validates schema and field names from checked-in metadata.
- Run repository checks for exact set equality with `DIRECTUS_READ_TABLES`.

### Acceptance Criteria
- The seven folders and all 57 allowlisted collections are represented exactly once.
- Technical bridge collections do not appear as normal menu entries; data quality and active release do.
- Readable templates replace UUID presentation for core entities wherever Directus supports relational templates.
- A filtered list can be requested by visible program/semester/assessment and admission dimensions.

### Verification
- `uv run pytest -q tests/test_directus_metadata.py`
- Inspect the parsed manifest and compare its keys against the migration.
- Expected result: all manifest invariants pass without a database or schema access.

## Task 4: Add idempotent metadata apply and exact virtual relation graph

### Intent

Let an operator restore the same navigation and relations after a fresh local Directus startup using the checked-in config and environment secrets only.

### Implementation Steps
1. Add `apply_metadata.py` that reads both manifests, verifies the pinned version and `metadata_only` flag, obtains a bearer token from Directus `/auth/login`, and preflights collection names/fields/targets through the API before changing metadata.
2. Apply folder, collection, field, and preset presentation metadata through supported Directus endpoints; patch only metadata fields and never create or alter an academic PostgreSQL column.
3. Directus 12.4.1's Relations API attempts physical FK DDL with `schema: null`. To avoid that path, write exact `schema: null` relation rows and reverse O2M alias-field rows to `directus_meta` only, using an operator connection restricted to local PG16 `academic_data_test` or `*_dev`; reject remote/production targets and the Directus runtime role.
4. Apply global layout presets using stable names/collection uniqueness. Update an existing preset instead of inserting duplicates. Use global `user/role/bookmark` fields only if accepted by version 12.4.1.
5. Add a CLI preflight/dry-run mode; log planned operation count. On any API failure, stop and return nonzero; avoid partial silent success and do not attempt rollback via academic data writes.
6. Prohibit academic `/items` writes and any academic schema DDL. Do not write to `academic_read`, `directus_read`, or canonical schemas. Restart Directus after relation/alias changes to reload its schema cache.

### Required Interfaces and Contracts
- Inputs: `DIRECTUS_URL`, `DIRECTUS_ADMIN_EMAIL`, `DIRECTUS_ADMIN_PASSWORD`, and `ACADEMIC_DATA_DATABASE_URL` for actual relation metadata writes; no secrets in JSON.
- Outputs: deterministic summary (created/updated/unchanged/skipped/errors) and exit code; `--dry-run` causes no metadata writes.
- API calls use JSON and bounded timeouts. The local operator DB URL is validated before metadata writes; it must be PG16, localhost, an allowed database name, initialized Directus metadata schema, and have metadata DML privileges.
- Relation aliases must be unique in the related collection and must point to actual visible/hidden collections in the projection allowlist.
- Folder/relation metadata uses `schema: null`; the applier performs no academic DDL. Relation metadata persistence is a Directus-owned system-table upsert because the pinned API creation path is not schema-safe.

### Error Handling and Logging
- Fail closed on auth errors, unknown collection, missing field, relation target mismatch, version mismatch, or API response with schema information inconsistent with `null`.
- Log HTTP method/path, collection/field, status and duration; redact `Authorization`, passwords, admin email if needed, source payloads, and DB connection details.

### Tests
- Unit tests validate exact manifests, projection columns, Directus 12.4.1 preset/alias contracts, and fail-closed operator target checks.
- Authenticated local smoke applies the metadata repeatedly and checks for stable collection/relation/preset counts and successful traversal.
- Runtime PostgreSQL schema fingerprint comparison proves metadata operations did not alter academic or projection schema; privilege tests prove the runtime role cannot perform canonical/projection DML/DDL.

### Acceptance Criteria
- `apply_metadata.py --dry-run` emits a deterministic plan without writing.
- Applying twice is idempotent for managed folders, relations, aliases, and presets.
- Relations exist as Directus metadata with `schema: null`; PostgreSQL academic/projection constraints and columns remain unchanged. Only Directus-owned metadata rows are written by the operator connection.
- A fresh clone can launch Directus then apply all metadata from the repository without hand-creating fields/relations.

### Verification
- `uv run pytest -q tests/test_directus_metadata.py`
- Run real authenticated API apply twice in Phase 3; compare API metadata and public/directus_read schema fingerprint before and after.
- Expected result: second run reports all managed objects unchanged and no academic schema delta.

## Phase Risks and Mitigations
- Risk: an API update unexpectedly uses a Directus operation that alters underlying columns. Mitigation: only patch `meta` objects; assert `schema: null`; run against a disposable PG16 DB and compare catalog fingerprints.
- Risk: Directus minor-version changes break metadata endpoints. Mitigation: pin/test 12.4.1 and fail before mutation when detected version is incompatible.
- Risk: a preset is private or version-specific. Mitigation: validate global preset fields through runtime API; document native filter UI as fallback.

## Phase Completion Checklist
- The checked-in manifests match the code's actual allowlist and Directus API metadata.
- The applier is safe, idempotent, and does not invoke academic item writes or academic schema changes.
- The config is ready for actual smoke on the isolated PG16 service.
