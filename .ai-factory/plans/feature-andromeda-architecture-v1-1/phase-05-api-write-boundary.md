# Phase 5: API Application Services and Write Boundary

Plan: [index.md](index.md)
Tasks: 5
Depends on: Tasks 2, 3, 4

## Objective

Make FastAPI routers thin and route all programmatic canonical publication through one tested application service while keeping public /api/v1 read-only.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|------|-----------------|----------------|
| services/api/src/andromeda_api/routers/v1.py | GET-only routes | Public compatibility boundary |
| academic-data/src/academic_data_service/application/queries.py | AcademicDataQueries | Existing API read service |
| academic-data/src/academic_data_service/importer/persistence.py | commit_projection | Sole full release transaction |
| parsers/src/andromeda_parser/bundle.py | commit_import | Ingestion CLI caller |
| academic-data/src/academic_data_service/classification/importer.py | append-only classification writer | Separate mutation to govern |
| academic-data/src/academic_data_service/operations/releases.py | archive adoption and rollback | Release lifecycle operations |

## Files to Change

| Path | Action | Required change |
|------|--------|-----------------|
| services/api/src/andromeda_api/application/** | create/move | Own query and mutation use cases |
| services/api/src/andromeda_api/routers/** | modify | Depend on application services/contracts only |
| packages/db/src/andromeda_db/repositories/** | modify | Own transaction and persistence adapters |
| services/ingestion/src/** | modify | Prepare candidates and call shared application boundary |
| academic-data/src/academic_data_service/** | delete after migration | Remove parallel app/domain/DB owner |
| services/api/tests/** and tests/integration/** | modify | Assert API and single publication path |

## Task 5: Use one application-service publication path

### Intent

Keep domain validation, review orchestration and release mutation behind one application boundary. Preserve the transaction; do not add unauthenticated write endpoints.

### Implementation Steps

1. Move AcademicDataQueries into services/api/application and update routers/dependencies. Routers handle request parsing, dependency/auth wiring, service calls and response mapping only.
2. Define a prepared-release contract in packages/contracts. Ingestion prepares this value; API does not import parser implementations or inspect parser internals.
3. Add PublicationApplicationService.publish_bundle(prepared_release, actor, expected_active_release_id). Validate domain invariants, then delegate one transaction to the DB release repository. Preserve advisory locking, current release checks, immutable archives, activation history and idempotence.
4. Make both andromeda-bmstu ingest commit and academic-data bundle import --commit call that same application service. Remove duplicate orchestration and preserve command names.
5. Put rollback, digest-verified archive adoption and append-only classification import behind explicit application use cases and narrow DB repository methods.
6. Add internal proposal use cases create_proposal, validate_proposal, approve_proposal, reject_proposal and publish_proposal with expected-version transitions and repository protocols. Test via fakes; add no persistence table or HTTP route until proposal data/auth contracts exist.
7. Do not add routes under /api/v1 or /admin/v1. Keep public API GET-only. Directus commands remain unexposed until authorization exists.
8. Remove application, importer, operations and classification code from academic-data after every module has a canonical owner.

### Required Interfaces and Contracts

- Router → API application service → domain → repository adapter → PostgreSQL.
- Ingestion CLI → same PublicationApplicationService, passing a prepared contract; ingestion imports no DB repositories.
- packages/db owns all persistence SQL. API application service is the sole programmatic canonical mutation gate.
- Proposal decisions check expected version and status and reject stale/duplicate transitions deterministically.
- Preserve /api/v1 routes, response schemas, error envelopes, pagination and read-only DB transaction.

### Requirement Evidence

- User task attachment sections 8, 9, 14 and 28.
- Architecture v1.1 sections 1.3, 5.1, 8.1 and 9.

### Error Handling and Logging

- Map stale release/proposal versions to stable conflict errors; rollback partial failures.
- Log command/proposal/release IDs, actor ID, versions, digest, transition and outcome. Never log secrets or full source payloads.
- Retry only safe reads or idempotent commands; verify digest/identity before retrying uncertain commits.

### Tests

- Use-case tests cover create/validate/approve/reject/publish transitions, stale versions, duplicate commands and rejection reason.
- Add classification-import regression tests for append-only/release-scoped behavior.
- Run PostgreSQL release, API, Directus permission and CLI regressions.
- Verify exactly one release persistence adapter serves both CLI callers.

### Acceptance Criteria

- Both CLI publication entry points use one PublicationApplicationService.
- Full release DML exists only in the DB repository called by that service.
- Routers contain no SQL/direct canonical mutation; API imports no parser implementation.
- Proposal use cases are internal and tested; no unauthenticated write route exists.

### Verification

- Search for commit_projection and canonical release INSERT/UPDATE statements; confirm one persistence owner and caller path.
- Exercise repeated publish, stale base, failed-activation rollback and concurrent publishers on PG16.
- Compare OpenAPI /api/v1 paths and schemas to Task 1.

## Phase Risks and Mitigations

- Risk: moving the transaction changes locking/failure rollback. Mitigation: move SQL unchanged and keep lifecycle tests green before simplifying it.
- Risk: classification and release publication are distinct writes. Mitigation: route both through explicit use cases and keep classification append-only/release-scoped.

## Phase Completion Checklist

- CLI callers share one application service.
- Release, API and Directus permission tests pass.
- Task 5 checkbox is updated in index.md.
