# Phase 4: End-to-end reliability

Plan: [index.md](index.md)
Tasks: 6
Depends on: Phases 1–3 / Tasks 1–5

## Objective

Prove sequential updates and all requested safety properties on isolated PostgreSQL 16 with checked-in fixtures; preserve all existing tests and CI gates.

## Current-Code Evidence

| Path | Symbols | Why it matters |
|---|---|---|
| `tests/test_postgres_import.py` | `test_commit_is_idempotent_and_failed_activation_rolls_back` | Existing DB transaction case is the base for expansion. |
| `tests/test_bmstu_ingestion.py` | fixture/candidate/conflict tests | Existing real local fixture coverage can be extended. |
| `.github/workflows/ci.yml` | PostgreSQL 16 service and pytest step | Keep version and mandatory verification. |
| `academic-data/src/academic_data_service/settings.py` | `validate_database_target` | Guards destructive PG tests to localhost `academic_data_test`. |

## Files to Change

| Path | Action | Responsibility |
|---|---|---|
| `tests/test_postgres_import.py` | modify | Five-update lifecycle, stale/concurrent commit, rollback, archive/audit/integrity. |
| `tests/test_bmstu_ingestion.py` | modify | Diff, partial data, conflict, review/replay, parse failure and provenance. |
| `tests/test_offline_bundle.py` | modify | Reproducible archive/export/validate/dry-run. |
| `tests/test_bmstu_parser_cli.py` | modify | CLI update workflow and probe no-commit checks. |
| `.github/workflows/ci.yml` | only if needed | Keep PG16 and all tests; do not weaken. |

## Task 6: Verify five-update lifecycle, moderation, concurrency, rollback, and integrity on PostgreSQL 16

### Intent

The key proof is cumulative retention: each published update inherits all earlier accepted facts and metadata, including after no-op, conflict, repeated import and rollback.

### Implementation Steps

1. Use a fixture that asserts `ACADEMIC_DATA_ENV=test`, host localhost, DB name academic_data_test, PostgreSQL major 16, and dedicated migrated test schema. Never load staging/production URL.
2. Execute at least five generations from active export: (1) change a sourced aggregate fact, (2) add a new exact-key fact, (3) unchanged/no-op, (4) contradictory sources blocked and both candidates individually rejected so the accepted base value is retained, (5) import the reviewed bundle again. After each stage assert all prior accepted facts, provenance, evidence and associations still exist and match.
3. Separately test stale base after preparation; two independent connections publish from same base with a synchronization barrier; one must become stale. Test explicit rollback, injected pre-activation failure, rollback failure, and recovery after failed import.
4. Verify partial/failed parse preserves omitted rows; conflict blocks group review; source artifacts/hashes remain immutable; repeated import creates no fact/evidence/audit duplicates.
5. Verify requirement parent-child structure and AND/OR/AT_LEAST values, every supported composite FK, candidate references, exact keys, relation completeness and reconciliation counts.
6. Run clean locked installation, Alembic upgrade/check, baseline validate/dry-run and full tests. No `skip`, `xfail`, test deletion or loosened assertion to obtain green CI.

### Required Interfaces and Contracts

- Five-stage test asserts active release identity, data payload, provenance, archive digest and prior release immutability after every step.
- Concurrency test uses separate DB connections and barrier on commit; outcome must prove actual serialization.
- Rollback target must be committed/reconciled with verified archive and explicit expected active ID.
- Only isolated `academic_data_test` PostgreSQL 16 may be mutated/reset by tests.

### Error Handling and Logging

- Logs identify test DB, PG major, stage number and release IDs; no raw body, applicant data or tokenized URL.
- Failure reports exact stage/assertion and preserves test failure as failure, never warning/skip.

### Tests

- Cover all user-listed cases: sequence, retention, stale/concurrent, diff/bulk, partial data, conflicting sources, immutable source/provenance, no duplicates, active switch, rollback/error, recovery, requirement operators, FKs, clean replay.
- Run: `uv sync --locked --all-packages --group dev --no-editable`; `uv run pytest -q`; baseline bundle validate and dry-run; Alembic `command.check`.

### Acceptance Criteria

- All five operations pass with cumulative data assertions after each.
- Failure/stale/concurrency leaves active pointer unchanged; explicit rollback is only backward switch.
- No duplicate fact, source artifact, evidence or review event; document hashes/operators/relations preserved.
- Full local suite and Actions pass on PostgreSQL 16.

### Verification

- `uv run pytest -q`
- Expected: all existing and new tests pass in local isolated PostgreSQL 16; no skipped scenario.

## Phase Risks and Mitigations

- Existing Compose volume may contain state; verify target first and prefer a disposable CI/local test service.
- Concurrency can be flaky; use deterministic barrier, bounded waits and assert both outcomes and final pointer.
- Sanitized fixture hash is not original source hash; assert source_sha256 and content_sha256 separately.

## Phase Completion Checklist

- Task 6 passes every scenario on PG16, existing checks remain required, and its index checkbox is updated after verification.
