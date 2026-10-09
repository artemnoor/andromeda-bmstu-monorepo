# Andromeda comprehensive QA and stabilization

**Run date:** 2026-10-09
**Base:** `main` at `e42e6b5e3657d53bfa3e82a1d254f096e979e3c5`
**Branch:** `codex/andromeda-comprehensive-testing-qa-stabilization`
**Test data:** checked-in BMSTU 2026 bundle, digest `42616ee9348ee009fa1b297f7ef697862134835e562c7840f413643ce71d2130`, in an isolated PostgreSQL 16.15 database on loopback. No production database or external academic API was used.

This report records observed checks, defects and remaining limits. “Coverage” below means executed behavior or page scope; Python/JavaScript line and branch coverage were not measured because the repository has no coverage instrumentation configured.

## A. Testing overview

| Area | Tests / scope | Passed | Failed | Skipped | Measured code coverage / result |
|---|---:|---:|---:|---:|---|
| Python full regression | `uv run --no-sync pytest -q` | 118 | 0 | 1 | Line/branch coverage not measured; 1 existing Starlette/httpx deprecation warning; 1973.81 sec |
| Frontend unit/integration | Node 22, `npm test` | 23 | 0 | 0 | 23 tests passed |
| Playwright focused semantics | 12 AND/OR/AT_LEAST cases plus one comparison/chart interaction, Chromium/Firefox/WebKit | 39 | 0 | 0 | 13 scenarios per browser; focused rerun passed on all three engines |
| Playwright complete suite | 270 tests; Chromium, Firefox and WebKit, live Browser → Node → FastAPI → PostgreSQL plus deterministic failure fixtures | 229 | 0 | 41 | Final all-engine local run; skips are scoped axe/visual cases and unsupported Windows symlink checks |
| Frontend production build | `npm run build` | 9 pages | 0 | 0 | All nine original HTML pages/assets validated and emitted |
| Ruff | `uv run --no-sync ruff check .` | Pass | 0 | 0 | Repository-wide; no findings |
| PostgreSQL migrations, import, release lifecycle, proposals and permissions | Isolated PostgreSQL 16.15 | Included in 118 passed | — | — | Fresh migration and seeded API release at `b62d4e91a8c3`; backup/restore rehearsal passed |
| Visual capture | 9 pages × 6 viewports × original and migrated trees | 108 captures | — | — | Screenshots compared; dynamic-page pixel deltas are not parity scores (see D) |
| Compose | Default and Directus profiles | Pass | 0 | 0 | Configuration only; Docker daemon unavailable for container smoke |

The 108 visual screenshots are 54 original plus 54 migrated captures; 54 additional PNGs are pixel-difference heatmaps. They remain in ignored local artifacts and are not committed. The detailed capture report is `artifacts/qa-stabilization/visual/screenshots-sixview/reports/visual-sixview-report.md`.

The single Python skip is `tests/integration/test_directus_runtime.py`, which requires a configured authenticated local Directus HTTP service. PostgreSQL release lifecycle, proposal concurrency/idempotency and Directus database permission tests ran against the disposable PostgreSQL 16.15 cluster.

## B. Frontend coverage matrix

The final complete local Playwright suite passed in Chromium, Firefox and WebKit in one run: 229 passed, 41 scoped skips, 0 failures (270 tests total). The 41 skips are 18 Firefox and 18 WebKit axe cases, three Windows symlink cases, and two non-Chromium visual screenshot cases. An earlier Firefox teardown error did not recur in the final complete run. A focused 39-test run (12 requirement cases plus one comparison/chart interaction in each engine) also passed. Fixed-width visual captures use Chromium. The six visual viewport sizes are 1920×1080, 1440×900, 1280×800, 768×1024, 390×844 and 375×667.

