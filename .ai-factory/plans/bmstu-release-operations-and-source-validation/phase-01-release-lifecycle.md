# Phase 1: Release artifacts and guarded lifecycle

Plan: [index.md](index.md)
Tasks: 1–2
Depends on: none

## Objective

Make the committed active release the recoverable base for the next importer bundle; serialize publication and rollback without mutating previously published fact rows.

## Current-Code Evidence

| Path | Symbols | Why it matters |
|---|---|---|
| `parsers/src/andromeda_parser/cli.py` | `_parser`, `ingest stage --base` | Defaults to the original snapshot. |
| `parsers/src/andromeda_parser/bundle.py` | `_base_validation`, `build_candidate_bundle` | Copies a bundle and records digest, not release ID. |
| `academic-data/src/academic_data_service/importer/persistence.py` | `commit_projection` | Uses per-input digest locking and does not compare candidate base. |
| `academic-data/src/academic_data_service/infrastructure/database/models.py` | `DataReleaseModel`, `ActiveDataReleaseModel` | Existing release/pointer models are the lifecycle boundary. |
| `academic-data/migrations/versions/a0337fe46f54_add_temporal_facts_and_typed_evidence.py` | immutable fact triggers | Existing append-only protection must remain. |
| `academic-data/src/academic_data_service/importer/bundle.py` | `BundleReader`, `validate_bundle` | Canonical digest and validation implementation. |

## Files to Change

| Path | Action | Responsibility |
|---|---|---|
| `academic-data/migrations/versions/<new>_release_operations.py` | create | Bundle archive and activation audit tables; preserve prior revisions. |
| `academic-data/src/academic_data_service/infrastructure/database/models.py` | modify | Map new append-only tables. |
| `academic-data/src/academic_data_service/importer/bundle.py` | modify | Deterministic archive and safe extraction helpers. |
| `academic-data/src/academic_data_service/importer/persistence.py` | modify | Archive at commit; selected release export/adoption; optimistic commit and rollback. |
| `academic-data/src/academic_data_service/cli.py` | modify | Add `release show/export/adopt-bundle/rollback`. |
| `tests/test_offline_bundle.py` | modify | Verify archive round-trip, bad digest and unsafe paths. |
| `tests/test_postgres_import.py` | modify | Verify DB archive and lifecycle persistence. |

## Task 1: Store and export a verifiable bundle for each immutable release

### Intent

The DB does not currently retain the normalized input bundle. Keep a compressed immutable interchange artifact with each new release so subsequent work does not depend on workspace files or the initial snapshot.

### Implementation Steps

1. Add Alembic migration with `data_release_bundle_artifacts(release_id PK/FK RESTRICT, format_version, archive_bytes BYTEA, archive_sha256, created_at)`. Add append-only trigger rejecting UPDATE/DELETE. Add append-only `release_activation_events` with previous/new release, operation, actor, UTC time, reason and expected prior release.
2. Build deterministic ZIP from every file exposed by `BundleReader`: sorted POSIX paths, fixed ZIP timestamps, DEFLATE. Reject symlinks, absolute/parent paths, duplicate names and oversize entries. Reopen and require exact `BundleReader.input_digest` before storing.
3. Store the archive in the same transaction as new release data/reconciliation/activation. Never log contents.
4. Add read-only export for active or selected committed/reconciled release. Verify archive SHA, safe extraction into a new/empty directory, run bundle validation and mapping, and compare importer digest/release ID to DB metadata.
5. Add explicit `adopt-bundle --release-id UUID --input DIR` for legacy releases lacking archives. Require the supplied bundle’s exact digest to equal `data_releases.source_bundle_sha256`, then check recorded table counts. On missing/mismatched bundle, fail closed; do not use `data/bmstu-2026` implicitly.

### Required Interfaces and Contracts

- `academic-data release export --active --output DIR` or `--release-id UUID --output DIR`; exactly one selector.
- `academic-data release adopt-bundle --release-id UUID --input DIR` only for missing legacy archive and exact source digest.
- Exported `BundleReader.input_digest` equals selected `source_bundle_sha256` and every normalized path/byte is preserved.
- Preserve all `data/*.jsonl`, source artifacts, manual review, observations, relationships, evidence, user-confirmed links, requirement trees, review sidecars and future bundle files.

### Error Handling and Logging

