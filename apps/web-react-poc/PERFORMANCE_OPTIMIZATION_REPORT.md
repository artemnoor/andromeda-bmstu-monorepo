# React POC Performance Optimization Report

Date: 2026-10-10  
Scope: `apps/web-react-poc/` and one narrowly scoped FastAPI filter required to avoid transferring unrelated requirements. The existing Vanilla frontend, production routing, database schema, and other pages were not changed.

## Summary

The highest measured cost was the comparison route's data critical path. Starting selected-program admission reads as soon as catalog identity is known lets them overlap study-plan and curriculum reads. A release- and direction-bound admission cache now deduplicates shared and in-flight reads, and the requirements API can return only the selected direction's records. The full-data comparison median improved from **3,567.3 ms to 3,131.0 ms** (12.2%); API payload fell 17.6%. The requested 1,800 ms target was not reached.

A catalog search index reduced the 500-row repeated-filter action from 200.9 ms to 165.8 ms versus the immediately preceding build (17.5% median, 35.5% p95 improvement). It did not improve the 50- or 100-row action. That trade-off is retained for the explicitly measured large-catalog case; its eager construction cost has not been isolated.

No UI/CSS, dependency, or design changes were made. The final visual artifact has byte-identical shared screenshots and unchanged pixel-diff metric files compared with the baseline artifacts.

## 1. Initial profiling and method

