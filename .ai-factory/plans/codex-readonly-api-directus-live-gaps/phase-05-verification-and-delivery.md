# Phase 5: Verification and delivery

Plan: [index.md](index.md)
Tasks: 6-7
Depends on: Phases 1-4 / Tasks 1-5

## Objective
Prove parser, release, API, Directus, PostgreSQL permissions, documentation, and CI agree; publish verified changes to the same repository.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|---|---|---|
| `tests/test_postgres_import.py` | sequential updates, conflict, stale base, rollback, concurrency | Existing immutable release guarantees must remain covered. |
| `tests/test_bmstu_ingestion.py` | fixture parsing, request budget, exact-key and source gap tests | Extend current parser coverage without removing tests. |
| `.github/workflows/ci.yml` | PG16 service and test steps | Extend the current required CI, not a new pipeline. |
| `README.md` and requested docs | architecture, readiness, live report, known issues | Must reflect observed implementation and remaining gaps. |

## Files to Change

| Path | Action | Required change |
|---|---|---|
| `services/api/tests/`, `tests/test_api_active_release.py` | create/modify | HTTP and PG16 release/snapshot tests. |
| `tests/test_postgres_read_permissions.py` | create/modify | Actual login negative DML/DDL and view read tests. |
| `.github/workflows/ci.yml` | modify | Install API workspace, run migration/role/bootstrap tests and full test suite. |
| `README.md` | modify | Reproducible DB/import/API/Directus local commands. |
| `docs/ARCHITECTURE.md` | modify | Actual framework/query/repository/DB/view boundaries. |
| `docs/API_READINESS.md` | modify | Verified API and Directus status, plus non-goals and gaps. |
| `docs/LIVE_VALIDATION.md` | modify | New capped live sample, exact comparisons, and source gaps. |
| `docs/KNOWN_ISSUES.md` | modify | Unresolved source and operational limitations. |
| `docs/API.md`, `docs/DIRECTUS.md` | create | Routes/contracts and visualizer setup/permission matrix. |
| `docs/ADR-*.md` | create | Academic/user domain split and API/Directus read-write boundary. |

## Task 6: Verify the complete read contour

### Intent
Prove that consumer access follows a reviewed active release and that the existing ingestion lifecycle still behaves as before.

### Implementation Steps
1. Use only the isolated `academic_data_test` PostgreSQL 16 database. Refuse destructive tests if the configured DB name/server version does not match the test target.
2. Migrate an empty test database, import the checked-in BMSTU bundle, and create a second controlled reviewed release with a changed existing fact and one additional fact.
3. Test API before and after active-release switch; assert release key, values, relations, and provenance all correspond to one release. For one multi-query request, atomically switch the active pointer after first repository resolution and assert all output still uses that cached release ID.
4. Cover exact parser identity, same-document replay, pending tuition, no title matching, no applicant-level exposure, requirement nesting, deterministic pagination, invalid cursor, missing-key 404, views, role denies, and nonempty/empty data paths.
5. Run every existing ingestion test including five sequential updates, conflict, stale base, rollback, concurrency, and recovery. Do not delete or weaken tests.
6. Run migration consistency, bundle validate/dry-run, parser CLI smoke, API router boundary check, and optional Directus local health check.

### Required Interfaces and Contracts
- Integration tests use PostgreSQL 16 and dedicated consumer login roles for permissions; no silent fallback to owner.
- All destructive DB tests run only inside the dedicated test DB and in rollback-protected transactions.
- Existing importer/review/release models are unchanged except for compatible grants/views/migration.
- Live observations remain outside published canonical releases.

### Error Handling and Logging
- Test setup reports database name and PG major only, never connection credentials.
- Refuse to run destructive tests against any non-test database or non-PG16 server.
- Failure to authenticate as a runtime role is a test failure; do not retry with migration-owner credentials.

### Tests
- Run:
  - `uv run --package andromeda-academic-data-db academic-data bundle validate --input data/bmstu-2026`
  - `uv run --package andromeda-academic-data-db academic-data bundle import --input data/bmstu-2026 --dry-run`
  - `uv run --package andromeda-academic-data-db academic-data db upgrade`
  - `uv run pytest -q`
  - `uv run --package andromeda-academic-data-db python -c "from alembic import command; from academic_data_service.cli import build_alembic_config; command.check(build_alembic_config())"`
- Verify the previous PostgreSQL integration suite still includes sequential releases, conflict, concurrency, stale candidate, rollback, and recovery.
- Verify new tests cover API single-release snapshot, all listed routes, provenance/gaps, requirement trees, and Directus/API role limits.

