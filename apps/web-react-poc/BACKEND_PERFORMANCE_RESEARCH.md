# Andromeda: backend-aware performance research

Date: 2026-10-10  
Repository baseline: `6a2da949c098b1198c2c4ccf7a93c641d87716f9`  
Work branch: `codex/andromeda-backend-performance`

## 1. Summary and decision

**Decision: GO.** Option A materially improves both applications on the fixed PG16 fixture without changing public API contracts, response size, completeness checks, or academic joins. The final candidate run (#143) measured React full-data readiness at 1,081.8 ms median (1,068.7–1,140.1 ms range), 57.3% faster than the 2,535.9 ms baseline. An earlier candidate run (#141) measured 1,018.95 ms; the repeat confirms a comparable gain across separate CI jobs. Vanilla on the candidate API reached full data in a 1,122.15 ms median (721.5–1,240.8 ms range), versus 2,656.4 ms on the baseline API. The 1,800 ms target was met in this controlled warm-server environment. No readiness threshold or academic completeness check changed.

The first controlled read profile found repeated per-row provenance, relationship, and evidence lookups in collection DTO construction. For a 100-row program page, the API executed 906 SQL statements. The selected optimization keeps existing routes and DTOs, and batches those internal reads within the request's already release-scoped transaction. It does not add a new public endpoint, alter the database schema, or change the React data contract. The final benefit must be judged from the paired candidate run, not inferred from fewer SQL statements.

The 1,800 ms comparison target remains a goal, not a condition that justifies hiding data or weakening consistency. The historical catalog median change from about 482 ms to 957 ms has not been reproduced as a stable code regression; the exact old CI environment and readiness conditions are unavailable. The controlled 10-sample run is the basis for the new comparison.

## 2. Catalog variance investigation

The before run used the production builds of Vanilla and React, Chromium, a 1440×900 viewport at device scale factor 1, identical seeded PostgreSQL 16 data, an HTTP browser cache cleared and disabled before each navigation, one warm-up, alternating app order, then ten measured samples. API and PostgreSQL caches were warm after startup/warm-up. It therefore measures a **cold browser / warm API and database** navigation, not cold PostgreSQL behavior.

The ten samples within the controlled baseline were stable. React's synthetic 100-row catalog scenario had a 436 ms median (424–484 ms range); Vanilla had a 467 ms median (455–514 ms range). The synthetic row expansion intercepts the programs response and is only a client search/render stress case. It does not measure actual 100-row database pagination; the live catalog in the seeded release has 152 programs. The release, directions, and departments calls remain live in that scenario.

The earlier PR #10 report measured comparison full-data readiness at 3,567.3 ms before and 3,131.0 ms after its client changes. This run measured the same main-branch React code at 2,535.9 ms median under the controlled ten-sample fixture and explicit identity/total checks—595 ms below PR #10's reported after value. Since the source did not change between those code states, this cross-run difference is further evidence that CI host/cache/API conditions can materially move whole-page measurements. These historical figures have different run conditions and are not used as a causal before/after comparison here; the paired baseline and candidate values on this branch are the valid comparison for this backend change.

The PG16 profile found substantial query amplification in the live catalog path: the baseline `/directions` page performed 328 SQL statements and `/departments` 160. A `/programs?limit=100` page performed 906 statements (292.8 ms app time, 138.8 ms SQLAlchemy cursor time, 454,521 response bytes). Candidate pages use 11, 8, and 15 statements, respectively; the program page retains the same 454,521 response bytes. In paired run #143, the 100-row synthetic catalog scenario had median ready times of 327.15 ms for React (436 ms baseline) and 293.75 ms for Vanilla (466.9 ms baseline). React cumulative app/SQL/query medians changed from 337.27/194.36 ms/496 statements to 72.99/37.60 ms/27; Vanilla changed from 359.71/211.94 ms/488 to 93.61/51.05 ms/19. The synthetic program response is intercepted, but directions/departments and other release data remain live. This is direct evidence that the measured N+1 work materially affected catalog loading and that batching benefits both clients.

The exact historic 482→957 ms cross-run change is still not attributable to a single cause: its raw traces, exact runner load, cache state, and readiness marker are unavailable, and the baseline and candidate were separate hosted CI jobs rather than a before/after run on one physical runner. The paired data show both avoidable backend work and improvement after removing it, but do not prove it was the sole cause of that earlier spread. Search-index construction was not isolated, and the selected synthetic `/programs` response bypasses real backend pagination. We therefore document a supported contributor and a regression control, not a definitive root-cause claim for the old anomaly.

Other possible contributors were assessed against the available instrumentation:

| Source | Evidence and limit |
|---|---|
| Browser cache | Disabled and cleared consistently in the paired run. |
| Warm API/PostgreSQL cache | One warm-up preceded measurements; no cold-server sample was collected. |
| Router and readiness | The catalog uses React Router `clientLoader`; filter-query changes are excluded from revalidation. Comparison is assembled in a client effect, not a route loader. Full-data readiness is gated on release, verified plan identity, full item pages, admission settlement, and exact totals. Catalog readiness is a distinct marker. Direct route entry was measured; the already-open-catalog → comparison transition was not a separate timed scenario. |
| Endpoint/backend time | Opt-in `Server-Timing` reports request/app duration and SQL cursor count/duration; the PG16 artifact supplies per-page profiles. |
| SQL executor time | SQLAlchemy cursor elapsed time includes client/driver overhead and is **not** pure PostgreSQL executor time. `EXPLAIN (ANALYZE, BUFFERS)` is recorded separately for selected read queries. |
| JSON serialization | Included in request/app elapsed time; no separate encoder span is exposed. |
| Browser rendering | Readiness, long tasks, CLS, resource timing, plus a separate React Profiler trace are available. There is no directly comparable isolated Vanilla-vs-React render-duration metric. |
| CI contention | The paired applications run sequentially with alternating order in one job; cross-job host contention cannot be eliminated and the old anomalous runner trace was not retained. |

Conclusion: the historic catalog variance remains an **unresolved exact cross-run attribution**, while repeated per-record backend reads are now a measured and corrected contributor. The regression control is a paired Vanilla/React protocol with ten samples per app/scenario, raw data, endpoint profiles, one immutable fixture, and explicit readiness criteria. Before and after were run in separate CI jobs, so remaining runner/cache variation is reported as a limit.

Search-index construction itself is a `useMemo` in the catalog client route and is not separately timed. Filter actions are measured after the catalog has rendered. The available measurements therefore separate API/SQL and repeated filter action, but do not attribute the synchronous index build as its own span. Cold PostgreSQL/cache-flush behavior, CI-wide competing load, and pre-opened catalog transitions could not be isolated in the hosted runner; they remain explicit limits rather than assumed causes.

## 3. Comparison dependency graph and critical path

The source implementation is in `apps/web-react-poc/src/features/comparison/api.ts`, `apps/web-react-poc/src/features/catalog/admission-api.ts`, and the shared adapter `apps/web-react-poc/src/shared/api/client.ts`.

```text
Direct comparison navigation / stored selection
  └─ loadCatalog()
      ├─ GET /release (pin release_key)
      ├─ in parallel: /programs (all pages), /directions, /departments
      └─ GET /release (catalog consistency guard)
          └─ resolve exact selected external program keys
              ├─ admission starts as soon as program identity is known
              │   ├─ campaigns → choose campaign
              │   ├─ offerings + calendar + place quotas
              │   ├─ direction requirements
              │   └─ direction pools + historical/admission statistics + tuition
              └─ selected programs → all study-plan pages
                  └─ latest verified plan per exact program identity
                      └─ all curriculum-item pages for each plan
                          └─ subject taxonomy
                              └─ exact hours/credits and discipline classification
                                  └─ join admission and verify every release_key
                                      └─ final GET /release guard
                                          └─ render complete comparison
```

The public HTTP reads fan out over several endpoints. Some operations are independent (initial catalog collections, plans for selected programs, admission reads after program resolution); items depend on verified plans, and classification/rendering depend on items and taxonomy. Admission and curriculum are overlapped by the current React optimization. Their stage durations overlap and cannot be summed to obtain route readiness. Catalog acquisition and the final release guard remain in the critical path because they establish exact identity and consistency.

Baseline fixture: release `bmstu-2026:72af1a16109bbcb8adf3060249636c49ed69cd2d635aac9bd762e12e7b213fbe:bmstu-2026-bundle-v5`; programs `13.03.02-02` and `15.03.06/М9`; each selected program has one verified plan and 131 curriculum items. Independently checked hour totals were 34,252 and 34,144; credits were 432 and 432.

### Baseline route profile

Values below aggregate selected/high-cost routes over one full React comparison and therefore include concurrent requests. Low-cost `/campaigns`, `/place-quotas`, `/release`, and `/subject-taxonomies` calls are present in the raw profile but omitted from this abbreviated table. Totals are not route critical-path durations.

| Route | Calls | App ms | SQL cursor ms | SQL statements | Response bytes |
|---|---:|---:|---:|---:|---:|
| `/programs` | 2 | 825.5 | 460.0 | 1,380 | 702,371 |
| `/directions` | 1 | 334.3 | 235.0 | 328 | 130,820 |
| `/departments` | 1 | 216.8 | 147.7 | 160 | 113,294 |
| Selected `/study-plans` | 2 | 54.5 | 31.7 | 24 | 12,159 |
| Selected plan item pages | 4 | 1,338.6 | 680.6 | 818 | 521,902 |
| Campaign offerings | 2 | 1,025.5 | 758.7 | 878 | 204,002 |
| Statistics | 4 | 787.4 | 171.6 | 174 | 84,875 |
| Competition pools | 2 | 656.9 | 418.7 | 468 | 82,233 |
| Requirements | 2 | 274.2 | 69.9 | 69 | 15,833 |
| Calendar | 1 | 164.1 | 104.2 | 118 | 72,875 |
| Tuition | 2 | 427.1 | 37.9 | 36 | 12,202 |
| **All profiled API calls** | **29 total browser requests** | **6,353.3 cumulative** | **3,106.5 cumulative** | **4,486** | **1,959,367** |

The Browser Resource Timing transfer count includes the endpoint bytes reported in the paired artifact; the table's profile response-byte sum and the browser's transfer bytes differ slightly because they are collected at different layers. PostgreSQL `EXPLAIN ANALYZE` showed index-backed reads for curriculum pages/counts (about 0.63 ms for the selected 131-row page and about 0.05 ms for the count in the captured plan). The observed issue is repeated access and aggregate request/serialization work, rather than an unindexed curriculum scan. No schema migration was justified.

After batching, the final PG16 profile reports 15 SQL statements for a 100-row program page (109.03 ms app / 72.77 ms SQL cursor / 454,521 B), 11 for directions (33.14 / 12.30 ms / 130,820 B), 8 for departments (14.91 / 5.79 ms / 113,294 B), and 11 for a 100-row curriculum page (56.80 / 36.38 ms / 197,407 B). The 131-row plan still requires its second cursor page; both pages are retained and the exact totals are checked. Representative route DTO pages are byte-for-byte/value-for-value equal to the test-only unbatched mapper on the same release. The candidate EXPLAIN remains index-backed (curriculum count about 0.06 ms, first page about 1.19 ms in this capture). Those plans do not justify an index or schema change.

Baseline React loader stage medians (`ms`) were: catalog 865.1, selection 0.9, admission 1,075.3, study plans 42.0, curriculum items 1,074.8, taxonomy 7.2, curriculum model 1.6, and final release check 6.0. Total marked loader time was 1,994.8 ms. In final run #143, candidate stage medians were catalog 180.9, selection 0.75, admission 267.15, plans 45.15, items 232.55, taxonomy 8.45, curriculum model 2.2, final release check 6.35, and total marked loader time 493.5 ms. Admission overlaps the plans/items/taxonomy path, so the longest dependency path and separately measured full-data readiness are the valid comparisons; adding stage medians would double-count concurrent work. The candidate `total` stage is not a substitute for navigation-to-ready time.

## 4. Architecture options

Measured values refer to the fixed PG16 fixture. B and C remain architectural estimates; neither was implemented or benchmarked.

| Criterion | A — batch internal reads in existing API | B — limited bulk-read endpoint(s) | C — comparison snapshot endpoint |
|---|---|---|---|
| Backend complexity | Low/moderate; selected, request-local repository batching | Moderate; new limits, pagination and grouped DTOs | High; comparison orchestration and broad DTO with lifecycle semantics |
| Frontend complexity | None beyond existing client changes | Moderate adapter and multiple bulk response handling | Low route orchestration, but identity resolution still needs a verified catalog |
| API requests | Measured: 29 before and after; 1,968,067 B in React | Estimate: about 24 for this two-program case if one bounded bulk read replaces six selected-plan/item page calls; not measured | Estimate: 1–2 data/release reads after exact keys are known; not measured |
| Response size | Measured: 1,968,067 B before and after; same DTO/page content | Estimate: similar total facts with fewer envelopes; not measured | Estimate: similar or larger single JSON body; not measured |
| Estimated readiness | Measured full-ready median improved 2,535.9→1,081.8 ms for React | No numerical estimate justified; benefit depends on bulk construction and network conditions | No numerical estimate justified; fan-out falls but serialization, buffering and validation cost is unknown |
| Release consistency | Existing request `REPEATABLE READ READ ONLY`; release-scoped queries | Must pin/return release and paginate within it | Must pin one DB snapshot across the complete response and model active-release switch |
| Reusability | Improvements benefit all collection consumers | Useful for other multi-program reads | Narrow comparison-only contract |
| Testability | Existing route DTO parity and query budgets | New contracts and page/limit behavior | Broad consistency/error/completeness matrix |
| Maintainability | No public API or OpenAPI drift; bounded internal repository methods | One more public API surface | New composite DTO plus server and client ownership of composition |
| Migration cost | Small; old endpoints untouched | Moderate, requires OpenAPI and TS generation | Highest; new API contract, tests, migration and fallback decisions |

Option A was selected because profiling demonstrated page-sized SQL amplification in existing routes and a bounded internal fix could preserve all current response DTOs. The final measured result confirms it is materially useful: full-ready median improved 57.3%, request count and bytes stayed unchanged, and all selected facts remained present. B could reduce five selected curriculum HTTP calls under the stated design assumption, while C could reduce more fan-out, but neither has a measured benefit here. The final 1.082 s full-ready median already meets the 1.8 s target, so the added public surface and release/DTO ownership costs of B or C are not justified by the remaining evidence.

## 5. Implementation and compatibility

The change adds request-scoped batch operations to `packages/db/src/andromeda_db/repositories/read_repository.py`: internal rows by exact IDs, related rows/counts by a bounded ID set, evidence bridges for many entities, and manual-review rows for many external keys. `services/api/src/andromeda_api/application/queries.py` prefetches the related rows needed to map page DTOs, including admission collections. Batch size is bounded by the existing page limit of 100; no public pagination semantics change.

The repository filters every batch by the request's `active_release_id`. The request dependency opens a PostgreSQL `REPEATABLE READ` transaction, sets it `READ ONLY`, sets the statement timeout and rolls the transaction back at the end. All DTO reads for one HTTP response therefore use one database transaction snapshot and one resolved release. Profiling middleware is opt-in and payload-free. The benchmark requires each relevant response to report app time, SQL time, and SQL query count; those values are not exposed as a normal product feature.

No endpoint, public DTO, OpenAPI schema, generated TypeScript contract, database schema, or React business contract changed. Existing routes remain available and retain their filtering, cursor, count, and release-key behavior. The React adapter continues checking response release keys, verifies latest plan/program identity and curriculum ownership, and checks the active release again after assembly. If the active release changes during a browser comparison, the final guard rejects the mixed-age assembly and the UI follows its existing controlled error path.

The database lifecycle regression also simulates changing the active release from a privileged second connection during a read. The in-flight read remains tied to its existing transaction's prior release snapshot; a subsequent request observes the restored/current active release. The candidate API profile adds response parity checks: the same API pages are generated using the batched repository and a test-only unbatched repository view. Exact serialized DTO page values must match on the same immutable seeded release.

## 6. Before / candidate / Vanilla performance

All figures must be reported as median and min–max over ten measured samples; the sample is too small to support a stable production p95 claim. “Ready” is first visible content; “full ready” is the complete verified comparison. API `Server-Timing` application values include response mapping/serialization and exclude browser transfer. SQL duration is SQLAlchemy cursor elapsed time, not pure server executor time. Loader stages overlap. Rendering is not independently isolated for both frontends.

| Metric | Vanilla before → candidate API | React before batching | React candidate |
|---|---:|---:|---:|
| First visible / ready (median; min–max ms) | 2,557.35 (2,055.8–2,577.6) → 1,069.15 (671.4–1,188.8) | 2,491.35 (2,475.0–2,501.9) | 1,032.15 (1,021.0–1,096.5) |
| Full verified data ready (median; min–max ms) | 2,656.40 (2,598.3–3,010.5) → 1,122.15 (721.5–1,240.8) | 2,535.90 (2,518.4–2,546.2) | 1,081.80 (1,068.7–1,140.1) |
| Cumulative API app duration, median (ms) | 5,917.46 → 1,076.22 | 6,353.31 | 1,606.22 |
| Cumulative SQL cursor time, median (ms) | 3,381.74 → 552.86 | 3,106.48 | 631.99 |
| SQL statements per comparison, median | 5,744 → 237 | 4,486 | 300 |
| API requests, median | 21 → 21 | 29 | 29 |
| API transferred bytes, median | 2,301,149 B → 2,301,149 B | 1,968,067 B | 1,968,067 B |
| JavaScript transferred bytes, median | 59,603 B → 59,603 B | 142,095 B | 142,095 B |
| All-resource transferred bytes, median | 2,885,302 B → 2,885,302 B | 2,516,194 B | 2,516,073 B |
| Rendering duration | Not isolated | Not isolated; diagnostic trace captured | Not independently timed; diagnostic trace captured |
| Long tasks (median) | 0 → 0 | 0 | 0 |
| CLS (median) | 0.09 → 0.09 | 0 | 0 |

Across the ten React samples in final run #143, median full-data readiness improved by 1,454.10 ms (57.3%). Total browser API bytes, request count, JavaScript bytes, and all verified academic rows stayed the same. React profile totals fell by 74.7% for application time, 79.7% for SQL cursor time, and 93.3% for SQL statements. The Vanilla control also improved on the candidate API: its full-ready median fell by 57.8% versus the baseline API. These improvements point to backend read amplification, not a React render change. Before and after used the same browser, fixture, endpoint selection and warm-up protocol in separate GitHub-hosted CI jobs; this is not a single-process A/B and residual host/cache noise remains possible.

The 100-row catalog stress scenario improved for both clients and the PG16 profile explains the code-level change. It does not replace a live 100-row DB pagination benchmark: the `/programs` response in that stress scenario is synthetic. A live `/programs?limit=100` direct profile provides the independent page-level query comparison above.

Raw before results are checked in under [`benchmark-results/backend-aware-baseline`](benchmark-results/backend-aware-baseline/): [paired browser samples](benchmark-results/backend-aware-baseline/paired-performance-report.json) and [PostgreSQL 16 endpoint profile](benchmark-results/backend-aware-baseline/postgres-read-profile.json). Original CI run: [38064532391](https://github.com/artemnoor/andromeda-bmstu-monorepo/actions/runs/38064532391).  
Raw candidate results are retained under [`benchmark-results/backend-aware-candidate`](benchmark-results/backend-aware-candidate/): [paired browser samples](benchmark-results/backend-aware-candidate/paired-performance-report.json) and [PostgreSQL 16 endpoint profile](benchmark-results/backend-aware-candidate/postgres-read-profile.json). Final candidate CI run [38071680052](https://github.com/artemnoor/andromeda-bmstu-monorepo/actions/runs/38071680052); workflow artifacts are retained for 90 days. The raw JSON includes every sample, stage values, endpoint profiles, and release/program/plan/item/hour/credit identity checks.

## 7. Academic correctness and behavior checks

The baseline and candidate paired gates independently assert an identical release, exact external program keys, selected verified plan keys, all curriculum item pages, exact per-program item counts, and hour/credit totals before a sample is accepted. The after API integration test compares page DTOs for catalog, campaigns, selected plans/items, and admission endpoints against the previous unbatched mapping on the same fixture. No result may be made green by weakening those assertions.

Existing and added checks cover the requested behaviors at the unit, integration, or browser level:

- Live API browser flows cover direct comparison loading, moving one catalog selection into comparison, reload persistence, and comparisons with two and three programs. The selected live programs each have a 131-row verified plan; the API profile checks the 100-row first page and cursor pagination.
- Comparison model tests reject wrong program/plan ownership, do not fall back when the latest plan is unverified or unparsed, cover ambiguous plan years, verify three-program workload isolation, and preserve exact hours/credits plus zero/null/unknown values. Synthetic table rendering is exercised at 100, 500, and 1,000 curriculum rows; these are scale fixtures, not extra academic facts.
- Admission tests cover partial/unknown facts and safe classification, while the live quota-scope test checks that broad unverified campus relationships are not attributed to a program. The timeout regression keeps completed curriculum visible and marks only that program's admission unavailable.
- The published PG16 fixture has no stored place-quota assertions. A follow-up mapper unit test exercises a non-empty quota DTO with linked campaign/pool/funding/quota references, a verified source/evidence record, and an explicit zero. The PG16 profile now also supplies two in-memory quota rows linked to real release-scoped records, compares batched and unbatched DTOs against PostgreSQL inside a read-only repeatable-read transaction, and asserts fewer SQL statements (7 mapper-linked SQL reads batched versus 11 unbatched in final run #143). No synthetic fact is inserted into the immutable release. The reported SQL counts cover DTO-mapping linked reads only; the in-memory quota page adapter bypasses the `place_quota_assertions` page and count SQL, so these are not endpoint-total query counts.
- Release-switch tests reject an active release change during plan or admission reads and reject a response whose release key differs. PostgreSQL lifecycle coverage exercises the active-release switch during a `REPEATABLE READ` read and read-only runtime permissions.
- API client tests cover malformed envelopes and repeated pagination cursors. Admission adapter tests cover shared repeated requests, retries after failure, caller cancellation, and aborting nested reads only when all consumers leave. Comparison route tests pass cancellation signals through its reads.

The final CI run completed Vanilla browser regression, React Playwright on Chromium/Firefox/WebKit, and the six-viewport visual comparison successfully. Paired performance is Chromium-only, and the visual check compares Vanilla to React; it does not constitute an automated React-before/after screenshot diff.

Distinctions remain explicit: known zero is numeric zero; absent/unknown is null or unavailable according to the source contract. Admission-page DTO parity preserves the original requirement expression nodes (including AND/OR/AT_LEAST), source links, quota facts, and statistics without regenerating those relationships in the UI. The batch methods only fetch the same release-scoped rows the existing DTO mapper already requests. They do not introduce new academic joins, campus associations, quota attribution or taxonomy classifications.

## 8. Verification results

### Local checks

- React TypeScript strict typecheck: passed.
- React ESLint: passed.
- OpenAPI generated-type drift check: passed; no contract change.
- Vitest: 68 passed across 10 files, including timeout behavior.
- React production build: passed.
- Python full suite: 102 passed, 24 skipped, one warning. Skips are environment-specific PostgreSQL 16 / optional Directus cases; this is not represented as a local PG16 result.
- Local API contract + profile tests: 16 passed, one PG16 opt-in test skipped.
- No local PostgreSQL 16 daemon was available; PG16 integration conclusions rely on the isolated CI service.

### Final candidate CI / cross-browser / visual

Final candidate run [38071680052](https://github.com/artemnoor/andromeda-bmstu-monorepo/actions/runs/38071680052) succeeded across all ten jobs, including full Python regression, PG16 lifecycle/read-only/route parity and query budgets, strict TypeScript/lint/Vitest/OpenAPI/build, Vanilla regression, React Playwright Chromium/Firefox/WebKit, six-viewport comparison, ten-sample paired benchmark, and PostgreSQL read profile. Visual comparisons are Vanilla-versus-React at six viewports; they are not before-versus-after pixel captures of the React implementation.

## 9. Independent review and AI Factory

The AIF Ultra execution plan is in `.ai-factory/plans/codex-andromeda-backend-performance/` with four phases: controlled baseline attribution, architecture selection and implementation, invariant/benchmark verification, and independent review/delivery.

All six requested specialist roles were used:

| Role | Focus / findings |
|---|---|
| Performance Investigator | Reproduced direct paired baseline, stage and route profiles, cache/readiness method, catalog variance limits, SQL plans. |
| Backend Query Architect | Found page-sized N+1 reads in row mapping; reviewed batch SQL, release scope, pagination and query budget. |
| API Contract Architect | Compared A/B/C and established unchanged versioned public contract as the lowest-risk initial change. |
| React Integration Engineer | Mapped client dependencies and existing release checks; no client API migration was needed. |
| QA & Benchmark Engineer | Audited PG16 isolation, three-browser execution, raw samples and metric limitations; identified absent local PG16 and recommends relying on CI. |
| Independent Reviewer | Audited implementation and parity coverage, then rechecked the final commit and candidate artifacts. Final review of candidate head `6ea458e`: no P0/P1 findings. |

The independent runtime review of candidate head `64b45c9` and CI run #141 found no P0/P1 and independently recomputed its 59.8% readiness improvement from the raw ten-sample data. It identified a P2 quota-coverage gap because the release fixture's stored quota page is empty; the follow-up branch added non-empty unit and real-PG16 read-only synthetic-page regressions. The reviewer also noted that `EXPLAIN ANALYZE` covers representative direction and curriculum reads, not every admission query. That limitation is documented; it does not undermine the observed latency result. The exact-head follow-up review confirmed the neutral fixture key and narrower mapper-query counter names; its remaining P2 documentation note is closed by the explicit count-boundary sentence above. The reviewer independently recomputed final run #143: React readiness improved 57.3%, Vanilla 57.8%, and query, SQL and app medians matched the retained JSON. It found no P0/P1. The isolated PG16 profile and all other jobs in final run #143 succeeded. Earlier P2 gaps fixed on this branch include campaign-page DTO parity and a benchmark assertion requiring app duration, SQL duration and query count on every comparison API response. CI retry handling also fixed a WebKit ResizeObserver error without changing layout or design intent.

## 10. GitHub and outstanding limits

- Pull request: [#11](https://github.com/artemnoor/andromeda-bmstu-monorepo/pull/11), merged after all required checks passed.
- Candidate code head: `6ea458ead3495f90876c434e85cf18c20f60050b`.
- Final report/evidence head before merge: `b032dcfe71a4a9c322e593677c1e9ec42c4b4e05`.
- Squash merge commit on `main`: `4d8737801d2232e6a3b265c58c82c519fd92752a`.
- Baseline main: `6a2da949c098b1198c2c4ccf7a93c641d87716f9`.
- Candidate CI at head `6ea458e`: [run 38071680052](https://github.com/artemnoor/andromeda-bmstu-monorepo/actions/runs/38071680052); all ten jobs succeeded.
- Final evidence commit CI at `b032dcf`: [run 38073660357](https://github.com/artemnoor/andromeda-bmstu-monorepo/actions/runs/38073660357); all ten jobs succeeded. The independent reviewer recomputed final run #143 values and reported no P0/P1 findings.

Open evidence limits to retain in the final decision: the historic 482→957 ms catalog spread's exact cross-run cause remains unresolved; warmed database means no cold-start comparison; server application time does not isolate JSON encoder cost; SQL cursor duration is not pure PostgreSQL execution time; n=10 is descriptive and not a stable production p95; no isolated cross-framework render-duration metric is available; EXPLAIN did not cover every admission query shape. The 1,800 ms target was met in this controlled warm-server sample. No React production routing was changed, no other page migrated, and no frontend redesign was included.
