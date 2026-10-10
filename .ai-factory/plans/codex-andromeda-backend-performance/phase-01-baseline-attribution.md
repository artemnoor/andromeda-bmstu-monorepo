# Phase 1: Baseline and Attribution

Plan: [index.md](index.md)
Tasks: 1–2
Depends on: none

## Objective

Produce repeatable evidence for the catalog timing variation and the full comparison critical path before modifying backend query behavior. Separate observed time from static code analysis.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|---|---|---|
| `apps/web-react-poc/PERFORMANCE_OPTIMIZATION_REPORT.md` | experiment and performance tables | Prior controlled baseline/final comparison and unresolved catalog median variation; five samples per app/scenario |
| `apps/web-react-poc/tests/e2e/paired-visual-performance.spec.ts` | benchmark test, `BENCHMARK_ITERATIONS`, `visitForBenchmark`, sample serializer | Production-build paired browser harness, one warm-up, cache-disabled navigation, raw sample/identity checks |
| `apps/web-react-poc/src/features/comparison/api.ts` | `loadProgramComparison` | Current actual serial and parallel data dependencies and readiness boundary |
| `services/api/src/andromeda_api/dependencies/queries.py` | `get_queries` | One request-scoped read-only Repeatable Read snapshot |
| `packages/db/src/andromeda_db/repositories/read_repository.py` | `page`, `related`, evidence/review reads, `_ensure_active_release` | SQL shape and release pinning |
| `.github/workflows/ci.yml` | `web-browser-check` | Existing isolated PostgreSQL 16 API/browser environment and artifact retention |

## Task 1: Reproduce Catalog Variance and Baseline

### Intent

Determine whether the historical 482→957 ms median movement was a real code regression or an environment/readiness/measurement difference. Establish a before-change dataset for the chosen two-program comparison and Vanilla control.

### Implementation Steps

1. Record HEAD, workflow run/attempt, runner OS, Chromium/Playwright/Node/Python/PostgreSQL versions, seed release, exact selected programs, plan keys, program counts, response counts, viewport, cache policy, warm-up count, worker count, parallel-job state, and benchmark readiness definition for every source run.
2. Retrieve and inspect the baseline and post-PR#10 raw `react-poc-visual-performance` artifacts. Compare per-sample catalog navigation/resource API timings, endpoint count/size, API response status and readiness boundaries; do not compare only their medians.
3. On the same isolated PostgreSQL 16 seed and runner, run the unchanged production builds with one warm-up and at least ten measured paired samples for 50/100/500 catalog rows and the exact two-program full-data comparison. Use one Chromium process and viewport 1440×900, alternate app order, disable/clear browser cache consistently, disable retries, and serialize the benchmark job.
4. Capture browser cold navigation versus warm navigation, direct URL versus navigation from an already opened catalog, cold/warm API request spans, HTTP/cache headers, frontend route state, long tasks, layout shift, and response sizes. Reuse the existing runner where it measures these fields; add benchmark-only capture only where necessary.
5. Correlate CI job concurrency and per-endpoint timings with the catalog variance. Use a separate isolated database and report whether fixture setup/search-index construction is inside or outside the timed interval. Do not run against a shared or production DB.
6. Report median and raw samples. With 10 samples, label nearest-rank p95 as an unstable sample estimate, not a production percentile. If CI cannot run 10, record the exact failing infrastructure prerequisite and use the most repeatable available run without claiming the variance is solved.

### Required Interfaces and Contracts

- Do not change product response/readiness criteria to make the sample faster.
- Keep selected external program identities, verified plan identities, exact curriculum row counts and numeric aggregates identical between Vanilla and React samples.
- Treat cross-run medians as comparable only when browser, release, runner resources, navigation state and readiness boundary are equivalent.

### Error Handling and Logging

- Fail a benchmark sample if the requested release/program/plan identity or full-data completeness check fails.
- Keep raw per-sample diagnostics in CI artifacts. Do not log academic source claims, user credentials, or environment secrets.
- Record infrastructure failures distinctly from application/API errors.

### Tests