| Page | Scenarios exercised | Browsers / viewports | Findings and changes |
|---|---|---|---|
| `index.html` | Hero, navigation/menu, keyboard open/close, links and CTA | Full browser run in Chromium/Firefox/WebKit; visual capture at all 6 sizes | Original static design is effectively pixel-aligned; removed horizontal overflow at all captured widths |
| `first-screen.html` | Hero, shared menu, logo click, home/catalog destinations and responsive shape | Full browser run in Chromium/Firefox/WebKit; visual capture at all 6 sizes | Fixed the logo link’s disabled pointer events; static comparison remains pixel-aligned and no horizontal overflow |
| `programs.html` | Live catalog, 500-row pagination/search, filters, program details, admission failure/retry, favorite/compare actions, unsafe text/URL and API errors | Full browser run in Chromium/Firefox/WebKit; visual capture at all 6 sizes | Admission failures no longer masquerade as empty success; live responses fail closed on release changes; unresolved relations are not presented as confirmed |
| `compare.html` | Selection and limits, release/current-plan checks, curriculum ownership, chart totals/categories, keyboard activation, search/details, partial data and retry | Full browser run in Chromium/Firefox/WebKit; visual capture at all 6 sizes | Only a uniquely current verified plan contributes; missing values remain unknown; unscoped data loads were narrowed |
| `favorites.html` | Empty/populated states, removal, missing identities, deduplication, compare action and persisted browser state | Full browser run in Chromium/Firefox/WebKit; visual capture at all 6 sizes | Legacy storage migration and cross-page shared keys are exercised |
| `profile.html` | Scores, invalid boundaries, interests, achievements, target direction, save/reload/clear, legacy migration and storage denial | Full browser run in Chromium/Firefox/WebKit; visual capture at all 6 sizes | Local-only profile is explicit; storage failure is reported instead of claiming a save |
| `admission.html` | Direction/funding filters, nested requirements, scores, quotas, evidence, missing/zero values, initial API failure and retry | Full browser run in Chromium/Firefox/WebKit; visual capture at all 6 sizes | Stale facts clear during direction changes/errors; unknown minima are not zero; OR/AT_LEAST success wording no longer claims every alternative was checked |
| `discover.html` | Branching questions, back/edit/restart, result ranking, comparison actions and recommendations | Full browser run in Chromium/Firefox/WebKit; visual capture at all 6 sizes | Ranking/question-selection logic is checked against independent test oracles |
| `workspace.html` | Direct/hash routes, back/forward, reload, catalog, profile, favorites, comparison, admission, dialog and shared state | Full browser run in Chromium/Firefox/WebKit; visual capture at all 6 sizes | Routes use the same browser state and verified academic mappings |

All nine pages are also checked for HTTP 200, browser exceptions, unexpected failed requests, local resource availability, basic keyboard behavior and initial-state accessibility. axe-core runs in Chromium at desktop and mobile sizes; accessibility cases are intentionally skipped in Firefox/WebKit to avoid redundant engine-independent scans. Screenshot visual tests use Chromium only. Of the 41 full-run skips, 36 are non-Chromium axe cases, three are unsupported Windows symlink checks, and two are non-Chromium screenshot comparisons.

## C. API and academic-data integration

### Live request map exercised

The real seeded browser flow traverses the same-origin Node proxy to FastAPI and PostgreSQL. The live suite checks typed rows and rendered values, not only response status.

| Frontend request | Verification |
|---|---|
| `/api/v1/health`, `/api/v1/release` | Runtime role can read health and active-release identity |
| `/api/v1/programs`, `/directions`, `/departments` | Program identity, direction joins, verified/unresolved department semantics and rendered names |
| `/api/v1/study-plans`, `/study-plans/{key}/items` | Verified current plan selection, program ownership, curriculum rows and release consistency |
| `/api/v1/subject-taxonomies/{key}/{version}` | Typed categories and category-to-course rendering |
| `/api/v1/campaigns`, campaign detail, `/calendar`, `/offerings` | Campaign year/kind, exact offering link and source data |
| `/api/v1/requirements`, `/individual-achievements` | Requirement tree mapping, achievement fields and profile rendering; both routes exist in FastAPI |
| `/api/v1/competition-pools`, `/tuition`, `/statistics` | Direction-scoped places/quotas, tuition currency and historical/current admission facts |
| `/api/v1/place-quotas` | Direct release-envelope/API route check; the checked-in release contains zero rows in this separate projection, while the UI uses sourced `competition-pools` rows |

