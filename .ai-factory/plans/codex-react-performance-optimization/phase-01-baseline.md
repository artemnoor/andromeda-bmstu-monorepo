# Phase 1: Baseline and attribution

Plan: [index.md](index.md)
Tasks: 1–2
Depends on: none

## Objective

Measure the unoptimized three-screen POC in production mode, establish comparable paired Vanilla/React results, and add opt-in diagnostics that identify where comparison time and API traffic are spent.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|---|---|---|
| `apps/web-react-poc/tests/e2e/paired-visual-performance.spec.ts` | `visitForBenchmark`, `summarizeMetrics`, benchmark test | Existing paired production benchmark, 1440×900 Chromium, five iterations by default, resource bytes, request counts, long tasks, CLS |
| `apps/web-react-poc/scripts/run-paired-qa.mjs` | `benchmark` mode | Builds React and starts the paired Playwright runner |
| `.github/workflows/ci.yml` | `web-browser-check` | Supplies disposable PostgreSQL 16, migrations, release import, read-only API, Vanilla and React builds; currently overrides benchmark count to 3 |
| `apps/web-react-poc/src/features/comparison/api.ts` | `loadProgramComparison` | Catalog → plans → items → taxonomy/model → admission → final release currently has serial dependencies |
| `apps/web-react-poc/src/shared/api/client.ts` | `collectPages`, `loadCatalog`, `assertSingleRelease` | Pagination and active-release consistency invariants must not be bypassed |

## Files to Change

| Path | Action | Required change |
|---|---|---|
| `apps/web-react-poc/tests/e2e/paired-visual-performance.spec.ts` | modify | Add test-only request timing/size diagnostics and collect opt-in comparison stage marks while retaining current readiness definition and raw samples |
| `apps/web-react-poc/app/routes/compare.tsx` | modify only if needed | Provide an explicit diagnostic opt-in to the comparison loader; normal navigation must not emit performance marks or show UI |
| `apps/web-react-poc/src/features/comparison/api.ts` | modify only if needed | Mark comparison stages only when the diagnostic option is explicitly enabled |
| `apps/web-react-poc/tests/api/` | add or modify | Verify instrumentation is disabled by default and does not alter result/error contracts |
| `.github/workflows/ci.yml` | modify | Set paired benchmark iterations to at least 5 for the task baseline and retain artifact uploads |
| `.ai-factory/plans/codex-react-performance-optimization/index.md` | modify | Mark Task 1 and Task 2 only after their evidence is captured |

## Task 1: Reproduce the baseline

### Intent

Capture an unchanged-code baseline before any runtime optimization. The prior report is a reference, not a replacement for this run.

### Implementation Steps

1. Confirm the clean branch base and dependency lock hashes; build `apps/web` and `apps/web-react-poc` from locked dependencies.
2. Use only the isolated `academic_data_test` database, migration chain, and `data/bmstu-2026` release. Do not connect the local benchmark to an unknown or production DB.
3. The existing local PostgreSQL 17 cannot run the app because `andromeda_db` enforces PostgreSQL 16, and Docker Desktop is unavailable. Obtain baseline through the repository's PR browser job using its disposable PostgreSQL 16 service; do not weaken the version guard.
4. Use five measured iterations minimum after one warmup per app/scenario, same Chromium, 1440×900, DPR 1, reduced motion, HTTP cache disabled/cleared, same two live selected programs and same release.
5. Save artifact JSON and record medians, raw observations, and nearest-rank p95 as a limited-sample estimate.

### Required Interfaces and Contracts

- Keep existing `readyMs` definition: browser navigation start to the same screen-specific readiness condition.
- Benchmark paired Vanilla and React production builds against one API process and one disposable database fixture.
- Record release key and selected verified plan keys with the report.

### Error Handling and Logging

