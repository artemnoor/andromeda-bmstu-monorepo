# Andromeda Current State

Inventory captured 2026-10-08 from commit 0daa30e on the user-provided checkout. Target: Architecture v1.1 dated 2026-10-05. This file records observed repository state before ownership relocation; it does not claim production readiness.

## Current ownership

| Current path | Current responsibility | Target owner |
|---|---|---|
| academic-data/src/academic_data_service/infrastructure/database | SQLAlchemy Base, 47 ORM table declarations, connection, DB read repository and revision metadata | packages/db/models and packages/db/repositories |
| academic-data/migrations | Alembic env and 11 revisions | packages/db/migrations |
| academic-data/src/academic_data_service/importer/{bundle,mapping,cli}.py | Bundle validation, mapping and operator import | services/ingestion plus API application service |
| academic-data/src/academic_data_service/importer/persistence.py | Release persistence transaction and canonical data writes | packages/db repository, called only through services/api application |
| academic-data/src/academic_data_service/contracts/v1 | Pydantic API response DTOs and schema registry | packages/contracts |
| academic-data/src/academic_data_service/application/queries.py | Read-side query orchestration | services/api/application |
| academic-data/src/academic_data_service/domain/rules.py | Published rule-version selection | domain/policies |
| academic-data/src/academic_data_service/classification | Classification semantics and append-only writes | domain/policies and API application plus DB repository |
| academic-data/src/academic_data_service/operations | Readiness, release lifecycle and preflight | services/api/application and packages/db adapters |
| parsers/src/andromeda_parser | capture, parse, candidates, diff, review, CLI and commit caller | services/ingestion |
| parsers/src/andromeda/ingestion and modules | BMSTU parsers, source contracts, domain-like Pydantic entities | services/ingestion/contracts and parsers; domain/ontology |
| services/api | FastAPI GET-only /api/v1 composition and read dependencies | remains services/api, with application services added |
| infra/directus/metadata | Directus metadata, relation manifest and guarded applier | platform/directus/metadata |
| infra/compose.yaml | PostgreSQL 16 and optional Directus Compose services | root docker-compose.yml |
| tests/*.py | parser, identity, Directus, offline bundle and PostgreSQL tests | package tests plus tests/integration |
| docs/*.md and academic-data/docs/*.md | architecture, API, operations and data model guides | docs/architecture, docs/api, docs/operations, docs/data-model |
| .github/workflows/ci.yml | One full PostgreSQL-backed verify job | path-aware dependent jobs plus full main/scheduled run |

The checked-in data/bmstu-2026 directory is a normalized, sanitized bundle and provenance fixture, not a database owner or migration seed. No app/web, app/graph-explorer, Dagster deployment, or web frontend exists in the baseline.

## Entry points and runtime

- uv workspace packages: andromeda-academic-data-db at academic-data, andromeda-bmstu-parsers at parsers, andromeda-api at services/api.
- Console commands: academic-data (DB, bundle and release commands) and andromeda-bmstu (parser/ingestion commands).
- API entry point: andromeda_api.main:app; existing /api/v1 routes are GET-only and use a repeatable-read, read-only DB transaction.
- PostgreSQL Compose service: PostgreSQL 16, database academic_data_test, host port 55433 by default.
- Directus: optional Directus 12.4.1 profile. Runtime reads allowlisted directus_read projections and writes only its directus_meta schema; the metadata applier uses a guarded local operator connection.
- Dagster is not installed or used as a runtime. Parser CLI remains operational independently.

## Alembic state

Alembic currently belongs to academic-data/migrations. Its linear revision order is:

1. 0001_initial_service_metadata
2. e0784a907d45_add_academic_data_records
3. a0337fe46f54_add_temporal_facts_and_typed_evidence
4. c81b2907f4a1_allow_duplicate_profile_codes
5. db957c691c30_add_lookup_evidence_bridges
6. f3090f70ec32_preserve_unresolved_official_codes
7. a7d2c91e4f60_guard_active_release
8. de41afbb52c8_add_subject_classification
9. bb3f647a29c1_archive_imported_release_bundles
10. e91532f013ac_record_release_activation_history
11. f4b19a7c2d61_add_readonly_runtime_roles_and_views

There is one head, f4b19a7c2d61, and the custom version table is academic_data_alembic_version. The old academic-data README's “eight revisions” and older migration report head are stale. Revision IDs, parents, operations and table names are to remain unchanged.

## Existing write and read paths

- Both andromeda-bmstu ingest commit and academic-data bundle import --commit reach run_bundle_import and the same commit_projection release transaction. The release transaction uses a lock, checks the active release/base digest, writes one immutable release, and switches the active pointer with activation history.
- This is one shared DB publisher but not yet an API application-service boundary. FastAPI is read-only and there are no proposal, approve, reject or publish HTTP routes.
- Classification import writes append-only release-scoped classification records through a separate importer. Archive adoption and rollback are explicit release lifecycle writers. These need named application use cases; they are not duplicate full-release import implementations.
- Parser candidate/review work is filesystem-based. The parser package has lazy imports into academic-data but does not declare the workspace dependency.
- Directus metadata SQL is scoped to directus_meta; its runtime does not mutate canonical or projection tables.

## Directus inventory

The metadata manifests register 57 collections total: 25 Core-visible and 32 technical. Navigation contains six visible groups and one hidden technical group. The configuration has 97 virtual relations and 14 global presets. Existing tests assert the manifest counts, projection/allowlist alignment, navigation and permission denials. Licensed mode and full browser review are not verified.

## CI and tests

- CI is one unconditional push/pull-request workflow: locked uv install, bundle validation and dry run, active parser listing, PG16 migration and Alembic check, Poppler install and full pytest.
- Tests live mainly in root tests/, with API contracts at services/api/tests/. PostgreSQL lifecycle, Directus permission and Directus HTTP smoke tests are marked integration. The HTTP smoke skips unless DIRECTUS_TEST_URL and local credentials are configured.
- Baseline command results on 2026-10-08: locked uv sync passed; PG16 migration and DB check passed at f4b19a7c2d61; Alembic command.check reported no new upgrade operations; bundle validate passed with one manual-review warning; bundle dry run passed without opening a DB connection; parser inventory listed five active modules.
- Full baseline: 65 passed, 1 skipped, 1 warning in 995.25 seconds. The skipped case is Directus HTTP smoke because no local URL was configured. The warning is Starlette's deprecation notice for httpx in TestClient.
- Baseline checked-in bundle digest: 42616ee9348ee009fa1b297f7ef697862134835e562c7840f413643ce71d2130, 21,911 normalized input records.

## Local test-release snapshot

The baseline lifecycle suite created an active release in the isolated local test database. It is a test fixture, not production data. Its identity and exported bundle are retained for before/after comparison:

- Database: academic_data_test on local PostgreSQL 16
- Release ID: 9d2f3cdd-05bc-5966-85aa-aca0fd5e8c05
- Release key: bmstu-2026:f313ecd0ee649431db1e5521ea67fd8d4abb95830469e0cf872d5d3a9e277145:bmstu-2026-bundle-v4
- Source bundle SHA-256: f313ecd0ee649431db1e5521ea67fd8d4abb95830469e0cf872d5d3a9e277145
- Schema revision: f4b19a7c2d61
- Exported normalized records: 22,172 across 29 JSONL datasets
- Exported source artifacts: 505; source observations: 23,288; source evidence: 19,420
- Other checked counts: curriculum items 14,165; historical admission statistics 784; relationships 3,478; manual review items 560.
- All 39 exported files (36,902,468 bytes) have a captured SHA-256 manifest in the active task context; export path: artifacts/architecture-v1-1-baseline-20261008.

Final parity verification compares release identity, revision and every exported file hash. This does not claim parity with an unavailable production database.

## Unknowns and limits

- No production database, production backups, restore environment, deployment credentials, or approved RPO/RTO were available for inspection.
- Directus HTTP/browser smoke requires local secrets and credentials; its permissions and metadata can still be checked locally.
- Source code does not define a universal relation vocabulary, full proposal persistence, admission policy evaluator, bitemporal system-time columns, or a graph query API. Do not invent these while doing structural relocation.
- No cloud provider or production deployment is selected. Dagster and frontend runtimes remain future work.
- The initial working tree had an untracked tmp/ directory. It is user data and has been left untouched. The ignored .env file was not read.
