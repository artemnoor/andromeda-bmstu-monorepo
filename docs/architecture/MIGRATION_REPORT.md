# Architecture v1.1 migration report

> Evidence date: 2026-10-08. This report records the migration and follow-up verification evidence. It is not a production-readiness report.

> **Historical note:** The original migration checkpoints below describe the earlier v1.1 ownership move. Their statements that proposal storage was not implemented, repository-wide Ruff still had findings, or proposal PostgreSQL integration was pending are superseded by the **Final hardening follow-up** section below.

## Final hardening follow-up

The hardening work started from main `929eb3589031f36cc87df795aef4af09992f28a6`; no pre-existing Alembic revision or checked-in academic data/fixture was edited. The implementation adds:

- API-independent `packages/release-bundles`; `services/ingestion` no longer declares or imports `andromeda-api`. `services/ingestion-cli` owns the existing `andromeda-bmstu` executable and composes parser commands with API application use cases.
- A PostgreSQL proposal lifecycle in additive Alembic revision `71d8c4a29f30`, linked immutable revisions/evidence/event history, explicit domain transitions, authorization checks, and version compare-and-swap.
- One publication path: the API `PublicationApplicationService` delegates to the existing guarded `publish_projection` repository. Canonical rows/archive, proposal PUBLISHED events, active pointer, activation history, and import-batch idempotency record share one PostgreSQL transaction.
- A whole-publication key/hash on `import_batches` and a stable event key/hash per proposal, with exact retry replay and changed-payload key conflicts.
- A grant-only Alembic revision `7c2a16df09b4` gives the read-only API role SELECT access to `subject_taxonomies`, which the taxonomy endpoint reads.
- Explicit mappings from reviewed dataset filenames to canonical release tables. Publication recomputes each review event ID, resolves accepted candidate references, and rejects a release when a non-null approved payload field is missing or stale in the materialized target or its mapped projection. RETIRE proposals require the target to be absent.
- An AST boundary check for ordinary and literal lazy/runtime imports, and a parser subprocess check that blocks API, DB, FastAPI, and SQLAlchemy imports.
- Locked Ruff `0.16.10`, an unconditional CI lint job, and repository-wide lint fixes without mass rule disables.

The previous 11 Alembic revisions remain unchanged; `71d8c4a29f30` is the additive twelfth revision and `7c2a16df09b4` is the thirteenth, grant-only revision. Public `/api/v1` remains GET-only. No public admin endpoint was added. Directus remains without academic/proposal write privileges. The existing bundle `review_decisions.jsonl` remains the exact reviewed decision source, now linked to proposal audit events by content and event identity.

### Local verification checkpoint

