# Phase 3: Correctness and Performance Verification

Plan: [index.md](index.md)
Tasks: 5–6
Depends on: Phase 2 / Tasks 3–4

## Objective

Verify that existing and optimized read paths yield the same complete academic comparison on one immutable release and measure the actual product benefit without shifting the readiness condition.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|---|---|---|
| `apps/web-react-poc/src/features/comparison/model.ts` | verified plan selection, item ownership, hours/credits aggregation, classification | Academic semantics the backend change must retain |
| `apps/web-react-poc/src/features/catalog/admission-api.ts` and `admission-model.ts` | admission reads, quotas, requirements, tuition/statistics | Existing source association and campus-safe admission composition |
| `tests/integration/test_postgres_import.py` | publication, activation switch, API read-only tests | PG release lifecycle and permissions |
| `apps/web-react-poc/tests/e2e/paired-visual-performance.spec.ts` | sample identity/complete-data gates and six-viewport comparisons | Existing independent API/visual/browser regression harness |
| `apps/web-react-poc/tests/e2e/comparison-profile.spec.ts` | Chrome trace / React Profiler samples | Frontend CPU and render check |

## Task 5: Verify Academic Correctness and Parity

### Intent

Prove optimized reads preserve academically grounded facts and never produce a successful mixed-release or partial comparison.

### Implementation Steps

1. On a fixed immutable PG16 seed release, collect a reference result using the existing public API endpoints independently of the candidate path. Record exact selected program external keys, plan keys, item keys/counts, totals, taxonomy version, source/evidence keys, admission fact/source keys, and statuses.
2. Collect the candidate path's result on the same immutable release and compare normalized values for programs, plan ownership/status, item ownership/order, hours/credits per row and aggregate, category classification, taxonomy association, admissions, quotas, requirements, tuition/statistics, sources, evidence and gaps.
3. Explain every difference. A difference that changes program identity, curriculum ownership, numeric totals, category assignment, quota association, exam tree, campus evidence or provenance must block. Every accepted representation-only difference gets a focused regression test.
4. Test active release activation at controlled points during the operation (before first read, after release resolution, between data queries, before final validation). Assert the candidate response is wholly release A, wholly release B, or controlled conflict/error; it can never return successful release A metadata with any B record.
5. Exercise 1/2/3 selected programs, direct navigation, selection from catalog, large plans, no verified plan, unverified/newer plans, partial admission facts, zero/null/unknown/unavailable, invalid API body, API timeout, repeated load, retry, and cancellation while leaving the route.
6. Confirm old endpoints, old React selection key migration, Vanilla API consumers and read-only DB grants continue to work.

### Required Interfaces and Contracts

- Full-data ready requires all expected plan rows and validated release identity; time-to-first-useful-content is reported separately.
- Admission joins are source/evidence-backed; no direction-wide pool is silently assigned to an offering or campus.
- `AND`, `OR`, and `AT_LEAST` requirement trees preserve operator/threshold and child ordering.
- Numeric zero remains distinct from missing/unknown; totals use exact integers/Decimals without float conversion.

### Error Handling and Logging

- A release mismatch, corrupt/truncated response, timeout or failed completeness assertion must not be converted into successful empty data.
- Error state offers existing retry/reload behavior; abort after navigation does not commit stale route state.
- Tests log only expected/actual keys and aggregate metadata; omit source claim bodies and secrets.

### Tests

- FastAPI/OpenAPI contract and Python regression.
- PG16 integration: read-only permission, pagination, release publication/activation, stable counts and exact release pinning.
- Vitest academic model/adapter regressions.
- Playwright Chromium/Firefox/WebKit: catalog-to-compare, direct compare, 1/2/3 programs, API errors, cancellation, and UI controls.
- Paired screenshots at 1920×1080, 1440×900, 1280×800, 768×1024, 390×844, 375×667; check charts, legend, tables, overflow and section geometry.

### Acceptance Criteria

- Old API and optimized result are equivalent for all represented facts; all differences have explanation plus a regression.
- Switching active release mid-operation never yields a mixed successful response.
- Error, retry, cancellation, repeated request and browser-state scenarios retain current behavior.
- No visual/UI regression appears in six viewports; Vanilla tests remain green.

### Verification