The request audit found no frontend call to a missing FastAPI route. In particular, `/api/v1/individual-achievements` is implemented and typed. Direct checks also confirm untrusted-origin CORS is not permissive and `POST /api/v1/programs` returns 405. Browser and server never connect directly to PostgreSQL; the FastAPI runtime uses the restricted read role.

### Data correctness and failure behavior

- The adapter requires a non-empty `release_key`, checks it across pages and across the page’s requests, rejects repeated cursors and malformed envelopes, and bounds pagination at 500 pages of 100 records.
- Course comparison independently checks hours/category math and per-program course ownership. A newer plan needing review cannot silently fall back to an older verified version; equal-year ambiguous versions fail closed.
- Department names/codes appear as confirmed only when their relationship is verified. Exact-key identity remains the join rule.
- Null exam minimums stay unknown, explicit zero remains valid, and nested AND/OR/AT_LEAST outcomes are checked with a hand-authored truth table. The UI states that an accepted branch is confirmed without implying all optional leaves were checked.
- The original bundle’s targeted-quota metadata now survives bundle mapping → PostgreSQL → export → typed API: target organization, INN/KPP/OGRN as strings, region and campus label. The new migration is additive at `b62d4e91a8c3`; earlier revisions and immutable releases are not rewritten.
- Live mode is default. `?data=demo` explicitly opts into a labeled local JSON snapshot. API failure does not enable demo mode or mix data sources.
- Failure fixtures cover 404, 429, 500, 503, invalid JSON, missing release identity, repeated cursor, changing release, slow/stalled requests and recovery. Browser requests and the Node proxy have finite timeouts; retry states remain available where the page supports retry.

## D. Visual regression and responsive behavior

The extracted original archive was served alongside the migrated pages. Captures used fixed Chromium states, reduced motion, blocked third-party traffic and the same viewport sizes. The original archive’s configured legacy API was stubbed with a deterministic 500 response; current dynamic pages used explicit demo data. Therefore dynamic-page pixel-difference percentages are not valid design-parity scores. Static `index.html` and `first-screen.html` were captured in aligned states and are effectively pixel-aligned.

| Page group | Visual result |
|---|---|
| Home and first-screen | Pixel difference 0–0.03% across the six widths; no material design change |
| Dynamic catalog/admission/profile/compare/discover/workspace pages | Captured at all six widths; exact pixel delta is inconclusive because the two roots had different data/loading states |
| Horizontal overflow | None on any migrated page at the six captured widths. The original home overflowed by 17–57 px at all sizes; original favorites overflowed by 17 px on the two mobile widths |
| Images and console | 0 missing image results and 0 page errors; 12 original-root console errors came from its deliberate legacy API 500 stub |

No screenshot or source archive was added to Git. The visual comparison report and heatmaps are local ignored evidence; the CI Playwright job uploads screenshots and traces on failure.

## E. Bugs fixed

