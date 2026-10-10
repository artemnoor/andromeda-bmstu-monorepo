<!-- aif:plan-mode:ultra -->
# AIF Ultra Implementation Plan: Backend-Aware Academic Comparison Performance

Mode: ultra
Branch: `codex/andromeda-backend-performance`
Base: `main` at `6a2da949c098b1198c2c4ccf7a93c641d87716f9`
Created: 2026-10-10

## Original Request

Исследовать оставшиеся узкие места загрузки и сравнения академических программ Andromeda, установить причину нестабильности каталога, сравнить три варианта чтения данных, выбрать оптимизацию только по измерениям, сохранить гарантии release consistency и provenance, проверить до/после на изолированном PostgreSQL 16 и браузере, подготовить отчёт, провести независимый аудит и довести отдельный PR в `main` до зелёного CI и merge, если критерии качества и права это позволяют.

## Settings

- Testing: yes
- Logging: standard; any added profiling is opt-in, benchmark-scoped, and must not expose academic payloads or source claims in normal logs.
- Docs: yes; maintain this plan and create `apps/web-react-poc/BACKEND_PERFORMANCE_RESEARCH.md` from measured evidence.
- Roadmap linkage: none; the repository has no configured roadmap artifact.
- Research context: none; no task-specific active ultra research bundle was selected.

## Requirements Reconciliation

Authority: the user's task defines scope and acceptance; existing API contracts, release publication rules, and academic-data invariants define compatibility and correctness.

| Decision / supported combination | Source path and section | Verification evidence |
|---|---|---|
| Work only from the requested clean `main` baseline; preserve existing user work in the original worktree. | User request: repository and base SHA; original worktree status | Branch and parent SHA recorded in report; original worktree status unchanged |
| No new snapshot/bulk API until matched PG16, SQL, and browser profiles show material benefit over query optimization A. | User request: architecture variants A/B/C, priority order; existing route contracts | Evidence table separates measurements/assumptions and records selected option or NO-GO |
| Keep existing endpoint behavior, provenance, pagination, exact identities, and release checks; no model migration absent EXPLAIN evidence. | `services/api/src/andromeda_api/dependencies/queries.py`; `packages/db/src/andromeda_db/repositories/read_repository.py`; `packages/contracts/src/andromeda_contracts/api/v1/models.py` | Contract tests, SQL query-count tests, release lifecycle and read-only integration tests |
| Release activation during a read must yield one release or a controlled error; never a successful mixed result. | `packages/db/src/andromeda_db/repositories/read_repository.py` (`_ensure_active_release`); `tests/integration/test_postgres_import.py` release tests | PG16 active-pointer-switch regression with exact response keys and independent old-API result |
| API profiler reports request duration, SQL count/time, response bytes/records and browser resource/stage timings; no academic source text is logged. | `.github/workflows/ci.yml` isolated PostgreSQL 16 browser job; `apps/web-react-poc/tests/e2e/paired-visual-performance.spec.ts` | Retained raw JSON artifacts from the same-run before/after/Vanilla experiment |
| Benchmark uses production builds, same PG16 seed/release/programs/Chromium/cache/viewport; at least ten warmed measured repetitions where CI permits. | User request: Benchmark; existing paired benchmark runner and fixture checks | Raw per-sample record includes environment, release/program/plan identity, all readiness and transfer measures; if infrastructure blocks ten, report the exact constraint |
| Preserve the existing Vanilla app and React POC interface and production routing. | User request: constraints; `apps/web/`; `apps/web-react-poc/` | Changed-path audit, Vanilla tests, six-viewport paired screenshots |

## Architecture and Decisions

- The baseline worktree is isolated at the requested `main` SHA. The pre-existing workspace on `feature/andromeda-architecture-v1-1` contains unrelated uncommitted changes and is not the implementation worktree.
- The API dependency already opens a request-scoped, read-only PostgreSQL `REPEATABLE READ` transaction and the repository pins the active release ID for that request. Existing separate HTTP requests do not share a DB transaction; the React client checks response release keys and brackets its load with active-release reads.
- Initial call-graph evidence identifies per-row reads in catalog and curriculum DTO mapping. This is a profiling lead only; runtime impact, cache sensitivity, and whether it explains the 482→957 ms catalog variation must be measured on the same PG16 fixture.
- First evaluate A by removing proven repeated DB lookups while preserving output bytes/semantics. Consider B only if substantial round-trip cost remains after A. Consider C only if B cannot meet a measured need and a complete bounded DTO can preserve all identity, provenance, admissions, and unknown-value semantics without unsupported joins.
- A successful comparison must contain all rows for every selected verified plan. Any size ceiling fails explicitly or reports incompleteness; no silent truncation. Maximum selected programs for a comparison-specific contract is three.
- New database indexes/migrations are out of scope unless PG16 `EXPLAIN (ANALYZE, BUFFERS)` demonstrates a query-plan problem that a query-shape change cannot address.
- Frontend academic selection, admission joins, and rendering logic remain in existing adapters unless the chosen API requires a narrowly defined typed integration. Generated TypeScript contracts must continue to pass `api:check`.

