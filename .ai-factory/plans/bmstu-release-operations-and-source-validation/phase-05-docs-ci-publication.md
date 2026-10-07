# Phase 5: Documentation and publication

Plan: [index.md](index.md)
Tasks: 7–8
Depends on: Phase 4 / Task 6

## Objective

Document reproducible update/moderation operations and actual future API/Directus boundary; then publish the verified code on the existing GitHub main and observe green Actions for its exact SHA.

## Current-Code Evidence

| Path | Symbols | Why it matters |
|---|---|---|
| `README.md` | install/update guide | Must stop describing initial bundle as ongoing base. |
| `docs/ARCHITECTURE.md` | ownership/release flow | Currently says bundle is based on `data/bmstu-2026` and parser results are observations only. |
| `docs/KNOWN_ISSUES.md` | limitations | Update with verified source/model/archive gaps. |
| `docs/INGESTION_AUDIT.md` | previous fixture audit | Add dated limited live evidence and differentiate fixture vs live. |
| `academic-data/src/academic_data_service/contracts/v1/models.py` | strict v1 DTOs | Existing read contract readiness evidence. |
| `academic-data/src/academic_data_service/application/queries.py` | `AcademicDataQueries` | Read service boundary exists without HTTP API. |

## Files to Change

| Path | Action | Responsibility |
|---|---|---|
| `README.md` | modify | Clean start, explicit bootstrap, active update, moderation, validation, PG commit and rollback commands. |
| `docs/ARCHITECTURE.md` | modify | Accurate release-centered flow, immutable archive/audit and future read boundary. |
| `docs/INGESTION_AUDIT.md` | modify | Live evidence and exact source gaps/DB comparison. |
| `docs/KNOWN_ISSUES.md` | modify | Actual unresolved migration/archive/parser/API/profile/source coverage limits. |
| `docs/INGESTION_OPERATIONS.md` | create | Safe operator runbook, recovery and rollback. |
| `docs/API_READINESS.md` | create | Existing read contract matrix, applicant profile boundary, Directus compatibility. |
| `docs/LIVE_VALIDATION.md` | create | Dated report; linked from audit and runbook. |

## Task 7: Document operator workflow, API/Directus readiness, live findings, and limitations

### Intent

Make the verified pipeline reproducible and prepare the next API/site design without claiming those components already exist.

### Implementation Steps

1. Change architecture flow to active export → bounded capture → parse → exact-key diff → review → validate/dry-run → optimistic commit. Document explicit empty-DB bootstrap and verified rollback.
2. Add end-to-end commands for status/export, fixture update, selective live probe, JSON/CSV diff, safe bulk review, individual review/reopen, validation, dry-run, explicit local test DB commit and rollback. State updates never default to `data/bmstu-2026`.
3. Describe migration/test isolation, archive size/retention, legacy digest-verified adoption, append-only actor audit and recovery after failed/stale import.
4. Build actual readiness matrix from DTO/query/repository code for programs, departments, study plans, curriculum/discipline, courses, exams/requirement trees, places/quotas, tuition, calendar, aggregate statistics, evidence and reviews. Record existing release key, pagination, source/evidence/gap contracts, and explicitly missing FastAPI routes/auth/versioning policy.
5. Document a future applicant profile as separately owned, consent/PII-controlled mutable domain outside academic release snapshots. Implement no profile table/service.
6. Describe a later Directus read-only integration on curated contracts/views; prohibit editing release fact rows or active pointer through Directus. Add no Directus config/service.
7. Link the limited dated live report and distinguish observed/parsed/compared/gap/unsupported/fixture-only data. Preserve unresolved references and limitations.

### Required Interfaces and Contracts

- Commands and environment variables exactly match shipped CLI/settings and use disposable `academic_data_test` for explicit commits.
- Read contract matrix names stable external keys, release identity, pagination/cursor, source/evidence/data gaps and AND/OR/AT_LEAST tree semantics.
- No docs claim deployed FastAPI, site/admin, applicant model, live completeness or automatic source trust.

### Error Handling and Logging

- Explain stale base, no active release, archive mismatch, unsafe bulk diff, 403/429 and rollback drift.
- CLI examples show adjustable DEBUG verbosity and URL redaction.
- Never include secrets, private raw docs or applicant PII.

### Tests

- Verify commands against `--help` and execute relevant documented fixture/export/validate/dry-run flow from Task 6.
- Check prose statements against symbols/tests and live statements against report.
- Run `rg -n 'data/bmstu-2026|observation-only|not run|live' README.md docs` and resolve stale claims.

### Acceptance Criteria

- README/runbook reproduce safe clean bootstrap and active update.
- Architecture, API readiness, Directus/profile boundary and known limits match the code.
- Live report accurately scopes time, URLs, results and gaps.

### Verification

- Follow documented fixture workflow in the isolated local PG16 setup and inspect CLI help.
- Expected: all documented commands parse and feature claims are evidence-backed.

## Task 8: Verify, publish to the existing repository, and confirm green Actions

### Intent

Deliver the completed changes to the named existing public repository and report the Actions result for the precise published commit.

### Implementation Steps

1. Run `git diff --check`, verify the migration graph and AIF plan links/checklists, fixture hash invariants, no secret/PII addition, and current `andromeda-public` URL.
2. Run locked sync, Alembic upgrade/check, bundle validation/dry-run and full PG16 test suite. Keep all old/new tests mandatory.
3. Commit grouped work with conventional messages on current `main`; preserve `origin` and push only to `andromeda-public/main`.
4. Wait for required GitHub Actions on exact HEAD SHA; read failed job logs and fix any cause without reducing tests. Push correction and verify the corrected SHA if required.
5. Confirm remote main SHA equals local HEAD and working tree is clean. Include exact test counts, commit SHA, Actions run/link and limitations in final output.

### Required Interfaces and Contracts

- Repository remains `https://github.com/artemnoor/andromeda-bmstu-monorepo`; no new repo, branch, or CI service.
- Keep PostgreSQL 16 and current validations. No production DB/deployment action.
- Do not change `origin`; verify URL and remote SHA before/after publish.

### Error Handling and Logging

- Report only commit SHA, Actions run ID/status and safe Git output; never echo credentials.
- Authentication errors do not print tokens. CI failures remain failures until fixed and rerun.

### Tests

- Full clean-environment commands from Task 6 and GitHub Actions for published revision.
- Verify no old repository or non-test database was touched.

### Acceptance Criteria

- Local migration, validation, dry-run and full tests pass on PostgreSQL 16.
- Exact final commit is on existing public main, tree is clean and all required Actions checks pass.
- No tests removed, no origin change, no production DB/deployment touched.

### Verification

- `git status --short`, `git diff --check`, `git rev-parse HEAD`, `git ls-remote andromeda-public refs/heads/main`.
- GitHub Actions completion for exact SHA.
- Expected: local and remote SHA agree and CI is green.

## Phase Risks and Mitigations

- Docs may drift from final CLI; execute documented commands and inspect `--help`.
- CI environment may expose missing tools; fix setup without weakening tests.
- Wrong remote risk; verify configured URL/SHA and do not push `origin`.

## Phase Completion Checklist

- Tasks 7–8 meet documentation and publication criteria.
- Do not mark checkboxes complete before evidence exists; exact CI results are ready for final response.