- `uv run pytest -q tests/integration/test_postgres_import.py services/api/tests/test_api_contracts.py` on isolated PostgreSQL 16.
- `npm --prefix apps/web-react-poc test`, `typecheck`, `lint`, `api:check`, and `build`.
- `npm --prefix apps/web-react-poc run test:e2e -- --project=chromium`, `--project=firefox`, `--project=webkit` against live PG16 API; run Vanilla E2E/build suite.
- Expected result: exact identity/totals/provenance assertions and release race cases pass on the same fixture.

## Task 6: Run Controlled Benchmarks and Regressions

### Intent

Quantify readiness, backend and SQL contribution, requests/bytes, first useful content, JS/rendering/CLS, and visual stability before and after, using Vanilla as a same-run control.

### Implementation Steps

1. Use the same PG16 seed commit and one immutable active release for Vanilla, unchanged React baseline at `6a2da949c098b1198c2c4ccf7a93c641d87716f9`, and candidate React. Run the paired measurement in one isolated CI job/runner wherever feasible; record if the baseline must come from a prior exact-SHA artifact.
2. Build all frontend variants for production. Use the same Chromium version/process, 1440×900 viewport, device scale factor 1, reduced motion, locale/timezone and cleared/disabled HTTP cache. Warm each app/scenario once, then run at least ten alternating measured iterations per app/scenario with no retry or concurrent benchmark job.
3. Measure: screen ready and full-data-ready, first useful content, API request count and individual durations/response bytes, FastAPI duration, SQL count/duration and buffers, serialization/JSON bytes, JS bytes, total transfer, render/profile time, long tasks, CLS, and catalog filter interaction.
4. Retain all raw samples and environment metadata as a workflow artifact. Report median, min/max, and nearest-rank p95 only as a small-sample estimate. Reconcile target readiness of 1800 ms without changing completeness gates.
5. Benchmark two and three programs and large curricula for correctness/size caps separately from the canonical two-program median. Include unverified/missing plan and partial admission fixture cases in functional tests, not as faster benchmark samples.
6. Run the frontend, backend, API-contract, PostgreSQL 16, full Python, Vanilla, all-browser Playwright, OpenAPI drift, production-build and visual suites. Do not alter test expected data to make the change pass.
7. If response bytes/time-to-first-useful-content regress while total readiness improves, report the trade-off and reject the architecture if product usefulness is harmed.

### Required Interfaces and Contracts

- Before and after samples must share the full-data-ready condition, programs, verified plans, release, database seed, cache conditions, browser and runner class.
- The raw record must retain per-sample measurements; no sample aggregation is a substitute for source data.
- Any server profiling metadata is benchmark-only and contains timing/counts, not records or source claims.

### Error Handling and Logging

- Preserve failed runs/artifacts and report failures. Do not retry failed performance samples silently.
- Separate application failures from runner, database service and browser installation failures.

### Tests

- Full test and measurement matrix listed in the user request, subject to actual tool/CI availability. Record any unrun browser or DB-engine combination exactly.
- Explicit PG16 test against isolated CI service; local PostgreSQL 17 is not a substitute for that result.

### Acceptance Criteria

- At least ten after-warm-up samples for each primary app/scenario if CI completes; otherwise a named infrastructure reason and the largest valid sample are documented.
- Baseline, post-change React, and Vanilla results include all requested metrics or a named unsupported-measurement reason.
- The analysis shows whether 1800 ms was reached and the full response remains complete and interactive.
- Raw JSON, environment versions, run IDs and artifacts are retained/referenced in the report.

### Verification

- `BENCHMARK_ITERATIONS=10 npm --prefix apps/web-react-poc run test:benchmark` on the PG16 fixture.
- CI browser job on the candidate PR plus the exact baseline revision, or compare to the retained exact-SHA baseline artifact with limitations stated.
- Expected result: ten valid paired samples per primary scenario and independent sample validators all pass.

## Phase Risks and Mitigations

- Risk: changing ready criteria creates an artificial improvement. Mitigation: keep exact existing full-data-ready definition and publish first-content separately.
- Risk: tiny sample p95 overstates stability. Mitigation: label sample maximum and publish median/raw samples.
- Risk: CI lacks a target browser/DB engine. Mitigation: try the required CI matrix; report missing evidence rather than infer a pass.
