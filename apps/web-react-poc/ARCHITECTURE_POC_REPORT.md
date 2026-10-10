# Andromeda React Architecture Proof of Concept

**Status:** experimental application; the existing `apps/web/` remains the production frontend.
**Baseline:** `4e1883d79a84c5c94dd05aa2a945eb0d3232c46f`
**Evaluation date:** 2026-10-10

## Scope and implementation

The isolated `apps/web-react-poc/` application implements the original home, live programs catalog, and program comparison screens. It uses React Router v7 Framework Mode with client rendering, Vite, strict TypeScript, CSS Modules, Vitest, and Playwright. FastAPI’s OpenAPI schema generates the TypeScript API types; a shared API adapter owns requests, pagination, runtime envelope checks, errors, and active-release consistency. The `api:check` command detects generated schema drift.

React Router loaders own route-level server reads. The comparison screen composes records selected in browser storage, so it uses the same API adapter and verifies the active `release_key` before and after loading. There is no TanStack Query, Redux, or second server cache. Comparison and favorite selections use the existing browser keys and migration behavior. No academic records are persisted in client state.

The React app is configured as an isolated SPA (`ssr: false`) with its own package, development/preview ports, CI job, and routes. React Router Framework Mode retains an upgrade path for SSR or prerendering, but SEO rendering has not been implemented or measured. No Node business service was added. The existing nine-page `apps/web/` source was not changed.

### Original interface to React modules

| Original screen/source | React implementation |
|---|---|
| `apps/web/index.html`, shared header/menu and hero styles in `app.css` / `app.js` | `app/routes/home.tsx`, `src/widgets/andromeda-navigation/`, route CSS Modules and original public images |
| `apps/web/programs.html`, catalog search, filters, program card and admission behavior | `app/routes/programs.tsx`, `src/features/catalog/`, catalog/admission model and API adapters |
| `apps/web/compare.html`, browser selection, curriculum joins, charts and discipline matrix | `app/routes/compare.tsx`, `src/features/comparison/`, tested SVG/chart calculation helpers |
| `apps/web/assets/academic-data.js`, API routes and OpenAPI contracts | `src/shared/api/`, generated `schema.d.ts`, typed catalog/admission/comparison adapters |
| Existing comparison and favorites browser keys | `src/shared/browser-state/storage.ts`, storage unit tests and reload E2E |

The implemented app and feature source has 26 TypeScript, TSX, and CSS modules (7,123 lines, excluding generated build output and unused starter placeholders). The existing frontend has 65 tracked files across nine HTML screens, shared assets, scripts, data, and tests. Counts describe the current repository and are not a measure of implementation quality by themselves.

## Verification results

Results below are from the final local source state before delivery. Generated browser artifacts are retained locally under the ignored `apps/web-react-poc/artifacts/` and `test-results/` paths; CI uploads the paired report and browser failure artifacts.

