# Architecture v1.1 migration report

> Evidence date: 2026-10-08. This report records the migration and follow-up verification evidence. It is not a production-readiness report.

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

## Follow-up integration and restore verification

- PR [#5](https://github.com/artemnoor/andromeda-bmstu-monorepo/pull/5), code head `1a946d1`, passed workflow run [`37722827566`](https://github.com/artemnoor/andromeda-bmstu-monorepo/actions/runs/37722827566): full suite **85 passed, 1 skipped, 1 warning**; PostgreSQL lifecycle **8 passed, 1 warning**; API/ingestion **60 passed, 1 warning**; Directus **7 passed, 1 skipped**; domain/contracts **18 passed, 1 warning**.
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

Task 8 is complete for the migration scope: PR #4 merged as `dda98f6ba33d06575005dc02e85c2e5d4f6dc246`, PR CI run `37715604293` passed, and main CI run `37717732002` passed. PR #5 adds the integration layout and test-database restore rehearsal; its CI run is recorded above. The available checks establish preservation of checked-in data, fixtures, schema history, API/CLI contracts, and PostgreSQL release behavior. They do not establish production data parity, production backup/restore, or deployment readiness.
