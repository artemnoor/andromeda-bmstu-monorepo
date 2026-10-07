# Phase 3: Regression, documentation, and delivery

Plan: [index.md](index.md)
Tasks: 4-5
Depends on: Phase 1 and Phase 2 / Tasks 1-3

## Objective

Prove the new resolver through sequence scenarios, existing real PDFs, and the current release's 113-row live-plan slice; document the actual safe behavior and publish only after local verification.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|------|-----------------|----------------|
| `tests/test_bmstu_ingestion.py` | existing curriculum fixture and mutable-field tests | Currently asserts positional keys and repeat parse; update assertions to the new source/canonical distinction. |
| `tests/fixtures/bmstu/ingestion/curriculum.pdf` | SHA `6ff702f0…` | Existing real 8-semester local PDF fixture. |
| `tests/fixtures/bmstu/ingestion/curriculum_2.pdf` | SHA `0358f9b5…` | Existing real 12-semester local PDF fixture. |
| `data/bmstu-2026/data/curriculum_items.jsonl` | exact profile `01.03.02-01`, 113 records | Checked-in canonical records correspond to the latest saved probe's 113 positional exact matches. |
| `docs/LIVE_VALIDATION.md` | 2026-10-07 bounded probe section | Must explain what the saved live report actually verified and that the raw live PDF is not a checked-in fixture. |
| `.github/workflows/*` | existing PostgreSQL 16 test workflow | Push checks the full suite; no tests should be removed or weakened. |

## Files to Change

| Path | Action | Required change |
|------|--------|-----------------|
| `tests/test_curriculum_identity.py` | create | Sequence, key compatibility, duplicate, ambiguity, partial, review, provenance, idempotency, and live-slice regression tests. |
| `tests/test_bmstu_ingestion.py` | modify | Replace positional identity expectations and retain real PDF source provenance assertions. |
| `tests/test_postgres_import.py` | modify only if needed | Verify existing `source_row` JSON persistence with the isolated PostgreSQL 16 importer test fixture. |
| `docs/CURRICULUM_IDENTITY.md` | create | Canonical/source identity, matching, review, legacy keys, and limitations. |
| `docs/ARCHITECTURE.md` | modify | Document the non-invasive reconciliation boundary and active-release baseline. |
| `docs/KNOWN_ISSUES.md` | modify | Record residual rename/duplicate-source limitations accurately. |
| `docs/LIVE_VALIDATION.md` | modify | Reconcile prior report evidence with exact new identity matching and source-body availability. |

## Task 4: Add sequence, ambiguity, provenance, fixture, and live-plan regressions

### Intent

Prevent future changes from restoring position-based identity or creating a false merge. Use both real PDF fixtures and repository data in addition to synthetic rows.

### Implementation Steps

1. Add a synthetic four-row history A/B/C/D and apply the requested updates in order: initial; insert NEW; delete C; reorder; hours change; assessment change; semester change for a unique title; ambiguous semester change in a duplicate-title group; duplicate exact titles; renamed title; repeated identical parse.
2. Assert exact old keys survive every proven match and `NEW` receives a deterministic identity key independent of input order.
3. Assert C is reported potentially removed only for complete plan scope, remains in the candidate base, and is never deleted; partial scope has no removal result.
4. Assert duplicate names and title changes never auto-target old keys, fuzzy scores are hints only, and an explicit review target maps the accepted payload back to an old row-based key.
5. Assert provenance includes the exact plan key, PDF SHA-256, retrieved timestamp, source URL, page where available, printed row, parsed order, and semester; repeat parsing the same source bytes yields the same identity signature.
6. Parse both tracked real fixture PDFs offline and assert their established row counts (89 and 123), repeat-key stability, uniqueness/ambiguity results, and unchanged fixture hashes.
7. Select the exact 2026 profile `01.03.02-01` from the checked-in release bundle; assert the 113 current curriculum records reconcile 113/113 to their published positional keys using exact name/semester (and chair as secondary context), with no new or ambiguous rows. Clearly do not call this a new live fetch.
8. Run the isolated PostgreSQL test to prove accepted `source_row` identity/provenance survives importer mapping and release export where that path is practical.