- Fail the baseline if the API is not healthy, the chosen fixture lacks two verified plans, any unexpected API request fails, or the selected release differs during a measurement.
- Do not silently omit scenarios or switch to synthetic data for the live comparison.

### Tests

- Run `npm --prefix apps/web test` and `npm --prefix apps/web run build`.
- Run `npm --prefix apps/web-react-poc run typecheck`, `lint`, `test`, `build`, and the paired benchmark at 5 iterations.
- Confirm attached samples contain both implementations and identical release/selection metadata.

### Acceptance Criteria

- The current production baseline is measured before implementation changes.
- The experiment records at least five measured samples per app/scenario and includes comparison, catalog sizes 50/100/500, request count, transferred bytes, JavaScript bytes, long tasks, CLS, median, and p95 estimate.
- Exact local/CI PostgreSQL version and any local access constraint are recorded.

### Verification

- `npm --prefix apps/web-react-poc run test:benchmark`
- Expected result: paired benchmark artifact with valid live fixture and >=5 samples, or a precise environment blocker with baseline retained from verified matching CI.

## Task 2: Add opt-in performance attribution

### Intent

Identify request waterfalls and CPU/model stage costs so later edits target measured work. Measurement-only code must not change normal data loading or visual behavior.

### Implementation Steps

1. Extend Playwright diagnostics to associate each API request with start/end timing, response status, and transferred/encoded response bytes using Resource Timing and Playwright request/response events.
2. Add opt-in User Timing marks for `catalog`, `selection`, `plans`, `items`, `taxonomy`, `curriculum-model`, `admission`, and `final-release` within `loadProgramComparison`; enable only when the benchmark explicitly requests it.
3. Record stage measures and identify any overlapping stages, ensuring the report distinguishes stage duration from wall-clock readiness.
4. For React render attribution, collect a dedicated Chromium devtools trace or a targeted React Profiler run separate from production readiness measurements. Do not interpret profiling-mode timings as production benchmark values.
5. Inspect production build output and route asset loading. Use existing Vite output and lockfile metadata; add no analyzer dependency unless current tools cannot attribute a material initial chunk.

### Required Interfaces and Contracts

- Diagnostic data is optional, deterministic, and never changes API response parsing, retries, selection, or release checks.
- Do not log academic payload content; report only URL path, status, duration, byte counts, stage names, and release identifier already disclosed in the benchmark fixture.

### Error Handling and Logging

- Failed requests still fail the comparison exactly as before. Instrumentation must tolerate missing Resource Timing entries and browser engines lacking optional performance APIs.
- Diagnostic mode must not throw if measurement APIs are absent.

### Tests

- Add tests proving diagnostic mode records expected stages and normal mode preserves existing output/behavior.
- Run paired Chromium baseline both with and without diagnostics; disclose any measurable instrumentation overhead.

### Acceptance Criteria

- Report includes per-stage duration, API request timing/bytes, route bundle sizes, and at least one CPU/render profile tied to an identified comparison scenario.
- Measurement diagnostics are off on default user navigation.
- Baseline bottlenecks are supported by measurements, not inferred from request count alone.

### Verification

- React unit/type/lint/build checks plus paired benchmark and focused profiler run.
- Expected result: same selected program, release key, visible values, and request outcomes in normal and diagnostic modes.

## Phase Risks and Mitigations

- Risk: the local PG17 service is mistaken for a supported test DB. Mitigation: use a dedicated CI PostgreSQL 16 fixture and leave the version guard untouched.
- Risk: diagnostics add benchmark overhead. Mitigation: keep them opt-in, compare with diagnostics off, and use the existing fixed production readiness benchmark for before/after claims.
- Risk: CI currently measures only three repetitions. Mitigation: raise only the paired benchmark iteration count to at least five and retain raw samples.

## Phase Completion Checklist

- Baseline measurements and stage/request attribution are captured before runtime optimization.
- Every diagnostic addition is opt-in and regression-tested.
- Task checkboxes are updated only in the plan index.