| ID | Severity | Component | Root cause | Fix and regression evidence | Status |
|---|---|---|---|---|---|
| QA-01 | P1 | Catalog admission details | A rejected admission request was converted to `{}` and cached as loaded, making an API outage look like missing facts and blocking retry | Preserve rejection, show an unavailable state, and retry on reopen; `admission-recovery.spec.js` | Verified in final browser run |
| QA-02 | P1 | API adapter / multi-page UI | Independent endpoint/page requests could carry different active release keys and be flattened together | Enforce one release key and reject cross-release reads; `release-coherence.spec.js`, live PG-backed UI checks | Verified in final browser run |
| QA-03 | P1 | Curriculum comparison | Comparison could mix multiple or unverified plan versions, or use an older plan when a newer one required review | Select only one uniquely current verified plan and disclose ambiguity/review gaps; unit and Playwright regression cases | Verified in final browser run |
| QA-04 | P1 | Program identity display | An unresolved department relation fell back to the first candidate and appeared authoritative | Show only verified department relations; unresolved identity remains explicit; mapping/API UI tests | Verified in final browser run |
| QA-05 | P1 | Admission requirements | `null` minima could behave like a zero threshold and nested alternatives were overclaimed | Preserve null/zero distinction, implement three-valued AND/OR/AT_LEAST evaluation, and use cautious outcome copy; 13 black-box truth-table cases across three engines | Verified in final browser run |
| QA-06 | P1 | Admission page recovery | Changing direction/API failures could leave old facts visible or loading status stuck | Clear stale direction data, show busy/error/retry states; `admission-recovery.spec.js` | Verified in final browser run |
| QA-07 | P1 | PostgreSQL quota projection | Target-organization metadata from the source bundle was discarded before API display | Add nullable additive fields, string identifiers, mapper v5, typed API mapping/filter and PG export→API integration case | Verified by PostgreSQL 16 suite |
| QA-08 | P2 | Historical statistics | Truthiness checks hid valid numeric zero values | Use explicit missing-value checks; regression distinguishes zero from null | Verified in final browser run |
| QA-09 | P2 | Node static server | Development root could serve package files, tests and server source if reachable | Restrict static paths, reject traversal/symlink escapes and non-read methods; `server-security.spec.js` | Verified in final browser run (Windows symlink case skipped; Linux CI executes it) |
| QA-10 | P2 | Web runtime reliability | Browser/API proxy requests could remain pending on an unresponsive upstream | Add finite browser and proxy deadlines; stalled browser and Node-upstream regression tests | Verified in final browser/unit runs |
| QA-11 | P2 | Responsive layout | Original home/favorites had horizontal overflow at narrow widths | Constrain migrated layout and test all nine pages at 390/375px plus other viewports | Verified by six-size browser capture |
| QA-12 | P2 | PR CI | Proposal domain/binding unit tests were omitted from selective pull-request jobs | Add both suites to the domain/API contract job | Awaiting GitHub Actions confirmation |
| QA-13 | P2 | First-screen navigation | The visible logo anchor had `pointer-events: none`, so a normal pointer click could not follow its home link | Enable pointer events; add a real click test for home and menu catalog destinations | Verified in Chromium, Firefox and WebKit |
| QA-14 | P2 | Admission place totals | Nullable `places` values were treated as zero, hiding incomplete totals; conflicting source-row counts were shown as simply missing | Keep totals incomplete when any row is unknown; display source conflicts and reported values in catalog, comparison and workspace; `partial-admission-totals.spec.js` covers unknown, zero and conflicting values | Verified in final 270-test run; live PostgreSQL API oracle also passed |

## F. Performance

Performance tests use deterministic fixtures and attach JSON metrics for 500 catalog programs and a live comparison. In a separate final Chromium measurement, 500 catalog cards rendered in 705 ms with seven API calls, 15 browser resources, and one observed 51 ms long task. The test bounds pagination to five catalog pages plus two joins and asserts no duplicate requests. The live PostgreSQL-backed comparison rendered in 2,522 ms with 15 API calls. Both runs must complete below 15 seconds; these single local samples and regression ceilings are not user-facing SLOs. Lighthouse was not run because no production deployment, network profile or Lighthouse runner is configured. No production performance claim is made.

The main identified request fanout was reduced by scoping admission reads to selected directions, loading profile achievements without unrelated admission collections, requesting only card facts in catalog, loading comparison plans per selected program, and avoiding unverified curriculum item requests. The checked-in 500-program browser fixture verifies pagination and search at the large-data boundary.

## G. Security and reliability

Safe isolated checks cover HTML/text and URL injection with hostile fixture values, source URL allowlisting, external-link `noopener noreferrer`, API read-only methods, untrusted-origin CORS, static project-file exposure, dotfiles, encoded traversal variants, allowed-directory symlinks where supported, stalled upstreams, malformed responses and browser-storage denial on profile save. No administrative HTTP route is exposed. Directus remains read-only on academic tables; PostgreSQL role tests exercise grants and failed write attempts.

