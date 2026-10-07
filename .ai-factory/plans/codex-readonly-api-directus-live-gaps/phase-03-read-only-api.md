# Phase 3: Read-only API

Plan: [index.md](index.md)
Tasks: 4
Depends on: Phase 2 / Task 3

## Objective
Add an OpenAPI-described FastAPI service that delegates all academic read behavior to the existing query/repository layer and returns one release per request.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|---|---|---|
| `academic-data/src/academic_data_service/application/queries.py` | `AcademicDataQueries` | Current typed application readers for catalog, plans/items, campaigns, requirements, tuition, statistics, sources/evidence, and gaps. |
| `academic-data/src/academic_data_service/application/ports.py` | `AcademicDataReadRepository` | Framework-independent read repository protocol. |
| `academic-data/src/academic_data_service/infrastructure/database/read_repository.py` | `SQLAlchemyAcademicDataReadRepository` | Connection-scoped active-release selection and deterministic external-key cursors. |
| `academic-data/src/academic_data_service/contracts/v1/models.py` | v1 DTOs | Existing pagination, release, provenance, gap, and requirement-tree models. |
| `docs/API_READINESS.md` | query readiness | Documents current read coverage and absent HTTP application. |

## Files to Change

| Path | Action | Required change |
|---|---|---|
| `services/api/pyproject.toml` | create | Add minimal API workspace package with FastAPI/Uvicorn and academic-data dependency. |
| `services/api/app/main.py` | create | App factory, OpenAPI metadata, health, stable error handlers. |
| `services/api/app/dependencies/database.py` | create | Per-request connection, repository and query-service construction/cleanup. |
| `services/api/app/routers/*.py` | create | HTTP parameter mapping only; no SQLAlchemy imports. |
| `academic-data/src/academic_data_service/application/queries.py` | modify | Add typed exam/quota read methods if not present. |
| `academic-data/src/academic_data_service/contracts/v1/models.py` | modify | Add only missing typed exam/quota records. |
| `pyproject.toml`, `uv.lock` | modify | Register and lock the API workspace. |
| `services/api/tests/` | create | Test HTTP response contracts and release scope. |

## Task 4: Add FastAPI v1 read endpoints

### Intent
Make the existing academic read model usable from HTTP without moving business logic, SQL, or release decisions into routers.

### Implementation Steps
1. Add `services/api` as a workspace package and expose `create_app(settings, engine_factory)`. Imports must be side-effect-free for tests; require a configured PG16 URL only when serving requests.
2. Create a request dependency that opens exactly one SQLAlchemy Connection/transaction, constructs `SQLAlchemyAcademicDataReadRepository(connection)` and `AcademicDataQueries(repository)`, yields the query service, then closes the transaction/connection in all cases. Use a dedicated runtime DB URL and never log it.
3. Add read-only routes:
   - `GET /api/v1/health` and `GET /api/v1/release`;
   - list/detail directions, departments, programs;
   - program study plans, plan detail, paged curriculum items;
   - campaigns list/detail, offerings and calendar;
   - requirements list/detail;
   - tuition and statistics;
   - typed exams and quota/places only when application query methods/DTOs exist;
   - provenance/source references from DTOs; do not expose manual-review controls as public routes.
4. Add pagination `limit=1..100` and opaque cursors. Map exact direction/program/campaign/semester/year/direction-code filters to existing query methods. Preserve repository key ordering; do not implement cursor SQL in routers.
5. Serialize existing Pydantic v1 DTOs directly. Preserve external keys, source/evidence references, data-gap statuses, release metadata, and full AND/OR/AT_LEAST requirement trees.
6. Add stable error envelope `{error:{code,message,request_id}}` for missing active release, invalid cursor, invalid parameters, missing exact key, and unexpected backend error. Never expose SQL, bind values, stack traces, source document bodies, or credentials.
7. Keep all `/api/v1` methods read-only; implement no POST/PUT/PATCH/DELETE and no moderation/publish endpoint. Enable built-in OpenAPI and document its schema path.
8. Add Uvicorn entrypoint and environment variable docs. Confirm importing domain/query modules does not load FastAPI.

### Required Interfaces and Contracts
- Router dependencies expose only `AcademicDataQueries`, never an Engine, Connection, ORM Table, or SQL string.
- Each list response includes release metadata via the existing page contract; detail responses are built from one request-scoped cached release.
- One request's related queries always filter with the cached active release ID, even if the active pointer changes after its first resolution.
- Routes include `/health`, `/release`, `/directions[/{key}]`, `/departments[/{key}]`, `/programs[/{key}]`, `/programs/{key}/study-plans`, `/study-plans/{key}`, `/study-plans/{key}/items`, `/campaigns[/{key}]`, `/campaigns/{key}/offerings`, `/campaigns/{key}/calendar`, `/requirements[/{key}]`, `/exams`, `/quotas`, `/tuition`, and `/statistics`.
- No endpoint writes to canonical data, releases, source evidence, importer bundles, or active pointer.

### Error Handling and Logging
- INFO: app start/stop and request summary (method, route template, status, elapsed time, resolved release key).
- WARNING: invalid cursor/parameters, missing exact record, no active release, and explicit gap count.
- ERROR: unexpected backend failure with request ID and exception class only; do not log query parameters that may contain secrets, SQL values, raw bodies, or DB URL.
- Return 503 for missing usable active release, 404 for missing exact key, 422 for invalid cursor/filter, and stable error codes.

### Tests
- TestClient covers health, release, list/detail, exact-key filters, page limits, deterministic next cursor, invalid cursor, 404, validation envelope, generic backend envelope, and OpenAPI.
- Assert no write methods exist under `/api/v1` and router modules do not import SQLAlchemy.
- PG16 tests connect as the API restricted login; verify all endpoints can read needed models and cannot mutate canonical rows.
- Switch release between API calls and verify answers change. Switch active pointer after first query resolution inside one multi-read request and verify every field/page uses the cached original release key.
- Assert AND/OR/AT_LEAST nesting survives JSON encoding; source/evidence/data gaps remain; unresolved tuition year is not surfaced as a fabricated canonical fact.
- Run `uv run pytest -q services/api/tests` and relevant integration tests.

### Acceptance Criteria
- OpenAPI is generated and all listed read contracts return typed data.
- Routers contain no SQL and domain/query modules remain independent of FastAPI.
- Restricted API login can satisfy routes but cannot write; every request is bound to one release ID.
- Pagination, errors, provenance, gaps, and requirement operators have regression coverage.

### Verification
- `uv run --package andromeda-api python -c "from andromeda_api.app.main import create_app; print(create_app().openapi()['info']['version'])"`
- `uv run pytest -q services/api/tests`
- Expected result: app import and OpenAPI generation succeed; all HTTP contract tests pass.

## Phase Risks and Mitigations
- Risk: a current DTO cannot represent a desired source field. Mitigation: return the existing contract and an explicit data gap; add a typed DTO only where a canonical model exists.
- Risk: endpoint authors bypass query service. Mitigation: only inject the query object and static test router imports.
- Risk: permission list is incomplete. Mitigation: execute the route suite as the restricted DB login, never owner credentials.

## Phase Completion Checklist
- Task 4 acceptance criteria pass.
- Generated OpenAPI matches implemented route and response contracts.
- Update Task 4 checkbox in `index.md` after restricted-role API integration tests pass.