- `uv sync --locked --python 3.11 --all-packages --group dev --no-editable`, `uv lock --check`, `ruff check .`, and `git diff --check` passed in the isolated D: clone.
- Full pytest first ran **82 passed, 23 skipped, 2 failed**. The failures exposed the expected new Alembic head in a migration discovery assertion and an overbroad CLI adapter import; both were corrected. The two focused regression groups then passed **18 tests**. The final clean-checkout suite after all code changes is recorded below.
- The final full local suite after all code fixes passed from a fresh locked checkout: **92 passed, 23 skipped, 1 existing Starlette/httpx deprecation warning in 166.41 seconds**. The skips were 2 Directus permission tests, 1 Directus HTTP smoke, 5 release-import PostgreSQL tests, and 15 proposal PostgreSQL tests because no local PostgreSQL 16/Directus service was configured.
- The focused proposal-bundle binding and application tests passed **11 tests**; the combined final boundary/CLI/proposal regression set passed **22 tests**. They cover event-body tampering with a retained old event ID, candidate-reference resolution, an existing stale target row, and dataset-to-table mappings.
- Ruff baseline on the starting `main` was **261 findings across 102 files** (matching the earlier audit's approximate 280): 94 import-order, 31 verbose `Decimal` construction, 22 unused-import, 24 function-call-default, and 21 blind-exception findings were the largest groups. Ruff marked 186 safe automatic fixes; the remaining findings required manual review of exception handling, control flow, and typing. The final repository-wide check reports zero findings.
- `ruff check .`, `uv lock --check`, `git diff --check`, both Compose configuration profiles, and the retained `andromeda-bmstu ingest --help` command passed locally.
- The 15 new proposal integration cases fail closed unless `ACADEMIC_DATA_DATABASE_URL` points at a local isolated PostgreSQL 16 database named `academic_data_test`. Docker Desktop was unavailable; the local PostgreSQL 17 service was not used. Proposal migration, role grants, concurrency, and rollback therefore require successful PostgreSQL 16 CI evidence before this report can claim them as integration-verified.

The implementation guarantees and exact workflow are documented in [ARCHITECTURE.md](ARCHITECTURE.md) and [PROPOSAL_WORKFLOW.md](PROPOSAL_WORKFLOW.md). Final PR and PostgreSQL 16 evidence is recorded below; the merge commit and main-branch run are reported after merge.

### Final hardening PR verification

- PR [#6](https://github.com/artemnoor/andromeda-bmstu-monorepo/pull/6), final code head `20533d17a58273f164d5aa5582821596897440ca`, passed workflow run [`37768499131`](https://github.com/artemnoor/andromeda-bmstu-monorepo/actions/runs/37768499131): full suite **114 passed, 1 skipped, 1 existing Starlette/httpx warning**; PostgreSQL `db-check` **23 passed, 1 warning**; API/ingestion **77 passed, 1 warning**; Directus **7 passed, 1 skipped**; domain/contracts **21 passed, 1 warning**; and Ruff lint passed.
- The PR database job used isolated PostgreSQL 16, applied proposal revision `71d8c4a29f30`, passed proposal concurrency/publication and release lifecycle cases, then backed up and restored the database. Its historical run predates the taxonomy permission revision `7c2a16df09b4`.
- Push workflow run [`37768493472`](https://github.com/artemnoor/andromeda-bmstu-monorepo/actions/runs/37768493472) also passed the PostgreSQL 16 lifecycle suite (**23 passed, 1 warning**) and backup/restore check on the same final code head.
- GitHub `main` protection requires the `lint` status check and strict up-to-date branches. Production database parity, production backup/restore, and deployment readiness are not implied by these isolated CI checks.

## Scope

The task is to migrate the Andromeda monorepo toward the attached Architecture v1.1 structure while preserving the existing PostgreSQL schema history, published academic data, and parser/API behavior. The target document is a proposal; its listed future components are not evidence that they exist.

The initial repository inventory is preserved in [CURRENT_STATE.md](CURRENT_STATE.md). The previous architecture and migration report are retained as dated historical documents in [`docs/archive`](../archive/).

## Verified baseline

- Starting commit: `0daa30e` (`feat(ingestion): publish reviewed BMSTU admission quotas`).
- Locked baseline workspace install passed. PostgreSQL 16 migration, database check, and Alembic `command.check` passed at `f4b19a7c2d61`.
- Baseline full suite: **65 passed, 1 skipped, 1 warning**. The skip was the Directus HTTP smoke test without local service credentials; the warning was the existing Starlette/httpx deprecation.
- The disposable baseline test release was exported to an ignored, task-specific artifact directory. Its release ID is `9d2f3cdd-05bc-5966-85aa-aca0fd5e8c05`, release key is `bmstu-2026:f313ecd0ee649431db1e5521ea67fd8d4abb95830469e0cf872d5d3a9e277145:bmstu-2026-bundle-v4`, schema revision is `f4b19a7c2d61`, and 39 exported files total 36,902,468 bytes. This is an isolated test fixture, not production data.
- The checked-in baseline bundle digest is `42616ee9348ee009fa1b297f7ef697862134835e562c7840f413643ce71d2130` and contains 21,911 normalized input records.

## Database ownership move

`packages/db` now owns the persistence models, repository adapters, settings/connection, migration configuration and runner, and Alembic history. All 11 revision text contents were verified unchanged; revision IDs and parent links remain the same, the history has one head (`f4b19a7c2d61`), and the custom version table remains `academic_data_alembic_version`.

Verification completed on a disposable PostgreSQL 16 database at port 55435: locked non-editable sync, upgrade, current/head checks, and Alembic `command.check` succeeded. Targeted DB tests reported **19 passed** (one existing Starlette/httpx warning). A separately owned test database and baseline test data were not modified.

## Domain and contracts move

`packages/contracts` owns the API v1 DTO package. `domain` owns pure ontology validation, policy resolution, and repository port types. Parser semantic checks delegate to the ontology validators. The API query/service code does not import DB adapter types; invalid cursors are converted at the HTTP boundary.

Verification completed: focused domain/contracts/API/boundary suite **55 passed**; the broader non-integration run **71 passed, 8 deselected**. The canonical OpenAPI before/after comparison matched exactly: 24 paths, 40 schemas, canonical SHA-256 `59cfcd54a15eb78e2f22e70bb25395c78d65d84139516b01dfe7666e1c1feec4`. These results do not include the final code after later phase integration.

## Post-move verification checkpoint

- The locked, non-editable workspace install passed with all workspace packages and the development group.
- A focused post-move set covering parser, API, domain-boundary, proposal, and offline-bundle behavior passed **63 tests in 182.86 seconds**. It reported one existing Starlette deprecation warning. This was not the full suite.
- Directus metadata checks passed **5/5**; both default and Directus Compose profiles validated.
- PostgreSQL-backed permission checks and full integration were not completed: Docker Desktop could not start. The Directus HTTP smoke and post-move database-grant enforcement therefore remain unverified.
- No GitHub Actions run or production deployment result is implied.

## Final local verification checkpoint

- The final locked non-editable workspace sync passed from the D: continuation clone using a D:-local uv cache because C: has zero bytes free.
- The full local non-integration suite passed: **78 passed, 8 deselected, 1 existing Starlette/httpx deprecation warning**. The eight deselected cases require the dedicated PostgreSQL/Directus integration environment.
- The `academic-data` CLI help and `andromeda-bmstu list` commands passed; all five parser commands remain available. Offline bundle validation passed for 21,911 normalized records at digest `42616ee9348ee009fa1b297f7ef697862134835e562c7840f413643ce71d2130`. Offline dry-run reported zero network requests and no database connection.
- Focused Ruff checks passed for the edited application and database repository files. Repository-wide `ruff check .` reports **280 findings**; this migration did not reformat unrelated baseline code.
- Default and Directus-profile Compose configurations passed with `--env-file .env.example`, without consulting the ignored `.env`.
- All 11 relocated Alembic revision files match the baseline contents after normalizing Windows line endings. Existing revision IDs, parent links, single head `f4b19a7c2d61`, and version table name remain unchanged.
- The API application now owns publication orchestration; release lifecycle, classification persistence, migration audit, health reads, and publication SQL are in `packages/db` repositories. HTTP routers remain read-only by boundary checks.
- Docker Desktop could not start locally, so the final PostgreSQL lifecycle and Directus permission checks ran in GitHub Actions against isolated PostgreSQL 16 services instead. Production backup/restore remains unverified.
- The change was merged to `main`; the original C: checkout was not modified during this continuation because its volume has no free space.

## Remote CI and merge verification

- PR [#4](https://github.com/artemnoor/andromeda-bmstu-monorepo/pull/4), head `092c380`, merged on 2026-10-08 at `dda98f6ba33d06575005dc02e85c2e5d4f6dc246`.
- Pull request workflow run [`37715604293`](https://github.com/artemnoor/andromeda-bmstu-monorepo/actions/runs/37715604293) passed on the final PR head. It reported **85 passed, 1 skipped, 1 existing Starlette/httpx deprecation warning** in the full suite; `db-check` reported **8 passed, 1 warning**; `api-ingestion-check` reported **60 passed, 1 warning**; `directus-check` reported **7 passed, 1 skipped**; and `domain-contracts-check` reported **18 passed, 1 warning**.
- The unconditional main-branch workflow run [`37717732002`](https://github.com/artemnoor/andromeda-bmstu-monorepo/actions/runs/37717732002) passed for merge commit `dda98f6`. The full suite reported **85 passed, 1 skipped, 1 existing Starlette/httpx deprecation warning**.
- The PR database job used its isolated PostgreSQL 16 service and passed the release lifecycle, stale-base, rollback, sequential-update, concurrent-publisher, and read-only permission checks. The CI workflow now installs Poppler in this job because BMSTU curriculum PDF parsing requires `pdftotext`.
- Follow-up PR [#5](https://github.com/artemnoor/andromeda-bmstu-monorepo/pull/5) merged on 2026-10-08 as `27ca67670e15ab7b62a5d41e769a900b17141ca3`. Final PR head `329cb97` passed CI run [`37724845639`](https://github.com/artemnoor/andromeda-bmstu-monorepo/actions/runs/37724845639), and unconditional main CI run [`37726370927`](https://github.com/artemnoor/andromeda-bmstu-monorepo/actions/runs/37726370927) passed for the merge commit.

## Follow-up integration and restore verification

- Final PR head `329cb97` passed workflow run [`37724845639`](https://github.com/artemnoor/andromeda-bmstu-monorepo/actions/runs/37724845639): full suite **85 passed, 1 skipped, 1 warning**; PostgreSQL lifecycle **8 passed, 1 warning**; API/ingestion **60 passed, 1 warning**; Directus **7 passed, 1 skipped**; domain/contracts **18 passed, 1 warning**. Main run `37726370927` reported **85 passed, 1 skipped, 1 warning** in the unconditional full suite.
- The CI database and full-check jobs both created a backup of the isolated PostgreSQL 16 test database and restored it into a temporary database. Both restore checks verified Alembic revision `f4b19a7c2d61`, the `academic_read`, `directus_read`, and `directus_meta` schemas, and all 57 read-model tables. This is a test-database rehearsal, not production backup/restore evidence.
- PostgreSQL lifecycle and Directus permission/runtime tests now live under `tests/integration/`. The moved suite collects 11 tests; Ruff passes for this directory. The local non-integration suite passed **78 tests with 8 PostgreSQL-dependent cases deselected**.
- The documented sanitized baseline export completed an importer dry-run with zero network requests. This shows the current importer accepts that isolated fixture; it does not prove production parity or a byte-for-byte match with the checked-in bundle.
- The follow-up CI exercises `make migrate`, `make validate`, and `make test` with an ephemeral `.env` on GitHub Actions runners. The original ignored `.env`, checked-in data, and pre-existing user artifacts were left untouched.

## Remaining migration work

| Phase | Scope | Evidence status |
|---|---|---|
| 4 | Relocate ingestion and parser ownership while preserving CLI behavior and enforcing its dependency boundary. | Parser/CLI checks passed locally and in the 60-test API/ingestion CI job. Existing commands and fixture parsing remain available. |
| 5 | Route publication callers through one API application service and keep the public v1 surface read-only. | PostgreSQL 16 lifecycle tests passed; a focused API test confirms the application still maps repository publication errors to `BundleImportError`. No proposal table or moderation HTTP routes were added. |
| 6 | Move Directus metadata, add root Compose/operations files, and preserve existing permission/count contracts. | Metadata, permission, and runtime CI checks reported 7 passed and 1 skipped; both Compose profiles validate locally. |
| 7 | Organize docs and path-aware CI with unconditional full checks on main/schedule. | Canonical docs, ADRs, compatibility links, path-aware CI, and the unconditional main full check are present. PR and main workflows passed. |
| 8 | Clean locked checkout, final full suite, migration/data parity, remote checks, and merge to `main`. | Locked installs, local non-integration suite, bundle checks, revision comparison, focused lint, Compose checks, PostgreSQL 16 integration, PR CI, main CI, and merge passed. Exact production export parity and backup/restore were unavailable and are not claimed. |

## Data identity and protection

The checked-in `data/` bundle and `tests/fixtures/bmstu/ingestion` files have no diff from baseline commit `0daa30e`. PostgreSQL 16 CI imported and exported the release, checked row counts and idempotent re-import, validated the stored archive digest, and passed rollback/stale-base checks. No production database, backup, or credentials were available for a production export comparison; production data parity and backup/restore remain unverified. Existing user `tmp/`, ignored `.env`, and unrelated artifacts are outside this report and must remain untouched.

## Operational and product limits

The migration does not imply a verified production backup/restore, selected RPO/RTO, production deployment, SSO/RBAC, Directus licensed mode or browser review, live-source campaign completeness, general proposal store, complete bitemporal model, outbox worker, Dagster runtime, Web app, or Graph Explorer. These remain unimplemented or unverified until separate evidence is recorded.

## Final report update

Task 8 is complete for the migration scope: PR #4 merged as `dda98f6ba33d06575005dc02e85c2e5d4f6dc246` with PR and main CI passing; follow-up PR #5 merged as `27ca67670e15ab7b62a5d41e769a900b17141ca3`, with PR run `37724845639` and main run `37726370927` passing. The available checks establish preservation of checked-in data, fixtures, schema history, API/CLI contracts, and PostgreSQL release behavior. They do not establish production data parity, production backup/restore, or deployment readiness.

## Original frontend integration and QA follow-up (2026-10-09)

The preceding frontend/migration readiness statements are historical checkpoints. The original nine-page vanilla frontend is now integrated under `apps/web/`, uses the same-origin Node proxy and read-only FastAPI `/api/v1`, keeps demo JSON behind explicit `?data=demo`, and keeps profile/favorites/comparison in browser storage. The full browser, data, security, accessibility and performance evidence is maintained in [the comprehensive QA report](../testing/COMPREHENSIVE_QA_REPORT.md).

This follow-up adds Alembic revision `b62d4e91a8c3` as an additive child of `7c2a16df09b4`, bringing the history to fourteen revisions. It preserves nullable targeted-quota organization, tax identifier, region and campus fields from the checked-in source bundle through PostgreSQL export and typed API projection. Tax identifiers remain text. The prior thirteen revision files and existing immutable release rows remain unchanged. The new revision also updates the current migration-head expectation used by backup/restore checks.

The QA branch adds the Playwright browser harness and live PostgreSQL 16-backed browser path, regression cases for release coherence and academic unknown-value semantics, and an unconditional browser integration job for pull requests. Repository-wide Ruff and frontend unit/build checks run in CI. Directus remains read-only on academic tables. Docker Compose validates, but Docker Desktop could not start locally, so a local Directus HTTP container smoke is not claimed. Local verification now reports 118 Python passed/1 skipped, 23 Node passed, a successful build and Ruff, and 229 full Playwright Chromium/Firefox/WebKit cases passed with 41 scoped skips. The focused 39-case requirement/chart run and workflow edge cases pass across all three engines. An earlier Firefox teardown error did not recur in the final combined browser run. Exact current test counts, CI run, PR and merge state are recorded in the [QA report](../testing/COMPREHENSIVE_QA_REPORT.md).
