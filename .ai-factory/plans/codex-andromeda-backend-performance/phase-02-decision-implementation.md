# Phase 2: Architecture Decision and Implementation

Plan: [index.md](index.md)
Tasks: 3–4
Depends on: Phase 1 / Tasks 1–2

## Objective

Select the least complex architecture supported by measured backend and browser costs, then implement only that option while retaining all API and academic-data guarantees.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|---|---|---|
| `services/api/src/andromeda_api/application/queries.py` | `_page`, `_program`, `_study_plan`, `_curriculum_item`, `_sourced` | Maps API DTOs and currently invokes repository lookups while mapping rows |
| `packages/db/src/andromeda_db/repositories/read_repository.py` | `page`, `related`, `evidence_for`, `manual_reviews_for` | Set-based and per-row SQL primitives; cursor pagination and count query behavior |
| `packages/contracts/src/andromeda_contracts/api/v1/models.py` | `PageResponse`, provenance DTOs, program/plan/item/admission DTOs | Existing versioned read contract and completeness/provenance fields |
| `apps/web-react-poc/src/features/comparison/api.ts` | `loadProgramComparison` | Client identity selection, release checks, parallelism and exact readiness behavior |
| `apps/web-react-poc/src/features/catalog/admission-api.ts` | selected admission reads/cache | Admission request graph and currently verified relation evidence |
| `apps/web-react-poc/src/shared/api/client.ts` | `collectPages`, `loadCatalog`, release verification | Existing pagination bounds, active release bracketing and errors |

## Task 3: Select a Safe Read Architecture

### Intent

Compare A (existing endpoint/query optimization), B (narrow grouped read), and C (comparison-specific snapshot) against measured performance, complexity, response size, and release guarantees. Make a documented GO/NO-GO decision before implementation.

### Implementation Steps

1. Populate the A/B/C criteria table with measured backend complexity indicators, frontend requests/bytes, readiness observations, response completeness, release semantics, query count, source-field size, and regression coverage.
2. Separate each measured value (with run/artifact ID and sample size) from an architectural estimate. Do not put estimated readiness into a measured column.
3. Evaluate A as set-based loading of proven repeated relation/provenance reads while preserving current DTOs and API calls. Include pagination exact-count overhead and catalog response mapping.
4. Evaluate B as a bounded multi-key bulk read. Specify exact IDs, maximum three programs, per-plan completeness, pagination/size cap behavior, release binding, request count and how old API data parity is independently checked.
5. Evaluate C as a dedicated comparison API only if it materially shortens the measured critical path after A/B alternatives. Specify one read-only `REPEATABLE READ` request, pin the active release once, use only same-release predicates, include provenance/completeness, preserve admission evidence, and define active-pointer switching behavior (complete pinned release or controlled retry/error; never success with mixed release).
6. Decide the option and write explicit GO, CONDITIONAL GO, or NO-GO criteria. If measurement does not prove a material benefit at acceptable complexity, select no new API and implement only any independently justified query optimization.

### Required Interfaces and Contracts

- Keep `/api/v1` and every old route backward compatible; an added contract is additive and OpenAPI-generated.
- Program identity is exact external key, never an unverified code join. A new comparison-specific request permits at most three distinct keys and has bounded input/output sizes.
- A large plan is complete only when every item is returned and its item_count is verified; any ceiling must return a controlled error or explicit incomplete status, never a silent successful truncation.
- The API must preserve `sources`, evidence/data gaps, program/curriculum ownership, verified latest-plan selection, taxonomy key/version, and nullable numeric values.
- Admission composition must preserve campus scope and verified offering/pool/requirement links. Unknown, null, zero and unavailable remain distinct. AND/OR/AT_LEAST requirement trees remain structurally unchanged.

### Error Handling and Logging

- Record the decision and rejected alternatives with evidence references, assumptions, and remaining unknowns.
- Do not log raw request payloads that contain source or academic details; log route template, measured counts, and request id at opt-in diagnostic level only.

### Tests

- Architecture comparison itself is reviewable documentation and backed by the profile tests from Phase 1.
- Before coding, confirm each new behavioral decision has at least one verification case and no unresolved cross-release semantics.

### Acceptance Criteria

- The table covers every requested dimension: complexity, frontend complexity, API requests, size, readiness, release consistency, reusability, testability, maintainability, migration cost.
- Report marks actual versus estimated values.
- Chosen option minimizes complexity while materially reducing a measured critical-path cost; otherwise a NO-GO is recorded and no speculative endpoint is built.

### Verification

- Review the A/B/C table against raw PG16, API and browser artifacts.
- Verify the choice honors all requirements reconciliation rows in `index.md`.
- Expected result: an explicit accepted option and no blocking open architecture question.

