# Phase 3: Permissions, regressions, and runtime smoke

Plan: [index.md](index.md)
Tasks: 5-6
Depends on: Phase 2 / Tasks 3-4

## Objective

Prove as the real restricted PostgreSQL role and the pinned Directus service that the curated interface is navigable, active-release-consistent, and physically unable to write academic data.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|---|---|---|
| `tests/test_directus_permissions.py` | runtime collection/relation and SQL privilege tests | Uses the actual runtime login and PG16 guard; verifies projection scope, excluded applicant data, active-release consistency, and forbidden SQL. |
| `tests/test_postgres_import.py` | Directus projection active-release rollback checks | Confirms release changes refresh the projection atomically. |
| `infra/compose.yaml` | `academic-data-db`, `directus` | Runs PostgreSQL 16 and Directus 12.4.1 in an isolated profile. |
| `infra/directus/metadata/apply_metadata.py` | metadata apply CLI | Applies the checked-in manifests to the actual local instance. |

## Files to Change

| Path | Action | Required change |
|---|---|---|
| `tests/test_directus_permissions.py` | modify | Complete full DML/DDL denial matrix, excluded-data checks, relation joins, active release and schema fingerprint assertions. |
| `tests/test_directus_metadata.py` | modify | Add actual metadata/API shape validations if not already covered by Phase 2. |
| `.github/workflows/ci.yml` | inspect/modify only if needed | Ensure existing PG16 job picks up tests; avoid adding new services or secrets. |
| Local disposable PostgreSQL 16 and Directus 12.4.1 | run | Authenticated end-to-end smoke, no production DB. |

## Task 5: Verify projection allowlist, relations, and physical read-only boundary

### Intent

Ensure the UI is only an ergonomic layer over the existing database allowlist and cannot bypass the database's security model.

### Implementation Steps
1. Confirm the test guard requires environment `test`, database `academic_data_test`, localhost host, server major 16, and expected owner `andromeda_test`; retain fail-closed behavior.
2. As `andromeda_directus_runtime`, prove SELECT works only against `directus_read` tables and rows belong to one active release; prove canonical `public`, `academic_read`, applicant result sources, raw paths, and observation payload are unavailable.
3. Attempt INSERT, UPDATE, DELETE, TRUNCATE, ALTER, DROP, and CREATE against canonical/projection objects and assert permission denied (`42501`). Verify allowed Directus metadata writes are confined to `directus_meta`.
4. Compare schema fingerprint of canonical `public` tables before/after metadata apply; verify only expected Directus system objects exist in `directus_meta`.
5. Validate exact same-release relation joins in PostgreSQL and through the Directus REST API: program → department bridge, program → plan → items, campaign → offerings/requirements/exams, and curriculum item → evidence → artifact.
6. Preserve and run API and ingestion test suites; do not remove or weaken existing assertions.

### Required Interfaces and Contracts
- Directus integration tests may run only against isolated localhost PostgreSQL 16 `academic_data_test` with `andromeda_test` test owner.
- Set the runtime role password only for the test duration and reset to NULL in `finally`; do not run the PG test while a local Directus container uses that role against the same database.
- Hidden navigation metadata is not an authorization boundary. Exclusion is proven by the absence of applicant result-source projections and the actual runtime role's denied access.

### Error Handling and Logging
- Fail closed if target database identity or server version differs.
- Assert SQLSTATE `42501` for every forbidden operation; any success is a security regression.
- Never print random passwords, token, source payload, or DB URL with credentials.

### Tests
- `uv run pytest -q tests/test_directus_permissions.py`
- `uv run pytest -q tests/test_postgres_import.py`
- Final `uv run pytest -q` on PostgreSQL 16 CI.

### Acceptance Criteria
- All forbidden SQL operations fail under the runtime role; SELECT remains limited to the projection allowlist.
- Applicant result-source tables and omitted sensitive columns are unreachable.
- Projection release ID set has cardinality ≤ 1; active release switch/rollback updates viewer data.
- Directus metadata does not change canonical schema or acquire academic write privileges.
- Existing API and ingestion tests continue to pass.