### Error Handling and Logging

- Tests must fail on identity changes, lost rows, duplicate merges, fixture hash drift, or evidence loss.
- Any PostgreSQL test remains guarded to localhost PostgreSQL 16 and `academic_data_test` only.
- Test logs should show the scenario/status count without dumping complete source documents.

### Tests

- `uv run pytest -q tests/test_curriculum_identity.py tests/test_bmstu_ingestion.py`
- `uv run pytest -q tests/test_postgres_import.py` (only with the already configured isolated PG16 test database)
- Final: `uv run pytest -q`

### Acceptance Criteria

- All required synthetic A-I cases are exercised, including at least five consecutive reconciliation steps.
- Both PDF fixture counts and hashes remain unchanged.
- The offline 113-row release slice maps without changing any old keys; ambiguous count is explicitly reported as zero only for that slice.
- Existing ingestion/API/Directus tests remain intact and green.

### Verification

- `uv run pytest -q`
- Expected result: full suite has no failures; PostgreSQL importer cases run on the CI PostgreSQL 16 service. A local run may report the five guarded PostgreSQL skips when no isolated local PG16 database is configured.

## Task 5: Document the shipped contract and publish with green CI

### Intent

Leave operators with a reproducible explanation of key continuity and publish the tested change to the existing GitHub repository.

### Implementation Steps

1. Write `docs/CURRICULUM_IDENTITY.md` with key shapes, exact matching rules, tie-breakers, status meanings, rename and duplicate review, legacy key compatibility, provenance fields, partial-source behavior, and limitations.
2. Update architecture, known issues, and live validation docs. Distinguish checked-in fixture validation, offline 113-row release comparison, and the prior bounded live probe; do not claim a fresh live parse.
3. Verify no fixture/source files or immutable release bundles changed and no Alembic migration was introduced.
4. Run AIF verification against all tasks and phase links, `git diff --check`, and the full pytest suite.
5. Create the planned commits, push only to the existing `andromeda-public` remote, open a PR, wait for every required GitHub Actions check, and merge only when the run is green and the final branch head matches the tested commit.
6. Confirm the resulting main commit and Actions run ID/link; if repository policy prevents merge, leave the tested PR open and report the exact status.

### Error Handling and Logging

- Do not print or place credentials in logs. Use the already configured `andromeda-public` remote and GitHub authentication.
- A failing action blocks merge; retain the branch/PR and fix the test or implementation rather than removing tests.
- Keep API and Directus files unchanged unless a test reveals an existing identity serialization boundary that must be preserved; no new endpoints or services.

### Tests

- Full test command: `uv run pytest -q`.
- Static checks: `git diff --check`; existing CI workflow on the pushed branch.
- CI evidence: GitHub Actions run for the exact commit intended to merge.

### Acceptance Criteria

- Required docs are updated and accurately distinguish verified fixtures, saved live evidence, and unverified live coverage.
- Full local suite has no failures, and GitHub Actions runs the full PostgreSQL 16-backed suite green.
- The existing repository contains the merged changes, or a green-check PR remains open only if merge is prevented by repository policy.

### Verification

- `uv run pytest -q`
- `git diff --check`
- GitHub Actions checks for the final pushed commit are all green.
- Expected result: no source fixture mutation, no new migration, and a verifiable final commit/run ID.

## Phase Risks and Mitigations

- Risk: local DB tests are long or DB configuration is stale. Mitigation: verify the guarded test database identity before running; never target another database.
- Risk: checked-in live rows are mistaken for a fresh source fetch. Mitigation: docs and final report label the 113-row test as offline release-slice reconciliation backed by the previous saved probe report.
- Risk: external CI reports are delayed or merge permissions differ. Mitigation: keep the push/PR reviewable, wait for the final commit's checks, and report the exact non-green/policy state rather than claiming completion.

## Phase Completion Checklist

- All requested sequence cases and both real local PDF fixtures pass.
- The 113-row offline release slice preserves every existing key.
- Documentation names remaining ambiguity conditions and operator workflow.
- Local and GitHub CI evidence identifies the tested commit.
