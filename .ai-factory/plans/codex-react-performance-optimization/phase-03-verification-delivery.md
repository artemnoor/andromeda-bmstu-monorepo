# Phase 3: Regression, report, and delivery

Plan: [index.md](index.md)
Tasks: 5–6
Depends on: Phase 1 / Task 1; Phase 2 / Tasks 3–4

## Objective

Prove that the optimized React screens retain original behavior, academic data integrity, visual parity, and API compatibility; publish an evidence-based report and merge only after independent review and CI pass.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|---|---|---|
| `apps/web-react-poc/tests/e2e/paired-visual-performance.spec.ts` | paired viewport and repeated benchmark suites | Existing Vanilla/React visual/performance methodology and artifact output |
| `apps/web-react-poc/tests/e2e/comparison-live.spec.ts` | live single/two-program comparison scenarios | Real FastAPI/PostgreSQL assertions for charts, items, admissions, selection and reload |
| `apps/web-react-poc/tests/api/client.test.ts` | pagination and release guard tests | API envelope, cursor and catalog release-switch regressions |
| `.github/workflows/ci.yml` | React and browser CI jobs | Existing locked dependency, PG16, three-browser, visual and full regression gates |
| `apps/web-react-poc/ARCHITECTURE_POC_REPORT.md` | previous experiment | Preserve prior baseline and migration recommendation; append a separate optimization report |

## Files to Change

| Path | Action | Required change |
|---|---|---|
| `apps/web-react-poc/PERFORMANCE_OPTIMIZATION_REPORT.md` | create | Record baseline, bottleneck attribution, every retained optimization, paired metrics/statistics, compatibility constraints, tests, review, CI/PR/merge evidence |
| `apps/web-react-poc/tests/e2e/paired-visual-performance.spec.ts` | modify only if required | Keep measurement semantics fixed and emit before/after comparable per-sample reports |
| `.github/workflows/ci.yml` | modify only if required | Keep >=5 benchmark samples for the task and existing artifacts/gates |
| Relevant React tests and source files | verify | Apply only fixes required by a demonstrated regression |
| `.ai-factory/plans/codex-react-performance-optimization/index.md` | modify | Record completion and evidence; no premature task completion |

## Task 5: Prove performance and regression results

### Intent

Verify the production behavior and guardrails after the final code edit, not just unit tests or a successful build.

### Implementation Steps

1. Run the same paired before/after production experiment with identical fixture release, program selections, browser, viewport, cache policy, warmups, and >=5 measured repeats.
2. Include median and raw samples; label p95 as nearest-rank estimate from a small sample. Include API request count/bytes, JavaScript bytes, resource counts, readiness, catalog filtering, long tasks, CLS, and stage timings.
3. Compare six viewports (1920×1080, 1440×900, 1280×800, 768×1024, 390×844, 375×667) for the same empty/populated comparison and catalog states; require no layout/design regression beyond established thresholds.
4. Run React TypeScript, ESLint, Vitest, OpenAPI drift, production build, and Playwright Chromium/Firefox/WebKit.
5. Run live API/PostgreSQL PG16 comparison/selection tests, API and ingestion regression jobs, release-switch E2E, and full repository Python/Ruff check through isolated CI.
6. Verify no changed Vanilla/backend/database/production routing files and review final changed paths.
7. Write actual results and limitations in `apps/web-react-poc/PERFORMANCE_OPTIMIZATION_REPORT.md`.

### Required Interfaces and Contracts

- Keep `apps/web/` source and public route configuration untouched.
- Use no production database or shared user data.
- Report only runs tied to the final code commit and accurate CI run links.

### Error Handling and Logging

- Any failed regression or meaningful visual/data discrepancy is fixed before final suite; repeat full suite after the last fix.
- Mark local PG16 unavailable and identify CI PG16 evidence; do not call PG17 a PG16 pass.
- Distinguish performance benchmark skips from passed measurements.

### Tests

- React: typecheck, lint, Vitest, OpenAPI contract drift, production build.
- Browser: React and Vanilla Playwright suites in Chromium, Firefox, WebKit plus paired visual/performance run in Chromium.
- Backend: full Python regression and required PG16/API/ingestion/Directus jobs as selected by CI path filters.
- Visual: all six requested viewports and matching state/data.

### Acceptance Criteria

- Main comparison performance shows an honest measured improvement, ideally median <=1800ms; if not, report blocker and avoid claiming the target was met.
- Catalog readiness is not worse than baseline beyond measured noise; any filter timing change is explained.
- No mismatch between expected/actual release, plan, subject category, hours, credits, quota scope, or null values.
- Required checks are green on the final PR commit.

### Verification

- `npm --prefix apps/web-react-poc run typecheck`
- `npm --prefix apps/web-react-poc run lint`
- `npm --prefix apps/web-react-poc test`
- `npm --prefix apps/web-react-poc run api:check`
- `npm --prefix apps/web-react-poc run build`
- `npm --prefix apps/web-react-poc run test:e2e`
- `npm --prefix apps/web-react-poc run test:paired`
- `ruff check .` and `uv run pytest -q` in locked isolated CI environment
- Expected result: all required suites pass on final commit; artifacts attach raw benchmark/visual evidence.

## Task 6: Review and deliver

### Intent

Obtain independent technical review and merge the verified performance optimization without switching production to React.

### Implementation Steps

1. Ask an agent that did not implement runtime changes to review the full diff and benchmark methodology.
2. Require explicit review of release race coverage, cache semantics, academic correctness, data payload associations, bundle size, visual behavior, errors, complexity and benchmark comparability.
3. Resolve P0/P1 findings and repeat affected tests plus the complete suite after the final implementation change.
4. Commit changes on `codex/react-performance-optimization`, push, and open/update a PR against `main`.
5. Wait for required CI; fix failures without suppressing tests or relaxing release assertions.
6. Merge only after all required PR checks pass and the isolated POC remains separate from the production Vanilla frontend; verify final main SHA and CI.

### Required Interfaces and Contracts

- PR and final report must identify exact commit SHA, Actions run and merge status.
- No change may redirect production URLs or replace `apps/web/`.

### Error Handling and Logging

- If GitHub permission, branch rules, or CI availability prevents merge, preserve the branch/PR and report the exact external blocker without claiming completion.
- Do not claim review, tests, CI or merge that were not independently verified.

### Tests

- Run the complete verification task after every P0/P1 fix.
- Use the independent reviewer to check the final diff after implementation changes, not only earlier commits.

### Acceptance Criteria

- Independent review reports no unresolved P0/P1 issue.
- PR required jobs are green, merge is verified, and report links resolve to actual evidence.
- No source modifications occur outside the approved isolated optimization scope except requested report/plan metadata.

### Verification

- `git diff --check`, final `git status`, remote PR checks, merge SHA, and post-merge main CI.
- Expected result: clean branch/worktree after delivery and evidence tied to final main commit.

## Phase Risks and Mitigations

- Risk: path-aware CI omits required test surfaces. Mitigation: inspect exact job conditions and manually dispatch or request applicable checks where needed.
- Risk: browser timing noise hides an improvement. Mitigation: paired alternation, same dataset/cache policy, raw samples, five-plus repetitions, median and limited p95 estimate.
- Risk: CI artifacts expire. Mitigation: save a concise factual report in the repository and link to the run for detailed artifacts.

## Phase Completion Checklist

- Final tests, paired visual/performance, independent review, PR checks, merge, and main CI evidence are complete.
- Tasks are checked off only after each acceptance criterion is verified.