### Acceptance Criteria
- Existing and new unit/integration tests pass on PG16.
- No destructive test can target production or an arbitrary configured database.
- API remains read-only/query-layer-backed and Directus academic access remains view-only.

### Verification
- Execute all commands above on a clean PG16 test DB and in CI.
- Expected result: zero failures across old ingestion and new API/security behavior.

## Task 7: Document and publish

### Intent
Make setup reproducible and publish evidence-backed changes in the existing repository without touching the unrelated origin.

### Implementation Steps
1. Update README with locked workspace setup, PG16 migration/import, API launch, OpenAPI URL, secret-free consumer role bootstrap, and opt-in Directus run/stop.
2. Update architecture and API readiness docs to describe implemented modules, one-release request behavior, role/view boundaries, supported read contracts, and unimplemented write/user features.
3. Add API docs for endpoints, query filters, pagination/cursors, DTOs, error envelope, provenance/data gaps, requirement tree, and no applicant data.
4. Add Directus docs for visible views, DB role matrix, metadata schema exception, secret configuration, setup, health, and limitations.
5. Add ADR(s) for separation of Academic Data vs Applicant/User Data and read-only HTTP/viewer vs existing CLI approval/publication.
6. Update LIVE_VALIDATION with actual source URLs (sanitized), date/time, exchange count, HTTP outcomes, exact-key matches/diffs, and gaps. Clearly separate fixture evidence from live checks and canonical DB writes.
7. Update KNOWN_ISSUES with unresolved exam/quota sources, year-less tuition gaps, catalog HTML status, Directus POC scope, and production auth/rate-limit/deployment work not included.
8. Run full local checks after docs. Commit coherent checkpoints. Push only to remote `andromeda-public`, wait for GitHub Actions on the exact SHA, fix failures without removing tests, then publish/merge in the same repo if repository policy permits. Never push to unrelated `origin` or create a repository.

### Required Interfaces and Contracts
- Documentation explicitly labels each claim as implemented, fixture-tested, live-checked, not implemented, or source gap.
- Final published artifact remains repository `artemnoor/andromeda-bmstu-monorepo`.
- Completion report includes final SHA, GitHub Actions run ID/status, actual tests, live findings, endpoints, Directus collections/permissions, and residual risks.

### Error Handling and Logging
- If official live sources return 403/429, timeout, or exceed budget, record a sanitized gap and stop that source.
- If Docker/Directus is unavailable, report UI smoke as not run; do not claim the service was healthy.
- If GitHub auth or repository branch protection blocks publication, report the real blocker and keep the complete reviewable branch pushed if permitted.
- Never log secrets, source share tokens, or applicant-level records.

### Tests
- Re-run full test suite, migration consistency, bundle validation/dry-run, capped live probe, Directus compose config, role tests, and local Directus health where available.
- Trigger GitHub Actions on the pushed branch and require success on the exact final commit.
- Verify final Git status and remote destination.

### Acceptance Criteria
- Requested docs are accurate and reproducible.
- CI passes on the exact published commit with a recorded run identifier.
- Changes are in the existing repository; no new repository or unrelated remote is touched.
- Final report includes changed functionality, live gaps, routes, Directus collections and privileges, tests/CI, risks, and readiness for frontend work.

### Verification
- Full local `uv run pytest -q`: 39 passed, 1 warning in 844.17 seconds.
- Follow-up API/Directus PostgreSQL 16 integration: 1 passed after runtime ACL hardening.
- Follow-up parser/API contract suite: 26 passed, 1 warning in 99.06 seconds.
- Read-boundary Alembic downgrade to `e91532f013ac` and re-upgrade to
  `f4b19a7c2d61`: passed on the isolated PostgreSQL 16 test database.
- GitHub Actions push run **37588909953** on implementation SHA
  `4a58f1fa93eda6d51a492d219d14c3e48bd0bb1c`: success, 39 passed, 1 warning
  in 652.44 seconds. A documentation-only verification record follows; its
  commit checks are required before final delivery.
- `git status --short --branch`: clean before this verification-record update;
  final status and checks are confirmed after it is published.

## Phase Risks and Mitigations
- Risk: full parser/database suite takes several minutes. Mitigation: run targeted tests after each phase and the full suite once before publication, then repeat only after final code changes.
- Risk: some live sources cannot prove requested facts. Mitigation: report source gaps and keep unknown values out of canonical.
- Risk: local container runtime is unavailable. Mitigation: report Directus UI smoke as unavailable and retain actual PG16 role permission integration evidence.

## Phase Completion Checklist
- Task 6 and Task 7 acceptance criteria pass.
- Final docs and CI match the exact published commit.
- Update Task 6-7 checkboxes in `index.md` only after evidence is collected.
