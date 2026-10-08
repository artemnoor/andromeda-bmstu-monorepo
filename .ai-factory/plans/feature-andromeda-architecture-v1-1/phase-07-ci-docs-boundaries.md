# Phase 7: Boundaries, CI and Documentation

Plan: [index.md](index.md)
Tasks: 7
Depends on: Tasks 2, 3, 4, 5, 6

## Objective

Make dependency direction executable, organize integration tests and docs under target ownership, and run dependent checks in CI while retaining full runs.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|------|-----------------|----------------|
| .github/workflows/ci.yml | unconditional verify job | Existing full CI behavior |
| pyproject.toml | pytest paths and Python path | Test discovery/workspace settings |
| tests/*.py | shared integration/parser tests | Existing regressions |
| docs/*.md and academic-data/docs/*.md | current guides | Useful content to preserve |
| docs/adr/ADR-0001-api-write-boundary-and-user-domain.md | current read API decision | Must match implementation |

## Files to Change

| Path | Action | Required change |
|------|--------|-----------------|
| tests/integration/** and tests/e2e/README.md | create/move | Place cross-component tests and document deferred E2E |
| tests/import_boundaries.py | create | AST import rules |
| .github/workflows/ci.yml | modify | Dependency path jobs and full runs on main/schedule |
| docs/architecture/**, docs/adr/**, docs/api/**, docs/data-model/**, docs/operations/** | move/create | Canonical documentation structure |
| README.md | modify | Accurate setup, repository map, Make commands and links |
| pyproject.toml and uv.lock | modify | Final workspace graph, pytest discovery and lock |

## Task 7: Enforce boundaries and update documentation/CI

### Intent

Make ownership reviewable in code, preserve useful docs and tests, and ensure dependency changes trigger affected checks.

### Implementation Steps

1. Move PostgreSQL lifecycle, Directus permission and runtime integration modules to tests/integration. Keep unit tests near packages and update pytest discovery.
2. Add AST checks: domain cannot import services, FastAPI, Directus, Dagster, ORM or parser code; apps cannot import DB; ingestion cannot import DB; contracts cannot import routers/UI; API cannot import parser implementation.
3. Keep API tests asserting GET-only /api/v1 and stable error/OpenAPI contracts. Scan real package sources and ignore migrations/fixtures where imports are not runtime dependencies.
4. Split CI checks by changed paths for packages/db, domain, contracts, services/api, services/ingestion, platform/directus, infra and shared config/fixtures. Include pyproject.toml, uv.lock, migrations, tests, fixtures, Compose and workflows in dependent filters.
5. Keep full suite on main and weekly schedule. PostgreSQL 16 migration/integration tests run for DB/API/ingestion impact; Directus HTTP smoke remains conditional on local service configuration.
6. Move docs while retaining content: architecture and migration report; API/readiness; data model/history/curriculum identity; ingestion operations/live validation/known issues; Directus setup/UX; parser and DB READMEs.
7. Create ARCHITECTURE.md, CURRENT_STATE.md, MIGRATION_REPORT.md and ADR-001 through ADR-007. Mark mechanisms implemented only when code/tests prove them; Graph Explorer and Dagster runtime remain deferred.
8. Correct stale revision count/head descriptions, README paths, Compose commands and test commands. Regenerate uv.lock.

### Required Interfaces and Contracts

- Every CI filter includes shared root config, lockfile, migrations, fixtures and workflow files where relevant.
- Dependent jobs run API/ingestion/DB tests; full suite remains on main and schedule.
- Documentation distinguishes implemented code, boundary-only areas, unverified runtime smoke and production gaps.
- Preserve the target specification's proposed/baseline qualification and record which clauses are deferred.

### Requirement Evidence

- User task attachment sections 13, 14, 15, 16, 25, 26, 27 and 28.
- Architecture v1.1 sections 9, 11, 14 and 17.

### Error Handling and Logging

- CI path-filter errors fail the workflow rather than silently skipping checks.
- Full CI remains unconditional for main, scheduled runs and broad/unknown changes.
- Docs explicitly state unknown production state; do not infer successful restore or deployment.

### Tests

- Run all unit and integration tests with revised pytest discovery.
- Run import boundaries directly and under pytest.
- Validate workflow YAML, Compose syntax, links and documented local commands.
- Run uv sync --locked after lock regeneration.

### Acceptance Criteria

- Applicable dependency boundaries are automated.
- Useful old docs/tests are preserved at target paths without duplicate owners.
- CI has path-aware dependent jobs and unconditional full main/scheduled runs.
- README supports setup, API, Directus, ingestion and Make commands.
- ADR-001 through ADR-007 describe implemented decisions and explicit deferred boundaries.

### Verification

- uv run pytest -q
- uv run pytest -q tests/import_boundaries.py
- uv sync --locked --all-packages --group dev --no-editable
- Validate CI YAML and local commands on Windows/PowerShell and Ubuntu CI.
- Search for active academic-data/, parsers/, infra/directus/ and infra/compose.yaml references.

## Phase Risks and Mitigations

- Risk: path filters omit shared impact. Mitigation: include root dependency files, migrations, tests and fixtures in broad jobs.
- Risk: moving docs loses historical evidence. Mitigation: retain factual evidence while updating stale current-state claims.

## Phase Completion Checklist

- Boundary suite, path jobs and full workflow validate.
- Docs describe shipped behavior and named future gaps.
- Task 7 checkbox is updated in index.md.
