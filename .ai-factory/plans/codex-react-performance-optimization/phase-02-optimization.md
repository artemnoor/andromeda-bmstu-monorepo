# Phase 2: Evidence-based optimization

Plan: [index.md](index.md)
Tasks: 3–4
Depends on: Phase 1 / Tasks 1–2

## Objective

Reduce comparison critical-path latency and any measured CPU/render hotspots with the smallest changes that preserve current browser behavior, release validation, and academic semantics.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|---|---|---|
| `apps/web-react-poc/src/features/comparison/api.ts` | `loadProgramComparison` | Selected program keys are resolved from the full catalog; admissions are currently awaited after curriculum construction |
| `apps/web-react-poc/src/features/catalog/admission-api.ts` | `getProgramAdmission`, `campaignData`, `directionData` | Per-program admission operations already use in-flight promise caches and parallel sub-collections |
| `apps/web-react-poc/src/features/comparison/model.ts` | `buildMatrixRows`, `buildCurriculumComparison` | Matrix grouping/sorting and per-item normalization are candidate CPU costs; profile before editing |
| `apps/web-react-poc/app/routes/compare.tsx` | `AdmissionComparison`, `WorkloadChart`, `CategoryComparison`, `CurriculumMatrix` | Expensive render/filter components need attribution before memoization |
| `apps/web-react-poc/src/features/catalog/model.ts` | `filterPrograms` | Per-keystroke normalization can scale with 500+ rows; preserve locale-aware Russian search |

## Files to Change

| Path | Action | Required change |
|---|---|---|
| `apps/web-react-poc/src/features/comparison/api.ts` | modify | Start independent admission reads after selected program resolution, overlap with plans/items/taxonomy, await all required results before final release check; retain failure and unavailable semantics |
| `apps/web-react-poc/tests/api/` | add or modify | Test overlap, error propagation, and release switch during an in-flight comparison |
| `apps/web-react-poc/tests/e2e/comparison-live.spec.ts` | modify | Exercise a controlled active-release switch during comparison and assert fail-closed state/no mixed chart or matrix |
| `apps/web-react-poc/src/features/comparison/model.ts` | modify only if profiling proves material | Reduce repeated comparison/group/sort operations without changing plan identity, taxonomy or metric semantics |
| `apps/web-react-poc/src/features/catalog/model.ts` | modify only if profiling proves material | Pre-normalize search data/index per immutable snapshot if 500-row filter profile justifies it |
| `apps/web-react-poc/app/routes/compare.tsx` and nearby feature files | modify only if profiling proves material | Isolate or memoize confirmed hot render/filter paths; keep state ownership and original layout unchanged |
| `apps/web-react-poc/tests/unit/` | add or modify | Prove equivalence for any changed pure transform or filtering behavior |
| `.ai-factory/plans/codex-react-performance-optimization/index.md` | modify | Mark Tasks 3–4 only after benchmark and regression evidence |

## Task 3: Overlap independent comparison reads

### Intent

Remove avoidable serial waiting without reducing request validation or altering which facts are included.

### Implementation Steps

1. Once selected programs are resolved from the release-verified catalog, create the required per-program admission promise alongside the plan-list promises.
2. Allow existing per-plan item reads and taxonomy resolution to proceed while admissions are loading; do not make chart/model construction depend on admission completion.
3. Await admission results before returning data; preserve `Promise.allSettled` behavior so non-release admission failures remain per-program unavailable and `AcademicReleaseMismatchError` remains fatal.
4. Keep final assertions over plans/items and the final active-release check after all required data has completed.
5. Do not introduce catalog cache or detail lookup unless profiling proves this is necessary and a release-bound API contract can be demonstrated. Do not add TanStack Query or a second cache owner.
6. Add deterministic tests using deferred promises to prove plan/admission overlap, unchanged data association, and fail-closed behavior when active release changes during any concurrent branch.

### Required Interfaces and Contracts

- `loadProgramComparison(selectedKeys, signal?)` keeps its return type and unavailable-data semantics.
- Selected key resolution preserves unique-code aliases and duplicate-key elimination.
- Each plan remains bound to the exact selected program key; only the unique latest verified plan contributes items.
- `assertSingleRelease` remains authoritative for every release-bound collection.

### Error Handling and Logging

