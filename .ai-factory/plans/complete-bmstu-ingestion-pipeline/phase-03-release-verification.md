# Phase 3: Release safety verification

Plan: [index.md](index.md)
Tasks: 4
Depends on: Phase 1 / Task 1; Phase 2 / Tasks 2–3

## Objective

Exercise the complete parser-to-bundle-to-PostgreSQL 16 lifecycle with deterministic fixtures and prove release atomicity, idempotency, and preservation of the active release.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|------|-----------------|----------------|
| `academic-data/src/academic_data_service/importer/persistence.py` | `commit_projection`, `run_bundle_import`, `_reconcile_database` | Writes and activates releases transactionally and verifies row counts. |
| `tests/test_postgres_import.py` | PostgreSQL release/import integration cases | Existing disposable DB fixture and importer test patterns. |
| `tests/test_bmstu_ingestion.py` | capture, candidate, review, dry-run path | Existing real local fixture end-to-end coverage. |
| `infra/compose.yaml` | PostgreSQL service | Local integration-test database runs PostgreSQL 16. |
| `.github/workflows/ci.yml` | PostgreSQL 16 service and test step | CI executes the integration suite. |

## Files to Change

| Path | Action | Required change |
|------|--------|-----------------|
| `tests/test_postgres_import.py` | modify | Add lifecycle cases using reviewed local-fixture bundles and isolated database state. |
| `tests/test_bmstu_ingestion.py` | modify | Assert parser failures and candidate conflicts cannot be committed. |
| `academic-data/src/academic_data_service/importer/persistence.py` | modify only if a demonstrated defect exists | Preserve the existing atomic release contract; do not broaden transactions without a failing case. |
| `.github/workflows/ci.yml` | modify only if necessary | Keep PostgreSQL 16 and make the full test gate explicit. |

## Task 4: Verify the end-to-end update lifecycle on PostgreSQL 16

### Intent

Prove that accepted facts reach typed tables and active-release changes remain safe through success, repeat, and failure paths.

### Implementation Steps

1. Use the existing checked-in BMSTU capture/PDF/admission fixtures to build and review a candidate bundle from `data/bmstu-2026`.
2. Start the isolated PostgreSQL 16 service, migrate it, and commit the baseline release.
3. Commit an explicitly reviewed fixture update that changes at least one existing typed fact under an exact approved external key; assert the new row values, source evidence, and active pointer.
4. Create an unchanged reviewed bundle and assert importer dry-run is valid; a committed identical digest returns `no_op` and does not insert duplicate rows.
5. Import the same changed bundle again and assert `no_op`, unchanged row counts, and stable active release.
6. Submit malformed parser input and conflicting/partial candidate bundles; assert parse/materialization stops before database mutation and all base facts remain.
7. Inject the existing pre-activation failure hook while importing a new digest; assert transaction rollback leaves no partial new release rows, the previous active pointer unchanged, and only failure audit metadata is recorded.
8. Commit a second valid release with a distinct digest and baseline-equivalent typed facts; assert the active pointer switches to it and the prior fixture-updated release remains queryable.
9. Cover typed counts for existing exams, requirement trees (AND/OR/AT_LEAST), offerings/places/quotas, tuition and statistics using the existing full BMSTU baseline bundle plus any newly promoted fixture facts.

### Required Interfaces and Contracts

- Tests use a disposable PostgreSQL 16 database and never connect to production or perform live HTTP requests.
- Each release input is validated and projected before its database transaction starts.
- Active release switches only after all typed rows, evidence, reconciliation, and release status are committed in the same transaction.
- Identical input digest/mapper version is idempotent and returns `no_op`.

### Error Handling and Logging

- Integration failures must name the lifecycle phase and relevant release/digest but not include source body contents.
- Rollback assertions check typed rows and active pointer, not only the returned exception.

### Tests

- Change to an accepted fact creates/activates one new release and preserves the old release.
- No-change and repeat import return `no_op` without duplicate typed/evidence rows.
- Parser error, exact-key conflict, and partial capture cannot erase or activate data.
- Pre-activation failure rolls back the new release; active release remains unchanged.
- A following valid release switches active release successfully.
- Existing tests retain schema migration and AND/OR/AT_LEAST reconciliation coverage.

### Acceptance Criteria

- All requested lifecycle cases run against PostgreSQL 16 and pass.
- Typed table counts and evidence reconciliation match the bundle projection.
- Failure paths cannot change the active release or remove valid rows.

### Verification

- `docker compose -f infra/compose.yaml up -d --wait`
- `uv run --no-editable --all-packages pytest -q tests/test_bmstu_ingestion.py tests/test_postgres_import.py`
- `uv run --no-editable --all-packages pytest -q`
- Expected result: focused and complete suites pass on PostgreSQL 16.

## Phase Risks and Mitigations

- Risk: test database state leaks across cases. Mitigation: use unique release inputs and isolated DB fixtures/transaction cleanup; assert initial active pointer per case.
- Risk: the existing failure hook only simulates pre-activation failure. Mitigation: assert complete rollback of all release tables and report this precise coverage limit in docs.

## Phase Completion Checklist

- Task 4 satisfies all acceptance criteria against PostgreSQL 16.
- `index.md` is updated only after successful verification.
