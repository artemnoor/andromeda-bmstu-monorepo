<!-- aif:plan-mode:ultra -->
# AIF Ultra Implementation Plan: React Performance Optimization

Mode: ultra
Branch: `codex/react-performance-optimization`
Base: `main` at `d6117906117a6fe92cbe748fc06d8b2e36bd4d89`
Created: 2026-10-10

## Original Request

Optimize only the existing three-screen React POC in `apps/web-react-poc/`. Reproduce and profile the current production-build baseline, prioritize comparison readiness and API efficiency, apply measured safe optimizations without changing design, product behavior, backend architecture, the Vanilla frontend, or academic-release guarantees, verify regressions, document measurements, independently review, and deliver through a green GitHub PR.

## Settings

- Testing: yes
- Logging: standard; profiling diagnostics are opt-in and limited to benchmark runs.
- Docs: yes; update the requested performance report and this plan with verified evidence.
- Roadmap linkage: none; no roadmap artifact is configured.
- Research context: none; no task-specific active ultra research bundle was found.

## Requirements Reconciliation

Authority: the user's performance-optimization request defines scope; existing contracts and source behavior define compatibility and data guarantees.

| Decision / supported combination | Source path and section | Verification evidence |
|---|---|---|
| Optimize only the isolated React home, catalog, and comparison; preserve `apps/web/` and production routing. | User request: “ограничения задачи”, “сохранить оригинальный frontend” | Changed-file review; existing Vanilla regression job |
| Release identity and verified-plan selection remain fail-closed, including a release activation during a comparison load. | `apps/web-react-poc/src/shared/api/client.ts` (`loadCatalog`, `assertSingleRelease`); `src/features/comparison/api.ts` (`loadProgramComparison`) | Unit and browser race regressions; live API comparison checks |
| Benchmark equivalent production builds, browser, viewport, selected programs, cache policy, and fixture release with at least five measured samples after warm-up. | User request: “Benchmark — до и после”; `tests/e2e/paired-visual-performance.spec.ts` | Attached paired benchmark JSON with raw samples, median, and small-sample p95 estimate |
| Do not add a second cache owner or dependency unless measurements demonstrate need. | Existing route-loader architecture in `README.md`; user cache requirements | Diff review and API request counts; cache-specific tests if introduced |
| If local PostgreSQL 16 is unavailable, use the repository's isolated PostgreSQL 16 CI service and report the local environment limit precisely. | `infra/database/README.md`; `.github/workflows/ci.yml` browser job | PR CI logs and uploaded benchmark artifact |

## Architecture and Decisions

- Keep the comparison's pre/post active-release checks and each paginated collection's release validation.
- First investigate overlap among catalog, selected plans/items, taxonomy, and admission reads. Admission can only begin after selected program identities are resolved; any parallel work must still reject errors and await a final release check.
- Do not replace paginated catalog resolution with detail routes unless an API response is explicitly bound to a release; the current detail response does not carry the page release identity.
- Profile model and render work before adding memoization, deferred rendering, or virtualization. Keep benchmark-only instrumentation outside normal product behavior.
- Keep changes inside `apps/web-react-poc/`, its report, and the task plan. Do not alter backend, Vanilla source, schema, dependencies, or production routing without evidence and a narrowly scoped reason.
- The currently installed local PostgreSQL service is v17 and the API enforces v16. Docker Desktop is unavailable in this session. Use isolated PG16 CI for API-backed before/after measurement unless local PG16 becomes available.

## Phase Index

1. [Phase 1: Baseline and attribution](phase-01-baseline.md) — Tasks 1–2
2. [Phase 2: Evidence-based optimization](phase-02-optimization.md) — Tasks 3–4
3. [Phase 3: Regression, report, and delivery](phase-03-verification-delivery.md) — Tasks 5–6

## Cross-Phase Dependencies

- Task 2 depends on Task 1: stage and request attribution must describe the unchanged React implementation.
- Tasks 3–4 depend on the baseline and profiling evidence from Tasks 1–2; avoid speculative refactors.
- Task 5 depends on all implementation tasks and verifies the release-switch and user-visible regressions.
- Task 6 depends on Task 5 and the independent review; publish and merge only with green required CI.

## Tasks

### Phase 1: Baseline and attribution
- [ ] Task 1: Reproduce paired production baseline against one isolated seeded release ([details](phase-01-baseline.md#task-1-reproduce-the-baseline))
- [ ] Task 2: Attribute comparison network and CPU/render stages without product-default overhead ([details](phase-01-baseline.md#task-2-add-opt-in-performance-attribution))

### Phase 2: Evidence-based optimization
- [ ] Task 3: Reduce comparison critical-path latency while preserving every release guard ([details](phase-02-optimization.md#task-3-overlap-independent-comparison-reads))
- [ ] Task 4: Optimize only model/render/catalog hot paths confirmed by profiling ([details](phase-02-optimization.md#task-4-optimize-confirmed-rendering-or-search-hot-paths))

### Phase 3: Regression, report, and delivery
- [ ] Task 5: Repeat paired benchmarks and run complete React, browser, and backend regressions ([details](phase-03-verification-delivery.md#task-5-prove-performance-and-regression-results))
- [ ] Task 6: Complete independent review, publish PR, and merge after required CI succeeds ([details](phase-03-verification-delivery.md#task-6-review-and-deliver))

## Commit Plan

- **Commit 1** (after Tasks 1–2): `test(web-react-poc): capture comparison performance baseline`
- **Commit 2** (after Tasks 3–4): `perf(web-react-poc): reduce comparison critical path`
- **Commit 3** (after Task 5): `docs(web-react-poc): record optimization evidence`

## Definition of Done

- Before/after results use the same production-build harness, API seed/release, browser conditions, selected programs, and at least five measured repeats.
- Comparison readiness improves measurably, or measured evidence explains why the stated target cannot safely be met; catalog and visual behavior do not regress.
- Release consistency, verified curriculum identity, and unknown-versus-zero semantics remain covered and pass.
- TypeScript, lint, Vitest, API drift, production build, three-browser Playwright, PostgreSQL-backed backend regression, paired visual/performance checks, and required GitHub CI pass.
- The requested report records actual sample statistics, environment/version constraints, independent review, PR, CI, and merge SHA. No unverified check is described as passing.