- A stale release rejects the whole comparison and must never return partial ready data.
- Existing abort behavior remains unchanged; cached shared admission requests are not canceled unsafely.
- Per-program non-release admission errors remain unavailable, not fabricated empty/zero facts.

### Tests

- API unit test: deferred admission and plan responses both begin before either is resolved.
- API unit test: final active release A→B rejects with `AcademicReleaseMismatchError`.
- API unit test: mismatch in plan/item/admission response remains fatal.
- E2E: switching the active-release response during loading shows reload recovery and no chart/table rendered.
- Existing live one-/two-program E2E continues to verify plan keys, category arithmetic, matrix columns and admission data.

### Acceptance Criteria

- API request count remains unchanged unless a separate measured and safe reuse opportunity is verified.
- Comparison readiness improves by overlapping wall-clock wait; release guard ordering and final check remain intact.
- No stale/mixed result can reach the ready UI.

### Verification

- `npm --prefix apps/web-react-poc test -- --run`
- `npm --prefix apps/web-react-poc run test:e2e -- --project=chromium`
- Paired production benchmark compares exact before/after scenario and release.

## Task 4: Optimize confirmed rendering or search hot paths

### Intent

Reduce measured browser CPU and interaction latency only where the profile identifies user-visible cost.

### Implementation Steps

1. Profile a live comparison plus synthetic 100, 500, and 1000 discipline lists; record model duration, React commit/render duration, DOM node count, and main-thread tasks.
2. Profile catalog filtering on 50, 100, and 500 program data with the same query and viewport used by the existing paired benchmark.
3. Compare each candidate operation to measured load/network wait. If no material user-visible hot path exists, make no rendering/catalog code change and document that result.
4. For a confirmed model hot path, replace repeated flatten/min/sort or lookup work with a single-pass keyed structure while preserving exact grouping and ordering. Use independent equivalence tests.
5. For a confirmed catalog hot path, create one normalized search record per program per immutable catalog snapshot, then filter that record using the same `toLocaleLowerCase("ru-RU")` behavior and existing fields.
6. For React components, apply memoization or route splitting only if a profiler shows an avoidable rerender/initial chunk cost; avoid virtualization unless DOM profiling demonstrates a material problem and visual/keyboard behavior can stay equivalent.
7. Re-run visual comparisons before retaining any rendering change.

### Required Interfaces and Contracts

- No external dependency is added without bundle/profile evidence showing an existing tool cannot address a material problem.
- No academic identity rule, classification fallback, unknown metric, chart arithmetic, table row grouping, or URL/storage behavior changes.
- Search result ordering and case-insensitive Russian behavior stay unchanged.

### Error Handling and Logging

- Synthetic rows are clearly labeled benchmark-only and never enter API integration or academic correctness expectations.
- Missing/unknown measures remain excluded from numeric sums exactly as before.

### Tests

- Property/equivalence tests for model output and normalized search on Cyrillic, case, missing text, and all supported filters.
- Benchmark-only render tests at 100/500/1000 curriculum items; no timing-threshold assertion in ordinary CI.
- Existing Vitest, E2E, and paired visual suites.

### Acceptance Criteria

- Each code optimization maps to an identified measured hotspot and has a regression test.
- No speculative dependencies, broad abstraction layers, or user-facing design changes are introduced.
- Large-table behavior is measured, with a reasoned decision on memoization/virtualization.

### Verification

- `npm --prefix apps/web-react-poc run typecheck`
- `npm --prefix apps/web-react-poc run lint`
- `npm --prefix apps/web-react-poc test`
- `npm --prefix apps/web-react-poc run build`
- Paired 5+ iteration benchmark and six-viewport visual comparison.

## Phase Risks and Mitigations

- Risk: concurrency masks a stale branch until late. Mitigation: preserve per-page release metadata and final active-release bracket; make a mid-load switch a required race test.
- Risk: client memoization pins stale academic data. Mitigation: avoid cross-route caching in this task; any snapshot reuse must be release-keyed, successful-only, and revalidate active release.
- Risk: optimizing model order changes visual or academic meaning. Mitigation: use exact deep equality/equivalence tests plus independent chart arithmetic E2E.

## Phase Completion Checklist

- Comparison and catalog code changes are supported by baseline/profile evidence.
- Release, identity, and unknown-versus-zero regressions pass.
- Tasks 3–4 are checked off only in `index.md` after verified evidence.