| Area | Result |
|---|---:|
| React POC unit/component tests | 53 passed across 9 files; coverage run passed |
| React POC coverage | Statements 53.57%, branches 41.71%, functions 48.21%, lines 56.68% |
| React POC Playwright E2E | 51 passed across Chromium, Firefox, and WebKit (17 tests per browser, including live API, navigation, comparison, accessibility, and quota-scope checks) |
| Paired original-versus-React QA | 25 passed after the final comparison-method correction: 24 screen/viewport comparisons and one repeated benchmark (five measured runs per app/scenario) |
| Existing vanilla frontend unit tests | 23 passed |
| Existing vanilla frontend Playwright E2E | Local: 229 passed, 41 skipped; PR CI: 232 passed, 38 skipped by the configured browser matrix (axe checks outside Chromium, symlink cases, and screenshot checks outside Chromium) |
| Existing vanilla production build | Passed |
| React POC typecheck, lint, OpenAPI drift check, production build | All passed |
| Backend full pytest / repository Ruff | 118 passed, 1 skipped, 1 warning; `ruff check .` passed |
| GitHub Actions / PR | PR run [`38008070915`](https://github.com/artemnoor/andromeda-bmstu-monorepo/actions/runs/38008070915) passed every applicable PR job on implementation SHA `489cce1`: lint, web, React POC, browser (`232` vanilla passed / `38` skipped, `51` React passed, `25` paired QA passed), API/ingestion (`81` passed), DB lifecycle (`23` passed), domain/contracts, Directus, and PostgreSQL backup/restore. Push run [`38008067120`](https://github.com/artemnoor/andromeda-bmstu-monorepo/actions/runs/38008067120) passed the full Python suite (`118` passed, `1` skipped, `1` warning) and PostgreSQL restore. The only later change is this report’s CI-result update; its final-head checks are verified before merge. |

Coverage is the measured Vitest V8 coverage for the React POC unit/component suite; route-level and browser behavior is additionally covered by E2E but is not folded into those percentages. The independent review confirmed release consistency, accessibility coverage, corrected mobile geometry, and independently verified chart arithmetic against live API rows and taxonomy. Its follow-up audit found that a target pool's `offering_keys` can represent a broad direction relation across campuses. Program cards now fail closed for direction-and-organization pools when the API provides no verified campus identity or exact program association; both the unit regression and live PostgreSQL-backed browser regression pass. Separate review findings on modal focus containment and shared-header coverage were fixed on the home screen and catalog/comparison header; browser tests verify that both close controls are within their dialog and focus wraps/restores correctly. The final independent re-review found no remaining P0–P2 implementation issues.

## Visual comparison

The paired suite ran original and React pages in Chromium using identical isolated FastAPI/PostgreSQL data, browser state, reduced motion, and viewport. It captured the home page, catalog with 152 live programs, empty comparison, and populated comparison at 1920×1080, 1440×900, 1280×800, 768×1024, 390×844, and 375×667. Browser document width matched the viewport in every case; no horizontal overflow was detected. Catalog program count and ordering matched at all six sizes.

| Screen | Pixel difference range across six viewports | Page-height difference |
|---|---:|---:|
| Home | 0–0.01% | 0% |
| Catalog | 0% | 0% |
| Empty comparison | 0.29–0.84% | 0–0.26% |
| Populated comparison | 3.58–7.94% (semantic-masked: 3.54–7.90%) | 1.39–2.10% |

The comparison screen’s remaining pixel delta is concentrated in longer source/provenance text and narrow-screen wrapping. Exact masks cover only text-value rectangles for category legend, distribution-table, and donut values when the captured Vanilla text proves `0` while the API-backed React view preserves the same fact as unknown (`—`); paired texts and matching program/category are asserted before masking. Cells with other text remain unmasked. The raw pixel result is reported alongside the masked value. Masks do not cover layout, chart bars, labels, row boundaries, or page height. Screenshot pixels are compared over the shared rendered height; full-page height is independently checked against the existing 3.5% limit, avoiding the previous double penalty from padding the shorter screenshot with transparent black. The React-only release note lies after the common pixel region on the populated comparison and does not contribute to the pixel delta; a separate E2E assertion checks its visibility, exact release identity against the verified fixture, explanatory text, placement as the final main section, and containment within the full-page capture. The 390px populated comparison is the largest difference at 7.94% raw and 7.90% semantic-masked, below the paired test’s unchanged 10% threshold. Visual similarity is strong, but this is not a claim of pixel identity.

The final fixes matched the original category-table 620px breakpoint and header geometry. They also restored the dimmed category markers while retaining readable text; the populated comparison passes axe’s WCAG 2.1 AA checks and the six-viewport paired run remains within its existing limit. Regression assertions cover narrow mobile row widths/heights and matrix placement. The paired runner performs a production build before capture to prevent stale artifacts. Independent review found that the earlier CI-only 10.12% result came from counting the padded transparent tail of unequal full-page screenshots as visual content; the corrected comparator clips to their common height while retaining separate page-height and section-geometry assertions.

## Defects found and fixed

| Severity | Component | Root cause | Fix and regression |
|---|---|---|---|
| P1 | Admission quota mapping | `direction_and_target_organization` pools were attributed to program cards through direction-wide `offering_keys`; the API does not expose verified campus identity or relationship evidence for these pools. This could show Kaluga-branch target places on a Moscow program. | Keep these broad pools out of program-level quota lists, even when their current pool-to-offering keys overlap an exact program offering. Preserve source campus labels for safely linked offering-scope pools and explain that unconfirmed broader data is not attributed to a program. Unit and live API/PostgreSQL browser regressions cover the cross-campus relation. |
| P2 | Comparison responsive table | The React category table used a 380px breakpoint where the original uses 620px; its header wrapper also differed. | Match the original breakpoint/header geometry and assert row width/height across paired viewport captures. |
| P2 | Admission offer summary | An exact offering with a known duration but unknown study form hid the form field entirely. | Render “Форма обучения: не указана” and cover it with a unit regression. |
| P2 | Home and shared navigation modal | Each menu focus trap included its close button while that button sat outside the `aria-modal` dialog subtree; the homepage and shared header also use separate menu implementations. | Put each open-state close button inside the corresponding dialog shell, keep the closed-state opener outside, and restore focus after the dialog closes. E2E tests exercise both implementations, including keyboard wrapping and Escape restoration in all three browser engines. |
| P2 | Comparison category legend | A full opacity treatment matched the legacy inactive state but reduced small category/value text below WCAG AA contrast. | Keep inactive labels at the readable muted color and apply the legacy 48% treatment to decorative category dots only. The populated comparison now passes axe and remains within the paired visual threshold. |

The initial live-test premise that a direction-and-organization pool should appear on any program in its direction was rejected after inspecting the seed: it contains both main-campus and branch rows, while the DTO exposes no verified campus identity. The replacement browser regression proves that the branch row stays off a Moscow program card even when the pool has a broad link to one of that program's exact offerings.

## API and data behavior

The application uses the existing read-only `/api/v1` routes through one generated-contract-backed adapter. Live browser tests exercised `/release`, `/programs`, `/directions`, `/departments`, `/study-plans`, `/study-plans/{key}/items`, `/subject-taxonomies/{key}/{version}`, `/campaigns`, `/campaigns/{key}/offerings`, `/campaigns/{key}/calendar`, `/competition-pools`, `/place-quotas`, `/tuition`, `/statistics`, and `/requirements`; the routes used in the seeded read flows returned 200. The generated OpenAPI drift check confirms the client types still match the backend spec. Pagination follows returned cursors; response collections are checked for release identity. Data from different active releases fails closed rather than being composed silently. API failure remains an error state and does not switch the app to demo JSON.

Catalog search, direction/department filtering, admission details, favorites, add/remove comparison, reload persistence, and the two-program live comparison were exercised through the browser. The comparison E2E independently obtains plan rows and taxonomy from FastAPI, calculates category hours in the test, and checks the SVG segments and matrix associations. Nullable and unknown values stay unknown; a linked admission offering with no stated study form displays “Форма обучения: не указана”. Known numeric zero remains distinct from missing data. Target quota pools whose campus and program relationship cannot be verified remain unassigned to a program card; the current API lacks a normalized campus identity and relationship-evidence field for those direction-wide rows.

The current backend contract does not expose a university identity/scope on programs and directions. This prototype therefore demonstrates the current BMSTU contract and does not claim multi-university operation. Multi-university joins and release selection across universities need an explicit backend contract before that product capability can be implemented.

## Performance experiment

Measurements used production builds of both apps, Chromium, a 1440×900 viewport at device scale factor 1, a local PostgreSQL-backed FastAPI release, HTTP cache disabled and cleared before each measured navigation, one warm-up per app/scenario, then five measured runs. Each pair used the same requested scenario and browser environment. Values below are medians; navigation p95 is shown in parentheses. “Ready” ends at the measured screen readiness condition. Catalog rows beyond the actual live set were synthetic clones used only to stress client rendering and filtering; they are not academic data validation. The local comparison database is PostgreSQL 17; required hosted integration CI uses the isolated PostgreSQL 16 seed and is the compatibility check for the supported version. Benchmark values are local observations and are not directly interchangeable with CI timings. The 500-program React scenario’s lower total loading time but slower local filter action is visible in the measurements and should not be overgeneralized.

| Scenario | Vanilla ready ms (p95) | React ready ms (p95) | Vanilla action ms (p95) | React action ms (p95) | API requests, V/R | JS transferred bytes, V/R | Total transferred bytes, V/R | Resources, V/R |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Home | 134.0 (136.2) | 145.3 (160.6) | — | — | 0 / 0 | 23,213 / 119,173 | 3,059,547 / 3,116,156 | 5 / 11 |
| Catalog, 50 rows | 318.4 (334.1) | 404.9 (427.4) | 29.4 (31.8) | 33.4 (45.6) | 3 / 5 | 60,743 / 132,066 | 968,235 / 962,073 | 12 / 19 |
| Catalog, 100 rows | 394.8 (404.6) | 422.4 (441.4) | 41.8 (41.8) | 45.4 (46.8) | 3 / 5 | 60,743 / 132,066 | 1,137,187 / 1,130,425 | 12 / 17 |
| Catalog, 500 rows | 1,099.5 (1,112.3) | 732.4 (740.9) | 119.4 (128.1) | 167.4 (220.7) | 7 / 9 | 60,743 / 132,066 | 2,489,959 / 2,483,797 | 16 / 23 |
| Compare, two live programs | 1,456.6 (1,471.2) | 2,472.4 (2,475.2) | — | — | 15 / 21 | 60,743 / 141,126 | 2,529,292 / 2,572,383 | 23 / 33 |

The additional React requests include active-release and cursor consistency checks; these counts alone do not establish N+1 behavior. Route-level data composition and repeated release guards are candidates for optimization while retaining fail-closed consistency. Transferred JavaScript is materially larger in the POC: about 5.1× on home, 2.2× on catalog, and 2.3× on comparison. The two-program comparison ready time is about 1.70× the vanilla median and is the clearest performance issue to address before broader migration. At 500 synthetic rows React reached the page-ready condition faster, while filtering was about 40% slower; this single setup is not evidence that one stack is broadly faster.

Median long-task count was zero in all scenarios. Median CLS was 0 for vanilla home/catalog, 0.03 for React catalog, 0.09 for vanilla comparison, and 0 for React comparison. Chromium `performance.memory.usedJSHeapSize` returned the same 10 MB in every sample, so it was not a useful comparative memory measure. No cross-browser performance claim is made; the Firefox and WebKit results are functional E2E only. The final visual/accessibility CSS change was followed by another complete 24-pair visual pass and five-sample benchmark.

## Architecture assessment

| Criterion | Existing vanilla frontend | React prototype |
|---|---|---|
| Startup JavaScript transferred | 23,213 bytes (home), 60,743 bytes (catalog/compare) | 119,173 bytes (home), 132,066 bytes (catalog), 141,126 bytes (compare) |
| Shared API integration | Existing `academic-data.js` adapter and endpoint behavior | One typed OpenAPI-backed API adapter, generated schema, runtime validation and release guards |
| Application code shape | 65 tracked files across nine pages and shared scripts/assets | 26 app/src TypeScript/TSX/CSS modules for the three POC routes |
| UI/testing | Existing scripts and established Playwright coverage | Route/component boundaries plus Vitest and three-browser Playwright; direct calculation unit tests |
| SEO rendering | Static HTML pages are directly served | Current configuration is client rendered; Framework Mode provides a future route to SSR/prerendering, not an existing SEO result |
| Additional page | Existing page can reuse shared scripts/styles but page logic lives partly in shared JS | Add a route module and feature adapter while reusing shared shell/entities; test the route independently |

The React design has useful boundaries: route modules coordinate data, feature modules hold catalog/comparison behavior, and API/data transforms are outside JSX. Generated API contracts reduce model drift. Route loaders avoid a second cache owner. CSS Modules isolate most styles while small global design tokens keep the original visual system. These are concrete maintainability advantages for a larger team and another route. The POC is also larger in JavaScript and the comparison loader performs more guarded API operations than vanilla, so maintainability gains have not yet translated into stronger measured performance.

## Risks, migration cost, and recommendation

- **Development experience:** clearer module boundaries and strict API types make data flow easier to inspect; setup includes a separate React toolchain and OpenAPI generation step.
- **Maintainability:** promising for new routes because route, feature, shared API, and browser state responsibilities are separated. Review found no unnecessary state library or chart dependency.
- **Scale:** the code organization supports more routes and richer workflows. Multi-university scale remains unproven because current API identity lacks university scope.
- **Performance:** home and catalog are moderately slower to reach readiness; compare is materially slower, and transferred JavaScript increases. Address duplicate consistency reads and compare composition before migrating more data-heavy pages.
- **Remaining page migration:** the six other pages include profile, favorites, admission, discovery, workspace, and interest test. They reuse common shell/state but carry distinct workflows. A rough planning estimate is 4–6 engineer-weeks for careful porting, integration and regression, explicitly an estimate rather than a measured delivery forecast. The first two routes should be re-estimated after migration experience.
- **Transition risk:** keep the current app as production until route-by-route parity, user-state migration, release-safe API coverage, and CI pass. Shared storage keys reduce one migration risk; route URLs and deployments still need a planned cutover.
- **Before public production:** SSR/SEO strategy, accessibility review beyond automated checks, multi-university contract design, representative load profiling, and production error/telemetry behavior remain future decisions.

### Recommendation: CONDITIONAL GO

Continue React migration only after two concrete conditions: (1) profile and reduce comparison load time/duplicate release reads without weakening release-consistency guarantees, and (2) define the API identity and release model for multiple universities before claiming that capability. The three-screen POC establishes that the stack can preserve the current UI, use real API data, and support tested user state; it does not justify switching the whole production frontend yet.

## Final local commands

The intended reproducible commands are `npm ci`, `npm run api:check`, `npm run typecheck`, `npm run lint`, `npm run test:coverage`, `npm run build`, `npm run test:e2e`, and `npm run test:paired` from `apps/web-react-poc/`, plus the existing `apps/web/` test/build commands and the repository Python test/Ruff commands. Final backend and browser results are recorded above; the current final-head Actions status and PR/merge state are linked in the delivery record.
