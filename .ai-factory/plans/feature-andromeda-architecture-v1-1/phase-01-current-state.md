# Phase 1: Current State and Baseline

Plan: [index.md](index.md)
Tasks: 1
Depends on: none

## Objective

Record existing ownership and verify the pre-change repository on isolated PostgreSQL 16. No source moves occur in this phase.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|------|-----------------|----------------|
| pyproject.toml | uv workspace | Current packages are academic-data, parsers and services/api |
| academic-data/migrations/versions | 11 revision files | Existing linear Alembic chain |
| academic-data/src/academic_data_service/infrastructure/database | ORM and query adapter | Current DB owner |
| parsers/src/andromeda_parser | CLI and bundle workflow | Current ingestion entry point |
| services/api/src/andromeda_api | FastAPI routes | Existing /api/v1 boundary |
| infra/compose.yaml | PostgreSQL 16 and Directus profile | Current local runtime |
| .github/workflows/ci.yml | verify job | Existing CI |
| tests and services/api/tests | regression suites | Existing behavior evidence |

## Files to Change

| Path | Action | Required change |
|------|--------|-----------------|
| docs/architecture/CURRENT_STATE.md | create | Factual inventory and current-to-target mapping |

## Task 1: Record current state and baseline

### Intent

Establish migration map and regression baseline before changing ownership. Preserve the existing untracked tmp directory and do not read or copy ignored .env.

### Implementation Steps

1. Document workspace packages, Python entry points, DB/ORM ownership, all 11 Alembic revision IDs and sole head f4b19a7c2d61, read/write paths, Directus, tests, CI, Compose and environment variable names.
2. Map academic-data to packages/db plus services/api and services/ingestion; parsers to services/ingestion; infra/directus to platform/directus; flat docs to target directories.
3. Record observed limitations: no web or graph UI, no Dagster runtime, GET-only API, no proposal persistence, and no production DB/restore target available.
4. Run locked install, migration, Alembic check, bundle validation/dry run, parser listing, DB check and full baseline pytest against the isolated local PG16 DB.
5. Record actual outcomes and checked-in bundle digest/counts. Do not commit application data to the test DB during baseline.

### Required Interfaces and Contracts

- Only the isolated academic_data_test database may be migrated.
- Bundle digest: 42616ee9348ee009fa1b297f7ef697862134835e562c7840f413643ce71d2130; validator reports 21,911 source records.
- Do not claim an active release existed before bootstrap; the local test DB was initially empty.

### Requirement Evidence

- User task attachment sections 1, 20, 21, 25, 26 and 28.
- Architecture v1.1 sections 14 and 20.

### Error Handling and Logging

- Record command exit code and failure output verbatim; do not convert a failure into a pass.
- Do not expose environment secrets or inspect .env.

### Tests

- uv sync --locked --all-packages --group dev --no-editable
- PG16: academic-data db upgrade, academic-data db check, Alembic command.check
- Bundle validate and dry-run import; andromeda-bmstu list
- uv run pytest -q

### Acceptance Criteria

- CURRENT_STATE.md distinguishes facts from unknowns and maps each current owner to one target owner.
- Baseline outcomes are recorded accurately; tmp/ remains untouched.
- Alembic head and history are inventoried without editing revisions.

### Verification

- Review CURRENT_STATE.md against repository paths and audit handoffs.
- Check git status and confirm no source edit has been made.

## Phase Risks and Mitigations

- Risk: test setup affects an existing DB. Mitigation: use only the local academic_data_test DB; its initial catalog was verified empty.
- Risk: stale docs are mistaken for current state. Mitigation: cite code/test evidence and correct the stale revision count later.

## Phase Completion Checklist

- Baseline commands have final outcomes.
- Mapping is checked against all six audit handoffs.
- Task 1 checkbox is updated in index.md.
