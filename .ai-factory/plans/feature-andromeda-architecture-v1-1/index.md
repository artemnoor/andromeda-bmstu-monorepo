# Andromeda Architecture v1.1 migration — AIF Ultra plan

## Objective

Move the current repository toward the attached Architecture v1.1 ownership map while preserving existing API and ingestion behavior, PostgreSQL schema history, test-fixture data identity, and the user's existing `tmp/` and ignored `.env`.

The architecture attachment describes a target. Its proposed Web app, Graph Explorer, Dagster runtime, moderation HTTP routes, and other future components are not treated as implemented merely because they appear in the target document.

## Phase status

- [x] Task 1 — Inventory and baseline evidence.
- [x] Task 2 — Move database models, repositories, connection, and Alembic ownership to `packages/db`.
- [x] Task 3 — Separate domain semantics and API contracts into `domain` and `packages/contracts`.
- [x] Task 4 — Move parser ownership to `services/ingestion` and preserve public commands/import namespaces.
- [x] Task 5 — Route publication through the shared API application service; keep HTTP v1 read-only.
- [x] Task 6 — Move Directus metadata and add local Compose/operations scaffolding.
- [x] Task 7 — Add import-boundary checks, path-aware CI, ADRs, and canonical documentation.
- [x] Task 8 — Finish isolated database/integration verification, remote checks, and merge to `main`.

## Verified evidence

- `uv sync --locked --all-packages --group dev --no-editable` passed from the D: continuation clone.
- The full local non-integration suite passed: **77 passed, 8 deselected, 1 existing Starlette/httpx deprecation warning**.
- The API and parser console commands load. `andromeda-bmstu list` reports the five existing commands. Offline bundle validation passed for 21,911 normalized records with digest `42616ee9348ee009fa1b297f7ef697862134835e562c7840f413643ce71d2130`; dry-run reported no DB connection and zero network requests.
- Focused Ruff checks passed for the edited application and DB repository files. Repository-wide `ruff check .` remains red with 280 findings; this broad lint backlog was not mass-reformatted as part of the ownership move.
- Both Compose configurations validated using the explicit `.env.example` file, so the ignored `.env` was not consulted.
- All 11 moved Alembic revision files match the baseline text after normalizing Windows line endings. Existing revision IDs, parent links, single head `f4b19a7c2d61`, and `academic_data_alembic_version` are unchanged.
- PR CI run `37715604293` passed: full suite **85 passed, 1 skipped, 1 warning**; PostgreSQL lifecycle **8 passed**; API/ingestion **60 passed**; Directus **7 passed, 1 skipped**; domain/contracts **18 passed**.
- Main CI run `37717732002` passed on merge commit `dda98f6ba33d06575005dc02e85c2e5d4f6dc246`: full suite **85 passed, 1 skipped, 1 warning**.
- The checked-in `data/` bundle and `tests/fixtures/bmstu/ingestion` have no diff from baseline commit `0daa30e`. PostgreSQL CI covered release counts, archive digest, idempotent re-import, rollback, stale-base rejection, and concurrent publication.
- The migration was merged to `main` by PR #4 at `dda98f6ba33d06575005dc02e85c2e5d4f6dc246`.
- Production export parity and backup/restore remain unverified because no production database or backup was available; no production preservation claim is made.

## Task 8 completion notes

- Local Docker Desktop was stopped, so the final database checks ran in GitHub Actions against isolated PostgreSQL 16 services and passed.
- PR CI, main CI, and merge are complete. Production backup/restore and production data parity remain outside the available verification evidence.
- The original C: checkout has no free space. Continue in the D: clone; do not clean or overwrite the original checkout's `tmp/`, ignored `.env`, or unrelated artifacts.

## Completion rule

Record test, database, bundle, Compose, CI, and merge evidence in `docs/architecture/MIGRATION_REPORT.md`. Keep production-only checks explicitly unverified. Task 8 is complete after the merge SHA and main CI success are recorded.