- Run the existing controlled paired baseline without code changes first.
- Run a separate isolated API endpoint profile with response byte/count totals and request statuses.
- If the catalog variance reproduces, add a regression assertion only when a code cause and stable expected behavior are established; do not encode a CI timing threshold from a noisy sample.

### Acceptance Criteria

- Raw before-change samples exist for Vanilla, React catalog, and React full-data comparison, or an explicit infrastructure limitation is documented.
- The 482→957 ms variation is classified with evidence as code change, measurement noise, environment difference, or readiness-condition difference; multiple causes may be reported.
- Same-release, same-browser conditions are recorded, and no timings are attributed to React render without browser trace evidence.

### Verification

- `npm --prefix apps/web-react-poc run test:benchmark` with `BENCHMARK_ITERATIONS=10` in the isolated PG16 CI environment.
- Inspect uploaded JSON samples and compare the exact source runs/artifacts referenced in the research report.
- Expected result: raw samples pass academic identity/completeness assertions and include environment/method metadata.

## Task 2: Attribute the Comparison Critical Path

### Intent

Measure the comparison dependency graph at HTTP, backend, SQL and browser layers so architecture options can be compared using the actual dominant cost.

### Implementation Steps

1. Trace `loadProgramComparison` from release/catalog reads through exact identity selection, study plans, curriculum pages, taxonomy, admission, final release verification, and rendering; annotate which stages overlap and which wait on earlier values.
2. For each comparison API request, capture URL pattern (keys may be hashed in report), request count, status, response timing, transfer/encoded/decoded bytes, number of records, pagination cursor count, release key, and browser waterfall dependency.
3. In the PG16 CI fixture, profile real API calls using request-scoped SQLAlchemy execution timing/count instrumentation or an isolated test harness. Include connection/transaction setup, repository SQL, SQLAlchemy row mapping, DTO serialization, and total FastAPI request duration separately.
4. Run `EXPLAIN (ANALYZE, BUFFERS)` on representative, read-only queries for `/programs`, study-plan pages and curriculum-item pages against the isolated PG16 seed. Save normalized plans and table/index statistics; do not add indexes based on estimates alone.
5. Record response serialization time and JSON size at the ASGI response boundary. Pair backend spans with browser Resource Timing; explain the residual network/queue gap instead of subtracting incomparable intervals.
6. Attribute each stage's critical-path share and SQL statement count. Specifically verify the statically identified per-row linked-key, provenance, data-gap, and related-entity queries.

### Required Interfaces and Contracts

- Any profiling instrumentation is opt-in for CI/performance tests; normal API output and logs remain unchanged.
- The benchmark API calls use an isolated, immutable release. All SQL profiling statements are read-only and target exact same-release keys.
- Preserve source/provenance fields in response-size counts; report payload reduction only if no required field was removed.

### Error Handling and Logging

- If profiling cannot attach to the API worker or cannot isolate the selected query, fail the profile task rather than presenting static estimates as measured SQL.
- Retain request IDs and route templates, but avoid logging raw source URL/claims or credentials.

### Tests

- Add/update a benchmark-only profile test for query count and timing attribution if no current test can measure it.
- Assert that SQL profile collection does not modify application response contracts or database state.

### Acceptance Criteria

- Dependency graph reflects executable source, with blocking edges versus `Promise.all` overlap clearly labeled.
- For each HTTP stage there is backend time, SQL time/count, serialization/response size, row count and pagination count or a named measurement limitation.
- EXPLAIN evidence is from PostgreSQL 16 and the report distinguishes warm/cold cache states.

### Verification

- Run the API profile against the seeded PG16 CI database and inspect raw SQL/query totals.
- Compare staged HTTP waterfall with backend route spans and browser CPU/long-task data.
- Expected result: no timing claim conflates HTTP duration, server execution, SQL duration, or rendering.

## Phase Risks and Mitigations

- Risk: CI scheduling or shared-host load changes catalog medians. Mitigation: serialize samples, alternate app order, keep raw data, and record runner context.
- Risk: broad API timing hides one expensive row mapper. Mitigation: collect per-route statement count and query-time distribution, not only endpoint totals.
- Risk: the profiling hook changes timing. Mitigation: measure with the profiler both enabled and disabled for a small paired control and keep instrumentation benchmark-only.