### Verification
- Run guarded PostgreSQL integration suite against isolated PG16.
- Expected result: the new tests pass, not skip, in CI; local run may safely skip if local PG16 URL is absent.

## Task 6: Run authenticated PostgreSQL 16 + Directus 12.4.1 workflow smoke

### Intent

Verify the actual application experience instead of treating SQL joins or unit tests as proof that Directus navigation works.

### Implementation Steps
1. Start a uniquely named disposable Compose project on non-production ports with only PostgreSQL 16, migrate it and import the reviewed fixture bundle if the active release is empty.
2. Set a temporary password for `andromeda_directus_runtime`, start the pinned Directus service, wait for healthy HTTP, and authenticate through the admin API using throwaway local credentials.
3. Run metadata applier in dry-run and apply modes; run apply again and assert idempotence. Confirm `/collections`, `/fields`, `/relations`, and presets expose the expected metadata. Relation metadata writes remain isolated to `directus_meta`.
4. Through authenticated Directus item APIs, open programs, follow program → study plan → curriculum items, filter items by semester, open campaigns → offerings → requirements/exams, open current/historical statistics, source evidence → artifact, and singleton active release.
5. Run the actual runtime DB permission attempts and confirm academic writes fail; verify no item write request was sent by metadata applier.
6. Inspect menu grouping, display templates, and fields through authenticated metadata APIs; test relation display values and the active-release page through item APIs. No manual browser/Data Studio walkthrough was performed, so visual polish remains unverified.
7. Stop containers and clear temporary credentials/passwords; never target a shared or production DB.

### Required Interfaces and Contracts
- Compose project name, DB port, Directus port, administrator email/password, role password and Directus secret are generated/set locally and not committed.
- Directus runtime points to the same isolated `academic_data_test`; the data projection remains the existing active-release data.
- Requests use bounded timeouts; retries are limited to safe idempotent GETs and the metadata apply's documented upsert behavior.
- Applicant-level items are never queried or presented.

### Error Handling and Logging
- Smoke script reports named path checks and response status only, without tokens/passwords or complete source bodies.
- On failure, stop the local services and clear credentials; preserve logs with secrets redacted.

### Tests
- Authenticated API checks for collection listing, item reads, relation nested reads, dynamic semester filter, active release, and excluded collection absence.
- SQL negative test on the actual runtime login.
- Authenticated API walkthrough of the requested catalog, plan, admissions, evidence, statistics, and active-release paths. Manual browser walkthrough remains outstanding.

### Acceptance Criteria
- Programs, study plans, curriculum items, campaigns, requirements/exams, statistics, source/evidence, and active release open in the real Directus service.
- Relation paths resolve without copying UUIDs; semester filter returns the expected matching rows.
- Active release projection displays the current committed release metadata.
- Academic mutation is denied by PostgreSQL; Directus admin API does not override that boundary.
- The smoke is performed against test PostgreSQL 16 and cleanup is complete.

### Verification
- `docker compose -p <isolated-name> -f infra/compose.yaml --profile directus up -d --wait`
- Run migrations, fixture import, metadata applier and authenticated smoke commands from `docs/DIRECTUS.md`.
- Expected result: all named paths pass and no production/shared database is contacted.

## Phase Risks and Mitigations
- Risk: the DB guard changes runtime login password while a Directus service is running. Mitigation: use separate disposable DB for smoke and tests, or sequence tests before starting Directus; reset the role password in cleanup.
- Risk: Directus item API uses UUID fields but virtual relation metadata does not render as expected. Mitigation: verify nested reads and Data Studio, then adjust metadata only; never add weak name joins.
- Risk: an active release exists from prior local state. Mitigation: use a uniquely named Compose project with fresh ephemeral DB/volume and confirm DB identity before fixture import.

## Phase Completion Checklist
- PG16 permission suite passed with actual runtime DB login.
- Active release and relation behavior verified in PostgreSQL and Directus API.
- Real pinned Directus smoke completed and local secrets/container cleanup verified.