These checks do not substitute for a deployed reverse-proxy/header review, production threat model, authenticated Directus HTTP smoke, or a penetration test. Docker Desktop could not start locally, so Directus HTTP container smoke was unavailable. The isolated PostgreSQL permission integration tests remain the evidence for database grants.

## H. AI Factory and independent review

The AIF Ultra plan is in `.ai-factory/plans/andromeda-comprehensive-testing-qa-stabilization/`. Twelve unique agents were used over the task; the environment supports four simultaneous agents including the coordinator, so concurrency was capped at four. Responsibilities and handoffs:

| Agent | Responsibility / result |
|---|---|
| `archive_frontend_audit` | Audited the original nine-page archive and identified the design/source baseline |
| `architecture_auditor` | Audited repository boundaries, ownership and regression surfaces |
| `backend_api_audit` | Mapped FastAPI/client integration and backend runtime seams |
| `api_auditor` | Traced frontend routes, request parameters, DTOs and API errors; confirmed the achievements route exists |
| `academic_data_verifier` | Reviewed release/source identity, academic joins and unknown-value risks |
| `global_loader_audit` | Reviewed request scope, fanout, pagination and large-data behavior |
| `backend_integration` | Reviewed backend integration and persistence implications of frontend fields |
| `quota_data_gap_review` | Implemented the additive quota metadata persistence/API path and PostgreSQL regression test |
| `final_coverage_matrix` | Added independent requirement truth-table and chart interaction coverage; fixed its initial selector expectation from observed DOM semantics |
| `visual_six_viewports` | Captured and compared the original/current pages at six widths (108 captures plus heatmaps) |
| `independent_review` | Read-only first review; no P0/P1 blocker reported |
| `final_independent_review` | Found misleading requirement success wording and a P2 where conflicting source counts looked missing; both were fixed with regression coverage. Final independent review confirmed both findings are closed and reported no remaining actionable data-correctness or test false-positive issue. |

The main agent integrated edits, reran regressions and owns the final report. The reviewer did not run tests; test results below are from direct local executions and GitHub Actions.

## I. GitHub and CI

The branch adds a required repository lint job, Node 22 locked frontend tests/build, isolated PostgreSQL 16 and live API setup, Playwright in Chromium/Firefox/WebKit, and failure screenshot/trace artifacts. Proposal unit and binding tests are included in the PR API/domain job. Existing path-aware database/API/Directus checks remain.

| Item | Result |
|---|---|
| Pull request | Pending creation |
| Commit | Pending |
| GitHub Actions | Pending PR run; Linux job is configured for Chromium, Firefox and WebKit |
| Merge | Pending CI and repository rules |

## J. Remaining issues

### Blocking

- The local full browser suite passes and the final independent review found no remaining actionable data-correctness or test false-positive issue. GitHub Actions result remains pending.

### Non-blocking

- The separate `place-quotas` projection contains zero records in the checked-in release; displayed quota rows are backed by `competition-pools` and retain the source metadata there.
- The archive’s dynamic pages cannot receive a valid pixel-parity score while its legacy API is deliberately stubbed and the migrated pages use demo data. Static landing pages are aligned and all migrated pages have responsive captures.
- Directus HTTP smoke could not run locally because Docker Desktop could not start; the PostgreSQL permissions suite runs independently.
- Browser profile, favorites and compare remain local to the browser; no server-side applicant account is implemented.

### Before production

- Run deployed proxy/header and load tests with production-like network and data volume; establish budgets from that environment.
- Run authenticated Directus container smoke and review the actual deployment's runtime identities and secrets.
- Complete operational backup/restore, retention, monitoring and SLO checks in the selected production environment.

### Future improvements

- Add measured line/branch coverage, property-based generators and selective mutation testing if they provide useful regression sensitivity.
- Add browser-level screen-reader testing and a stable full-page visual baseline for dynamic pages with aligned, source-backed data fixtures.