The original task figures (2,472 ms React comparison, 21 React requests, 141 KB JS) were treated as a hypothesis. They could not be reproduced with a controlled, isolated PostgreSQL 16 fixture: the old local measurement did not provide the same release, selected verified plans, response-completeness gate, or full-data-ready definition. The controlled baseline was captured from production builds before runtime optimization at commit `66957fe09a977f18fa5e61de0ca9e50490220782`, CI run [38031277771](https://github.com/artemnoor/andromeda-bmstu-monorepo/actions/runs/38031277771).

Before and after runs used Chromium, a 1440×900 viewport at device scale factor 1, reduced motion, one warm-up per app/scenario, five measured samples, the same PostgreSQL 16 seeded release, and disabled/cleared browser HTTP cache on each navigation. p95 is nearest-rank over five samples and therefore is the sample maximum, not a reliable production percentile. API bytes and JavaScript bytes are Resource Timing transfer measurements. The paired [final artifact](https://github.com/artemnoor/andromeda-bmstu-monorepo/actions/runs/38033053299/artifacts/11662753917) contains raw samples, stage timings, screenshots, and traces for code SHA `a74c43c24a9a8b38524fc106b3b65d6c0fc105a3`.

The comparison fixture was release `bmstu-2026:72af1a16109bbcb8adf3060249636c49ed69cd2d635aac9bd762e12e7b213fbe:bmstu-2026-bundle-v5`, programs `13.03.02-02` and `15.03.06/М9`, with one verified plan per program. Every one of the ten Vanilla/React comparison samples loaded both plans and exactly 131 items per plan; independently checked hours were `[34252, 34144]` and credits `[432, 432]`. No sample with an incomplete or mixed release was retained.

The controlled baseline's stage marks and source dependency graph showed the comparison stages serialized: catalog → selected plans → curriculum items → taxonomy/model → admission → final active-release check. The API-driven catalog load, curriculum items, and admission reads dominated; `buildCurriculumComparison` was about 2 ms. A separate exploratory React Profiler trace used bundle v4 and was not part of the controlled before/after comparison. The paired profiling therefore supported I/O scheduling and payload reduction, not broad React memoization.

## 2. Changes and measured effects

| Change | Reason | Measured effect | Complexity / guarantee |
|---|---|---|---|
| Start admission reads immediately after selected programs are resolved | Admission was fetched after curriculum model construction and sat on the route's serial critical path | Final comparison full-data readiness improved 436.3 ms (12.2%) against the controlled React baseline | Keeps the final active-release check and validates every response against the pinned release |
| Re-key admission caches by release, campaign, direction, and program; deduplicate concurrent callers; remove failed or unobserved aborted entries | Previous cache keys could outlive an active-release change and did not coordinate cancellation between callers | No extra requests for shared campaign/direction groups; entries from one release cannot satisfy another release | Small local cache only; no new package or competing query cache |
| Add optional `direction_key` to `GET /api/v1/requirements` and request requirements for selected directions | Full requirements collections transferred facts unrelated to the selected programs | API transfer fell 421,535 B (17.6%); this adds one scoped requirements call for the fixture's second distinct direction (29 vs 28 total calls) | Unfiltered endpoint behavior is preserved; exact selection is still checked client-side and release identity is still checked |
| Build a normalized search index once per immutable catalog snapshot | Filtering rebuilt and normalized each row's searchable fields on every query change | For 500 rows, action median/p95 went 200.9/264.5 ms → 165.8/170.6 ms versus the pre-index build. For 50 and 100 rows it was 47.7 and 57.1 ms, slightly slower than pre-index | Index uses the same fields, trim, Russian lowercasing, substring, and filter semantics; tests assert independently specified expected results for indexed and unindexed paths across field, Cyrillic, whitespace, and boundary cases |
| Add opt-in stage, resource, long-task, and React Profiler measurement | The old total-only result could not attribute time | Reports catalog, selection, plans, items, taxonomy, model, admission, final guard, resources, and aggregate React commits | Instrumentation is enabled only by QA test setup; not a normal product behavior or new dependency |

## 3. API loading and release safety

Before: `loadCatalog` → resolve stored selections → load plans → load items → fetch taxonomy → build comparison → fetch admission → verify collections and active release.

After: `loadCatalog` → resolve exact external identities → start admission, then load plans → verified plans → items → taxonomy → model **in parallel with admission** → join and validate admission → verify all collection release keys → read and verify active release once more.

The selected catalog programs still come from a complete release-verified catalog snapshot. No unbound detail endpoint or stored stale facts are used to bypass it. Cached catalog data is reused only for the same release and the read remains bracketed by active-release checks. Admission cache entries include the expected release key; every server response is checked against it. If activation changes during loading, the final check rejects the comparison rather than showing a mixed release. In-flight cache consumers share requests, failed requests are evicted, and a canceled caller does not abort a request still used by another caller.

The additional requirements request is an intentional trade-off: two selected programs are in two directions, so each reads only its own requirements instead of transferring the entire campaign collection. Total request count did not fall; transfer size did. All measured API responses were HTTP 200.

## 4. React rendering and large data

At final comparison load, the route-level React Profiler recorded one mount (3.6 ms actual / 1.4 ms base) and one update (30.2 / 22.0 ms). This is an aggregate route subtree, not component-level attribution, and it is a single diagnostic profile rather than a before/after repeated sample. The Chromium trace had 2,246 events; longest recorded `FunctionCall` was 32.4 ms, `EventDispatch` 20.8 ms, `UpdateLayoutTree` 16.0 ms, and `Layout` 15.0 ms. Chromium's `PerformanceObserver` reported zero long tasks in the paired samples. These observations do not justify a broader component rewrite or table virtualization.

Large synthetic curriculum/table scenarios at 100, 500, and 1,000 rows remain covered by Playwright. The current route mounts the matrix before disclosure; scale-test disclosure timing measures native `<details>` expansion/layout, not deferred row construction. Component-level profiling and a repeated filter-input profile are future evidence gaps, not claimed optimizations.

## 5. Bundle and transfer analysis

No dependencies were added. Browser-measured transferred JavaScript on the comparison route was 141,447 B at baseline and 142,095 B after (+648 B, +0.46%); the same-run Vanilla value was 59,603 B. The final React route loaded six script resources. Final route transfer was 2,516,194 B total versus 2,937,138 B at baseline (−14.3%). The final Vite build emitted 480.70 kB of JS chunks (153.22 kB according to Vite's gzip estimate): `entry.client` 218.97/68.41 kB, `jsx-runtime` 130.77/44.16 kB, `compare` 54.65/15.56 kB, `admission-model` 37.88/12.79 kB, `programs` 20.06/6.16 kB, `home` 17.24/5.45 kB, and `root` 1.13/0.69 kB. Route assets are split, but the experiment did not preserve a separate raw `dist` bundle inventory for the baseline; transfer figures must not be described as raw bundle size or gzip bundle size.

## 6. Benchmark results

Values are median / p95 (ms) across five measured samples. “React before” is the controlled baseline run; “React after” is code SHA `a74c43c`. Catalog sizes are synthetic clones for search/load stress only; they carry no asserted admission or curriculum facts.

| Scenario / metric | Vanilla (final run) | React before | React after |
|---|---:|---:|---:|
| Home ready | 188.7 / 208.4 | 212.6 / 226.4 | 230.4 / 255.8 |
| Catalog 100 ready | 577.9 / 997.3 | 482.4 / 493.9 | 957.3 / 973.9 |
| Catalog 100 filter action | 54.8 / 63.2 | 50.6 / 56.5 | 57.1 / 58.2 |
| Catalog 500 ready | 1,604.6 / 1,621.5 | 1,169.7 / 1,678.5 | 1,201.8 / 1,248.1 |
| Catalog 500 filter action | 160.5 / 186.5 | 161.7 / 184.2 | 165.8 / 170.6 |
| Comparison first visible content | 3,101.5 / 3,195.6 | 3,525.2 / 3,583.0 | 3,081.5 / 3,094.1 |
| Comparison full-data ready | 3,471.9 / 3,484.6 | 3,567.3 / 3,654.6 | **3,131.0 / 3,146.8** |
| Comparison API requests | 21 | 28 | 29 |
| Comparison API transfer | 2,301,149 B | 2,389,602 B | **1,968,067 B** |
| Comparison JavaScript transfer | 59,603 B | 141,447 B | 142,095 B |
| Comparison all-resource transfer | 2,885,302 B | 2,937,138 B | **2,516,194 B** |

The comparison target of 1,800 ms was not reached: final median is 1,331 ms above it. Final React full-data readiness is 12.2% below the controlled baseline median and 340.9 ms faster than the same-run Vanilla control. The loader's final median was 2,572.9 ms / p95 2,677.4 ms; its catalog stage was 1,092.7 / 1,190.5 ms, selected curriculum item stage 1,385.2 / 1,411.4 ms, admission stage 1,397.3 / 1,469.1 ms (overlapping the curriculum path), and final active-release check 6.6 / 7.3 ms. The large verified payload and round trips, particularly the full catalog and two 131-item curricula, remain on the critical path. A substantial further reduction likely requires a release-bound bulk-read API or a different server pagination contract, outside this React-only optimization; removing release checks or using an unbound detail API would be unsafe.

Catalog readiness varied substantially between CI runs. For 100 synthetic programs, the controlled baseline-to-final median moved from 482.4 to 957.3 ms; however, the immediately pre-index candidate measured 968.5 ms, so the index itself was effectively flat at 957.3 ms. The data does not establish a cause for the cross-run difference, so catalog readiness remains an unresolved measurement risk rather than a claimed non-regression. In the same final run React was faster than Vanilla for the 500-row catalog's initial readiness, but slower for 50 and 100 rows. The search index did not produce a measurable readiness win; at 500 rows it narrowed repeated filter latency to within 5.3 ms median of the same-run Vanilla control. This is a targeted large-list interaction win, not evidence that React's initial catalog load is faster.

## 7. Visual comparison

The paired suite compares the original and React home, catalog, and comparison at six viewport sizes: 1920×1080, 1440×900, 1280×800, 768×1024, 390×844, and 375×667. Across baseline, pre-index, and final artifacts, all 222 common PNGs had identical SHA-256 hashes and all 25/25 common pixel-diff metric JSON files were identical. The measured Vanilla-to-React pixel-diff mean was 1.8264%, maximum 8.5%; the final optimization did not change those values. These figures indicate no visual regression from this work, not exact pixel equality between the two different implementations.

## 8. Tests and verification

- React Vitest: **68 passed**, 10 test files.
- TypeScript strict typecheck, ESLint, generated OpenAPI drift check, and production build: passed locally and in the React POC CI job.
- React Playwright: **52 passed, 2 skipped** across Chromium, Firefox, and WebKit.
- Existing Vanilla Playwright: **232 passed, 38 skipped** across Chromium, Firefox, and WebKit.
- Paired visual/performance Playwright: **26 passed**; opt-in React Profiler/Chromium trace: **1 passed**.
- Local Python full suite before final frontend-only catalog-index test: **100 passed, 23 skipped, 1 warning**. Skips were due to this host's PostgreSQL 17 instead of the API-required PostgreSQL 16 and unavailable local Directus; this is not reported as a PG16 pass.
- Exact-SHA CI run [38033053299](https://github.com/artemnoor/andromeda-bmstu-monorepo/actions/runs/38033053299) completed successfully on `a74c43c`: repository-wide full suite **122 passed, 1 skipped, 1 warning**; API/ingestion/publication **85 passed, 1 warning**; PostgreSQL migration/lifecycle **23 passed, 1 warning**, followed by a successful isolated backup/restore check; domain/API contract tests **41 passed, 1 warning**; Directus metadata/permissions **7 passed, 1 skipped** (the optional Directus HTTP smoke requires a local URL and admin credentials); Ruff passed. React and Vanilla browser plus React POC jobs also passed.

No test retries are configured for the React browser suite. Performance samples are rejected unless release identity, verified plan identity, item counts, and independently computed totals match.

## 9. Architecture review and remaining limits

Independent review found no P0/P1 issues in the release-bound cache, comparison overlap, or search-index semantics. The search index preserves the prior matching fields and normalization; regression tests cover direction-only and department-code cases, Cyrillic, whitespace, no match, and cross-field false matches. No extra dependency, global state manager, or second data cache owner was introduced.

Known limits:

- The 1,800 ms comparison goal is unmet; the safe client-side overlap gives a measured 12.2% improvement and a smaller API payload, while full-catalog and curriculum round trips still dominate.
- The search index only demonstrates benefit at 500 synthetic catalog rows and adds a small eager index construction that is not separately timed.
- React's transferred JavaScript remains 2.38× Vanilla on the comparison route; this task did not attempt a framework or design change.
- The React Profiler is aggregate and single-run; no per-component render claim is made.
- Raw before/after minified/gzip bundle inventories were not recorded; Resource Timing bytes are reported instead.

## 10. AI Factory and GitHub

AIF Ultra produced the execution plan under `.ai-factory/plans/codex-react-performance-optimization/`. Five subagents were used for independent profiling, API/cache review, React rendering review, release-safety review, and final diff review. Their findings were integrated; the final independent review found no unresolved P0/P1 issues. The report and expected-result search tests were updated based on its findings.

- PR: [#10](https://github.com/artemnoor/andromeda-bmstu-monorepo/pull/10)
- Implementation SHA measured: `a74c43c24a9a8b38524fc106b3b65d6c0fc105a3`
- Implementation CI run: [38033053299](https://github.com/artemnoor/andromeda-bmstu-monorepo/actions/runs/38033053299)
- Report and regression-test commit: `23af8db7309c6c7794de9ddbd1fd016f171b3dd4`; its PR-head check is [38035377127](https://github.com/artemnoor/andromeda-bmstu-monorepo/actions/runs/38035377127). Check the linked PR for current merge status.