## Task 4: Implement the Selected Optimization

### Intent

Reduce only the measured source of delay and prove the API still produces exactly the same academically meaningful facts.

### Implementation Steps

1. **If A is selected:** extend the existing repository read port with narrowly scoped batch lookup operations for the proven row-mapper N+1; group evidence and manual-review rows by exact current-release record IDs/keys; preserve ordering and source de-duplication; use set-based operations bound to the request's pinned `release_id`.
2. **If A includes catalog mapping:** batch program relations (departments, study-plan keys, course keys, offerings, direction keys) and provenance for one returned page. Preserve unbounded relation completeness unless separately bounded by the existing API contract; do not select arbitrary subsets.
3. **If B is selected instead/also:** add only the read-only grouped endpoint agreed in Task 3, validate 1–3 distinct strict external keys, pin `release_id`, return same-release metadata and complete plan/item/provenance sections, enforce response cap with controlled error, and generate TypeScript types from updated OpenAPI. Do not remove existing endpoints.
4. **If C is selected:** implement a single query-service entry that reads all snapshot facts within the dependency's single read-only Repeatable Read transaction. Use set-based batch reads, not current per-record mappers. Return one explicit release key and per-section completeness/warnings. Verify active pointer at completion if contract requires current-active semantics; return a controlled conflict if active release changed instead of a partial/successful mixed response.
5. Keep business rules for latest verified plan selection and existing admission-to-program interpretation in the existing tested domain/client code unless moving them is unavoidable and explicitly specified in Task 3.
6. Keep React calls within `src/shared/api/client.ts`-based adapter and propagate `AbortSignal`; retain browser selections and UI state. Do not change CSS, Vanilla source, production routing, or add a cache layer.
7. Update/add query-count tests, contract tests, unit tests and DB release-switch tests before calling the implementation complete.

### Required Interfaces and Contracts

- Existing public DTO fields and errors remain compatible. New fields use versioned API schemas and documented defaults only when semantically correct.
- Request limits, duplicate/missing key behavior, completeness, max response records/bytes, timeout and retry behavior are explicit.
- All SQL filters include the pinned `release_id`, including related evidence, reviews, classification and taxonomy reads where release-scoped.
- Do not change PostgreSQL schema, indexes, release publication/immutability rules, atomic activation, or read-only permissions without measured EXPLAIN evidence and a separately justified migration.
- TypeScript API types are regenerated by `npm --prefix apps/web-react-poc run api:generate` and verified by `api:check`.

### Error Handling and Logging

- Invalid identities/too many IDs: controlled 422 contract error.
- Missing program or no verified plan: preserve existing distinction and renderable status; do not convert to an empty confirmed dataset.
- Exceeded response ceiling: 413/controlled domain error or explicit incomplete result according to Task 3; never 200 with silently missing records.
- SQL timeout/connection failure: existing safe error envelope; no partial success.
- Any added logs are configurable, structured, request-correlated, and omit student/user data, source claim text, and full academic payloads.

### Tests

- Test exact DTO parity against the old API from one pinned immutable release, including provenance order/deduplication and data gaps.
- Test 0/1/2/3/4 programs, duplicates, invalid/missing keys, large plans, zero/null/unknown/unavailable, cursor/completeness, source provenance and controlled size limit.
- Test release pointer switches before/during/after query composition using PostgreSQL 16 and assert either one old/new release or a controlled error.
- Verify no write statements are issued by the new path and production read-only role can call it.

### Acceptance Criteria

- The selected performance cost drops measurably without dropping any academic or provenance record.
- No hidden migration, dependency, architecture layer, unsupported join, new user-visible feature, UI redesign, or Vanilla/prod-routing change is present.
- API contract is strict, versioned, OpenAPI-generated, and backward compatible.
- All new request paths preserve exact identity, complete pagination, aborts, safe errors and release consistency.

### Verification

- `uv run pytest -q services/api/tests/test_api_contracts.py tests/integration/test_postgres_import.py` in PG16 CI.
- `npm --prefix apps/web-react-poc run api:check`, `typecheck`, `lint`, `test`, `build`.
- Run targeted SQL query-count and release-switch tests; expected query count is bounded by page/batch count, not linearly by each returned item's provenance/lookups.

## Phase Risks and Mitigations

- Risk: batching changes source association or de-duplication. Mitigation: exact-key grouping and old-API parity assertions.
- Risk: fewer requests but a very large response delays useful content. Mitigation: compare response bytes and first-useful-content in Task 6 and retain page/incremental behavior if it wins.
- Risk: a snapshot endpoint becomes a second admission business-rule implementation. Mitigation: avoid C unless profile shows enough gain; retain raw source facts and reuse existing association logic.