- DEBUG: release ID/digest prefix, archive size, file count, export lifecycle.
- INFO: successful export/adoption with outcome and counts.
- ERROR: archive/path/digest/reconciliation mismatch, uncommitted release or non-empty output path; log safe codes only.
- Configurable `LOG_LEVEL`; never log bytes, raw URLs with query values or DB credentials.

### Tests

- Offline byte-for-byte file round-trip includes evidence, relationships, review metadata and AND/OR/AT_LEAST nodes.
- Reject altered archive, unsafe ZIP path, digest mismatch and old snapshot mismatch.
- PostgreSQL 16 commit→export→validate→dry-run; exact-digest adoption succeeds and mismatch leaves DB unchanged.
- Run: `uv run pytest -q tests/test_offline_bundle.py tests/test_postgres_import.py`.

### Acceptance Criteria

- Every new release has exactly one archived importer bundle.
- Export round-trips digest, all files and typed mapper results.
- Legacy artifact recovery is explicit and exact-digest-only; no silent snapshot fallback.
- Existing fact immutability guards remain effective.

### Verification

- `uv run pytest -q tests/test_offline_bundle.py tests/test_postgres_import.py`
- `uv run academic-data bundle validate --input <export-dir>`
- Expected: tests pass and exported digest/reconciliation match the committed release.

## Task 2: Base updates on active releases and guard commit/rollback concurrency

### Intent

Stop accepted facts disappearing in later imports and stop a prepared bundle publishing after the base release has changed.

### Implementation Steps

1. Add validated `release_context.json` sidecar with schema version, `base_release_id`, and `base_source_bundle_sha256`; include it in bundle digest.
2. Remove `data/bmstu-2026` as the stage default. With active DB release, export it and stage from it. Permit an explicit bootstrap bundle only when there is no active release; fail if neither exists.
3. Change `commit_projection` to receive expected base ID. Acquire one fixed transaction advisory lock shared by commit and rollback, lock the active slot `FOR UPDATE`, and compare before any release row insertion. Bootstrap expects no active release. Stale candidates rollback.
4. Allow no-op only when the matching committed release is already active. An identical inactive old bundle cannot silently reactivate. Contextless bundle can bootstrap only into an empty active slot.
5. Implement `academic-data release rollback --to UUID --expected-active UUID --reason TEXT`. Require target committed/reconciled and archive verified. Under the shared lock, compare active ID and update only the pointer; append activation event. Do not modify releases/facts.
6. Capture actor from OS user and UTC time. Add `release show` to inspect current ID/digest/status.

### Required Interfaces and Contracts

- Context is immutable bundle input: `{schema_version, base_release_id, base_source_bundle_sha256}`. Bootstrap contains null base values and only works with no active release.
- Active compare runs inside the write transaction before inserts. Different digests use the same global lock.
- Rollback requires expected active ID and reason; only committed/reconciled releases with valid archives are targets.
- Failure may add failed-batch metadata through existing mechanism but never alters active pointer or release fact rows.

### Error Handling and Logging

- DEBUG: expected/actual active IDs, lock acquisition, candidate digest prefix, transaction stage.
- INFO: commit/no-op/stale/rollback outcome, release IDs and actor.
- ERROR: stale base, invalid target, archive missing, DB serialization failure; redact URL query and credentials.
- CLI remains configurable with DEBUG default.

### Tests

- PG16: explicit bootstrap; current export context; stale commit; concurrent two commits; current-release repeat no-op; inactive duplicate is not activated; rollback; stale rollback; injected pre-activation error; append-only event records.
- Run: `uv run pytest -q tests/test_postgres_import.py`.

### Acceptance Criteria

- Every update stages against current active release and exact release ID.
- Active drift halts before inserts; concurrent stale publisher loses safely.
- Explicit rollback switches pointer only and preserves immutable releases.

### Verification

- `uv run pytest -q tests/test_postgres_import.py`
- Expected: all commit/rollback races preserve a single valid active pointer and no failed candidate facts.

## Phase Risks and Mitigations

- Archive storage adds DB size; DEFLATE normalized files and expose archive byte counts.
- Legacy releases lack archives; require exact verified adoption and report that limit rather than reconstructing from a stale snapshot.
- Concurrency races; take one shared transaction lock before reading active pointer.

## Phase Completion Checklist

- Tasks 1–2 meet archive/export/concurrency/rollback criteria, migration check passes, and index checkboxes are updated only after evidence.
