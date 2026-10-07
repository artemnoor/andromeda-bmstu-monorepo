# Phase 1: Audit and design lock

Plan: [index.md](index.md)
Tasks: 1-2
Depends on: none

## Objective

Establish the exact Directus-visible PostgreSQL contract and pin a safe, version-specific UX metadata design before applying it.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|---|---|---|
| `infra/compose.yaml` | `directus` service | Pins Directus 12.4.1, uses `directus_meta,directus_read` search path and the restricted runtime login. |
| `docs/DIRECTUS.md` | PostgreSQL boundary, Current POC limits | Documents current service, role, 12-collection smoke, and missing curated metadata. |
| `academic-data/migrations/versions/f4b19a7c2d61_add_readonly_runtime_roles_and_views.py` | `DIRECTUS_RELEASE_TABLES`, `DIRECTUS_READ_TABLES`, `upgrade()` | Defines the complete allowlist and CTAS projection; projection copies UUID fields but not SQL foreign keys. |
| `academic-data/src/academic_data_service/infrastructure/database/catalog_models.py` | catalog/program/plan FK declarations | Establishes valid same-release relation columns and exact relation direction. |
| `academic-data/src/academic_data_service/infrastructure/database/admission_models.py` | campaign/offering/requirement FK declarations | Establishes safe admission relation targets and bridges. |
| `academic-data/src/academic_data_service/infrastructure/database/evidence_models.py` | entity evidence bridges | Establishes fact → bridge → source evidence → artifact paths. |
| `tests/test_postgres_import.py` | Directus API/role integration section | Existing integration already tests active projection switching and several runtime denials. |
| `tests/test_directus_permissions.py` | new PG16-guarded tests | Adds projection allowlist, relation joins, exclusion and DB-permission regression coverage. |

## Files to Change

| Path | Action | Required change |
|---|---|---|
| `.ai-factory/plans/codex-directus-viewer-ux/index.md` | create | Manifest, requirement reconciliation, task dependencies and progress ledger. |
| `.ai-factory/plans/codex-directus-viewer-ux/phase-01-audit-design.md` | create | Record audit inputs and exact safe design contract. |

## Task 1: Audit Directus projection, roles, collections, and runtime gaps

### Intent

Derive the configuration from the existing runtime and release-projection contract rather than changing canonical storage to suit the UI.

### Implementation Steps
1. Inventory `DIRECTUS_READ_TABLES` and `DIRECTUS_RELEASE_TABLES` against all Directus-visible projection table/column names. Confirm applicant result sources are absent and `source_observations.payload` and local artifact paths are not projected.
2. Compare `directus_read` fields to SQLAlchemy model FK fields. Record that CTAS projection tables retain UUID columns but only get primary keys; they have no physical relation constraints.
3. Inspect the real pinned Directus 12.4.1 API for collection folders, collection/field metadata, virtual relation metadata (`schema: null`), and presets. Use official Directus documentation plus actual runtime smoke as authority for version behavior.
4. Keep the existing project/runtime DB permissions unchanged unless a test proves a specific least-privilege defect; do not add SQL FK constraints or migration solely for UI navigation.

### Required Interfaces and Contracts
- Directus may browse only the exact `directus_read` allowlist.
- `academic_read` and canonical `public` relations are not granted to the Directus login.
- Metadata updates are restricted to Directus system metadata stored in `directus_meta`; no item writes or schema snapshot apply command may mutate academic tables.
- Hidden collection metadata means hidden from navigation only; it is not an access control boundary.

### Error Handling and Logging
- Report the collection/column missing from the allowlist as a preflight error before any metadata write.
- Log operation, collection/field name, and result at INFO/DEBUG; never log passwords, bearer tokens, source payloads, applicant records, or raw documents.

### Tests
- Static inventory/manifest validation and existing migration tests.
- `uv run pytest -q tests/test_directus_permissions.py` (safe skip unless the isolated PG16 guard is satisfied).

### Acceptance Criteria
- The curated manifest covers exactly the 57 Directus-visible collections and no other database object.
- All list/display/relation fields exist in the projected schema; each relation maps a verified UUID FK column to an allowed target collection.
- No canonical schema, release, importer, API contract, or role grant changes are required for ordinary relation navigation.

### Verification
- Compare manifest collection names with `DIRECTUS_READ_TABLES` (set equality).
- Compare every manifest list field and relation endpoint with the migration/model columns.
- Expected result: no missing names/columns, no excluded collection included, and no SQL FKs added.

## Task 2: Lock a projection-only UX and metadata contract

### Intent

Choose only reproducible settings supported by the pinned Directus version and exact projection data.

### Implementation Steps
1. Define six visible navigation folders (Catalog, Curriculum, Admission, Statistics, Sources/Data Quality, System) and one hidden technical folder for bridges/internal relationship collections.
2. Define Russian labels, icons, group order, readable display templates, concise list fields and sort defaults against real columns; singleton-configure the one-row active release view if Directus 12.4.1 supports it.
3. Define metadata-only M2O relations and reverse aliases for verified one-to-many navigation. Keep technical junctions hidden from primary navigation while preserving nested paths through relation aliases.
4. Define table layouts/global column presets only where the Directus API supports a reproducible global default. Keep dynamic filters available on real fields; do not claim fixed bookmarks/dashboard screens unless they are actually persisted and runtime-verified.
5. Treat manual review/data gaps/unresolved references as read-only collections/filters over existing safe rows. Do not invent a new source or data model.

### Required Interfaces and Contracts
- `infra/directus/metadata/collections.json` is the collection/folder/field/preset manifest.
- `infra/directus/metadata/relations.json` is the only relationship manifest.
- Both manifests declare Directus `12.4.1`, `metadata_only: true`, and include no academic DDL instructions.
- Program → plan → items; program → department bridge; campaign → offering → requirement set/node → exam; fact → evidence bridge → source evidence → source artifact are the intended paths.
- Exact collection names remain physical table names; Russian translations affect display labels only.

### Error Handling and Logging
- If template syntax or translation locale is not honored by 12.4.1, preserve a valid fallback label and document the minimum user preference needed; do not silently claim Russian labels are active.
- If a relation is ambiguous or unsupported, omit that relation and document the exact gap; never derive a relation from matching names.

### Tests
- Validate manifest JSON, version pin, allowlist, duplicate aliases, list field names, relation columns, target collection allowlist, and metadata-only schema marker.
- Run compile/static validation without a database; verify runtime behavior in Phase 3.

### Acceptance Criteria
- All requested visible domain groups exist; technical bridges are not in the ordinary navigation.
- Human-readable templates use actual projected values and no fabricated display fields.
- Dynamic filtering can be performed through the native filter UI/API for curriculum semester/assessment and campaign/program/funding/quota/statistics dimensions.
- Any user-language setting or display limitation is explicit.

### Verification
- Run the manifest validator and assert zero unknown collections/fields/relations.
- Query Directus collections/fields metadata after applying the config in Phase 3.
- Expected result: repeatable visible metadata matches the checked-in manifests exactly.

## Phase Risks and Mitigations
- Risk: Directus virtual relations trigger schema DDL. Mitigation: set `schema: null`, check schema fingerprint, and test with the actual restricted role.
- Risk: hidden tables are mistaken for inaccessible tables. Mitigation: security tests query allowed/excluded data as the DB role; docs state hidden is only UI metadata.

## Phase Completion Checklist
- Audit findings are represented in the design contract.
- Manifest collection and column mapping is grounded in the migration and model definitions.
- No canonical migration is planned without runtime proof of necessity.