## Phase Index

1. [Phase 1: Baseline and attribution](phase-01-baseline-attribution.md) — Tasks 1–2
2. [Phase 2: Architecture decision and implementation](phase-02-decision-implementation.md) — Tasks 3–4
3. [Phase 3: Correctness and performance verification](phase-03-verification.md) — Tasks 5–6
4. [Phase 4: Independent audit and delivery](phase-04-audit-delivery.md) — Tasks 7–8

## Cross-Phase Dependencies

- Task 2 depends on Task 1 because endpoint, SQL, and browser stages must use the same seeded release and selected identities.
- Task 3 depends on Tasks 1–2; its A/B/C decision records measured costs separately from estimates and may select NO-GO.
- Task 4 depends on Task 3; no endpoint or query rewrite begins before the choice and consistency semantics are written down.
- Task 5 depends on Task 4 and compares output against the existing API from the same immutable release.
- Task 6 depends on Task 5 and runs matched before/after/Vanilla measurements plus regression suites.
- Task 7 independently audits the completed diff and evidence; any P0/P1 finding blocks Task 8 until fixed and rechecked.
- Task 8 depends on all previous tasks and green required PR checks; merge only when GitHub permits and the acceptance criteria hold.

## Tasks

### Phase 1: Baseline and attribution
- [ ] Task 1: Reproduce catalog variance and capture the controlled pre-change baseline ([details](phase-01-baseline-attribution.md#task-1-reproduce-catalog-variance-and-baseline))
- [ ] Task 2: Attribute the comparison dependency graph to HTTP, FastAPI, PostgreSQL, serialization, and browser stages ([details](phase-01-baseline-attribution.md#task-2-attribute-the-comparison-critical-path))

### Phase 2: Architecture decision and implementation
- [ ] Task 3: Compare A/B/C against measured evidence and select the least complex safe option ([details](phase-02-decision-implementation.md#task-3-select-a-safe-read-architecture))
- [ ] Task 4: Implement only the selected optimization and add contract/query regression coverage ([details](phase-02-decision-implementation.md#task-4-implement-the-selected-optimization)) (depends on 1, 2, 3)

### Phase 3: Correctness and performance verification
- [ ] Task 5: Verify academic invariants, release switching, edge behavior, and parity with the existing API ([details](phase-03-verification.md#task-5-verify-academic-correctness-and-parity)) (depends on 4)
- [ ] Task 6: Run ten-sample same-environment before/after/Vanilla browser benchmarks and full tests ([details](phase-03-verification.md#task-6-run-controlled-benchmarks-and-regressions)) (depends on 4, 5)

### Phase 4: Independent audit and delivery
- [ ] Task 7: Obtain independent architecture/performance review and resolve P0/P1 findings ([details](phase-04-audit-delivery.md#task-7-independent-review-and-recheck)) (depends on 4, 5, 6)
- [ ] Task 8: Publish the research report, create PR, wait for CI, fix failures, and merge when eligible ([details](phase-04-audit-delivery.md#task-8-publish-pr-and-deliver)) (depends on 7)

## Commit Plan

- **Commit 1** (after Tasks 1–3): `docs(perf): record backend comparison research and decision`
- **Commit 2** (after Task 4): `perf(api): reduce measured academic read query cost`
- **Commit 3** (after Tasks 5–6): `test(perf): verify release safety and paired comparison gains`
- **Commit 4** (after Tasks 7–8): `docs(perf): finalize independent review and delivery evidence`

## Definition of Done

- Catalog variance is attributed to code, environment, load, cache, or readiness methodology with repeated evidence; if the cause is external noise, the report gives a stable measurement protocol.
- Comparison HTTP dependency graph and FastAPI/SQL/browser costs are measured on the controlled fixture; no claim relies on navigation total alone.
- A/B/C table distinguishes observed values from architectural estimates, and the selected design follows the evidence.
- Optimization, if justified, preserves identity, immutable release scope, provenance, completeness, null/unknown/zero, admission joins, read-only permissions, API compatibility, and existing UI.
- Existing API parity is checked independently on the same immutable release; every difference has an explanation and regression.
- Matched benchmark raw samples and applicable test artifacts are retained; small-sample p95 is labeled as a sample maximum/unstable estimate.
- React typecheck/lint/Vitest/OpenAPI drift/build, Chromium/Firefox/WebKit Playwright, PG16 API/lifecycle/read-only tests, Vanilla regression, visual comparisons, and CI are reported exactly as run.
- Independent review is complete. P0/P1 findings are fixed and rechecked. A PR is created; merge occurs only if quality checks pass and GitHub permissions allow it.
- Final report states GO, CONDITIONAL GO, or NO-GO without changing readiness criteria or hiding limitations.
