# Architecture v1.1 migration report

> Snapshot date: 2026-10-08. This report records implementation and verification evidence available before the final clean-checkout phase. It is not a production-readiness report.

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
- The full local non-integration suite passed: **77 passed, 8 deselected, 1 existing Starlette/httpx deprecation warning**. The eight deselected cases require the dedicated PostgreSQL/Directus integration environment.
- The `academic-data` CLI help and `andromeda-bmstu list` commands passed; all five parser commands remain available. Offline bundle validation passed for 21,911 normalized records at digest `42616ee9348ee009fa1b297f7ef697862134835e562c7840f413643ce71d2130`. Offline dry-run reported zero network requests and no database connection.
- Focused Ruff checks passed for the edited application and database repository files. Repository-wide `ruff check .` reports **280 findings**; this migration did not reformat unrelated baseline code.
- Default and Directus-profile Compose configurations passed with `--env-file .env.example`, without consulting the ignored `.env`.
- All 11 relocated Alembic revision files match the baseline contents after normalizing Windows line endings. Existing revision IDs, parent links, single head `f4b19a7c2d61`, and version table name remain unchanged.
- The API application now owns publication orchestration; release lifecycle, classification persistence, migration audit, health reads, and publication SQL are in `packages/db` repositories. HTTP routers remain read-only by boundary checks.
- The final PostgreSQL-backed release lifecycle, Directus permission/runtime, and backup/restore checks remain unverified because Docker Desktop could not start. Earlier isolated PG16 migration checks were completed before the final repository-only edits; they do not substitute for post-move integration evidence.
- GitHub Actions, final data-export parity comparison, and merge to `main` remain pending. The implementation is in the D: continuation clone; the original C: checkout was not modified during this continuation because its volume has no free space.

## Remaining migration work

| Phase | Scope | Evidence status |
|---|---|---|
| 4 | Relocate ingestion and parser ownership while preserving CLI behavior and enforcing its dependency boundary. | The code move is present; parser and related focused regressions are included in the post-move 63-test set. Full PostgreSQL integration remains pending because Docker Desktop could not start. |
| 5 | Route publication callers through one API application service and keep the public v1 surface read-only. | `PublicationApplicationService` is present in `services/api`; both CLI paths call it and the focused post-move set passed. PostgreSQL-backed publication integration remains pending. No proposal table or moderation HTTP routes were added. |
| 6 | Move Directus metadata, add root Compose/operations files, and preserve existing permission/count contracts. | Metadata tests passed 5/5 and both Compose profiles validate. PostgreSQL permission enforcement and Directus runtime smoke remain pending because Docker Desktop could not start. |
| 7 | Organize docs and path-aware CI with unconditional full checks on main/schedule. | Canonical docs, ADRs, compatibility links, and path-aware workflow are present. Compose profile configuration and local tests pass; remote CI is pending. |
| 8 | Clean locked checkout, final full suite, migration/data parity, remote checks, and merge to `main`. | Local locked install, non-integration suite, bundle checks, revision comparison, focused lint, and Compose configuration pass. Docker-backed integration, final release export parity, remote CI, and merge remain pending. |

## Data identity and protection

Final parity must compare the isolated test release against the baseline export manifest: release ID/key, source bundle digest, migration head, every exported file hash, and structural counts. The current local setup does not provide production credentials or a production backup, so this comparison can establish only test-fixture preservation. Existing user `tmp/`, ignored `.env`, and unrelated artifacts are outside this report and must remain untouched.

## Operational and product limits

The migration does not imply a verified production backup/restore, selected RPO/RTO, production deployment, SSO/RBAC, Directus licensed mode or browser review, live-source campaign completeness, general proposal store, complete bitemporal model, outbox worker, Dagster runtime, Web app, or Graph Explorer. These remain unimplemented or unverified until separate evidence is recorded.

## Final report update

Task 8 remains open. Append the clean-checkout PostgreSQL lifecycle and release file-hash comparison, remote GitHub Actions result, and merge SHA after those checks are actually completed. The present blocker for PostgreSQL-backed checks is that Docker Desktop could not start. Do not infer production parity from local fixtures.
