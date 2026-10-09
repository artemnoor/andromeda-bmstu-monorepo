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

The implemented app and feature source has 26 TypeScript, TSX, and CSS modules (about 7,121 lines, excluding generated build output and unused starter placeholders). The existing frontend has 65 tracked files across nine HTML screens, shared assets, scripts, data, and tests. Counts describe the current repository and are not a measure of implementation quality by themselves.

## Verification results

Results below are from the final local source state before delivery. Generated browser artifacts are retained locally under the ignored `apps/web-react-poc/artifacts/` and `test-results/` paths; CI uploads the paired report and browser failure artifacts.

| Area | Result |
|---|---:|
| React POC unit/component tests | 53 passed across 9 files; coverage run passed |
| React POC coverage | Statements 53.57%, branches 41.71%, functions 48.21%, lines 56.68% |
| React POC Playwright E2E | 48 passed across Chromium, Firefox, and WebKit (16 tests per browser, including live API, navigation, comparison, accessibility, and quota-scope checks) |
| Paired original-versus-React QA | 25 passed: 24 screen/viewport comparisons and one repeated benchmark (five measured runs per app/scenario) |
| Existing vanilla frontend unit tests | 23 passed |
| Existing vanilla frontend Playwright E2E | 229 passed, 41 skipped by the configured browser matrix (axe checks outside Chromium, symlink cases, and screenshot checks outside Chromium) |
| Existing vanilla production build | Passed |
| React POC typecheck, lint, OpenAPI drift check, production build | All passed |
| Backend full pytest / repository Ruff | 118 passed, 1 skipped, 1 warning; `ruff check .` passed |
| GitHub Actions / PR | Pending delivery |

Coverage is the measured Vitest V8 coverage for the React POC unit/component suite; route-level and browser behavior is additionally covered by E2E but is not folded into those percentages. The independent review confirmed release consistency, accessibility coverage, corrected mobile geometry, and independently verified chart arithmetic against live API rows and taxonomy. Its follow-up audit found that a target pool's `offering_keys` can represent a broad direction relation across campuses. Program cards now fail closed for direction-and-organization pools when the API provides no verified campus identity or exact program association; both the unit regression and live PostgreSQL-backed browser regression pass. Separate review findings on modal focus containment and shared-header coverage were fixed on the home screen and catalog/comparison header; browser tests verify that both close controls are within their dialog and focus wraps/restores correctly. The final independent re-review found no remaining P0–P2 implementation issues.

## Visual comparison

The paired suite ran original and React pages in Chromium using identical isolated FastAPI/PostgreSQL data, browser state, reduced motion, and viewport. It captured the home page, catalog with 152 live programs, empty comparison, and populated comparison at 1920×1080, 1440×900, 1280×800, 768×1024, 390×844, and 375×667. Browser document width matched the viewport in every case; no horizontal overflow was detected. Catalog program count and ordering matched at all six sizes.

| Screen | Pixel difference range across six viewports | Page-height difference |
|---|---:|---:|
| Home | 0–0.01% | 0% |
| Catalog | 0% | 0% |
| Empty comparison | 0.29–0.84% | 0–0.26% |
| Populated comparison | 4.87–9.73% (semantic-masked: 4.80–9.60%) | 1.39–2.10% |

The comparison screen’s remaining pixel delta is concentrated in longer source/provenance text and narrow-screen wrapping. A small exact mask covers category/value cells where the original renders `0` but the API-backed React view correctly preserves unknown data as `—`; the raw pixel result is reported alongside the masked value. The mask does not cover layout, chart geometry, labels, row boundaries, or page height. The populated 390px screen is the largest remaining difference at 9.73%, below the paired test’s 10% threshold. Visual similarity is strong, but this is not a claim of pixel identity.

The final fix matched the original category-table 620px breakpoint and header geometry. Regression assertions cover narrow mobile row widths/heights and matrix placement. Earlier stale paired artifacts were avoided by making the paired runner perform a production build before capture.

## Defects found and fixed

| Severity | Component | Root cause | Fix and regression |
|---|---|---|---|
| P1 | Admission quota mapping | `direction_and_target_organization` pools were attributed to program cards through direction-wide `offering_keys`; the API does not expose verified campus identity or relationship evidence for these pools. This could show Kaluga-branch target places on a Moscow program. | Keep these broad pools out of program-level quota lists, even when their current pool-to-offering keys overlap an exact program offering. Preserve source campus labels for safely linked offering-scope pools and explain that unconfirmed broader data is not attributed to a program. Unit and live API/PostgreSQL browser regressions cover the cross-campus relation. |
| P2 | Comparison responsive table | The React category table used a 380px breakpoint where the original uses 620px; its header wrapper also differed. | Match the original breakpoint/header geometry and assert row width/height across paired viewport captures. |
| P2 | Admission offer summary | An exact offering with a known duration but unknown study form hid the form field entirely. | Render “Форма обучения: не указана” and cover it with a unit regression. |
| P2 | Home and shared navigation modal | Each menu focus trap included its close button while that button sat outside the `aria-modal` dialog subtree; the homepage and shared header also use separate menu implementations. | Put each open-state close button inside the corresponding dialog shell, keep the closed-state opener outside, and restore focus after the dialog closes. E2E tests exercise both implementations, including keyboard wrapping and Escape restoration in all three browser engines. |

The initial live-test premise that a direction-and-organization pool should appear on any program in its direction was rejected after inspecting the seed: it contains both main-campus and branch rows, while the DTO exposes no verified campus identity. The replacement browser regression proves that the branch row stays off a Moscow program card even when the pool has a broad link to one of that program's exact offerings.

## API and data behavior

The application uses the existing read-only `/api/v1` routes through one generated-contract-backed adapter. Live browser tests exercised `/release`, `/programs`, `/directions`, `/departments`, `/study-plans`, `/study-plans/{key}/items`, `/subject-taxonomies/{key}/{version}`, `/campaigns`, `/campaigns/{key}/offerings`, `/campaigns/{key}/calendar`, `/competition-pools`, `/place-quotas`, `/tuition`, `/statistics`, and `/requirements`; the routes used in the seeded read flows returned 200. The generated OpenAPI drift check confirms the client types still match the backend spec. Pagination follows returned cursors; response collections are checked for release identity. Data from different active releases fails closed rather than being composed silently. API failure remains an error state and does not switch the app to demo JSON.

Catalog search, direction/department filtering, admission details, favorites, add/remove comparison, reload persistence, and the two-program live comparison were exercised through the browser. The comparison E2E independently obtains plan rows and taxonomy from FastAPI, calculates category hours in the test, and checks the SVG segments and matrix associations. Nullable and unknown values stay unknown; a linked admission offering with no stated study form displays “Форма обучения: не указана”. Known numeric zero remains distinct from missing data. Target quota pools whose campus and program relationship cannot be verified remain unassigned to a program card; the current API lacks a normalized campus identity and relationship-evidence field for those direction-wide rows.

The current backend contract does not expose a university identity/scope on programs and directions. This prototype therefore demonstrates the current BMSTU contract and does not claim multi-university operation. Multi-university joins and release selection across universities need an explicit backend contract before that product capability can be implemented.

## Performance experiment

Measurements used production builds of both apps, Chromium, a 1440×900 viewport at device scale factor 1, a local PostgreSQL-backed FastAPI release, HTTP cache disabled and cleared before each measured navigation, one warm-up per app/scenario, then five measured runs. Each pair used the same requested scenario and browser environment. Values below are medians; navigation p95 is shown in parentheses. “Ready” ends at the measured screen readiness condition. Catalog rows beyond the actual live set were synthetic clones used only to stress client rendering and filtering; they are not academic data validation. The 500-program React scenario’s lower total loading time but slower local filter action is visible in the measurements and should not be overgeneralized.

| Scenario | Vanilla ready ms (p95) | React ready ms (p95) | Vanilla action ms (p95) | React action ms (p95) | API requests, V/R | JS transferred bytes, V/R | Total transferred bytes, V/R | Resources, V/R |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Home | 122.2 (127.4) | 149.2 (161.0) | — | — | 0 / 0 | 23,213 / 119,170 | 3,059,547 / 3,116,152 | 5 / 11 |
| Catalog, 50 rows | 313.4 (319.0) | 388.7 (393.8) | 28.2 (28.7) | 29.9 (31.8) | 3 / 5 | 60,743 / 132,065 | 968,235 / 962,070 | 12 / 19 |
| Catalog, 100 rows | 417.7 (486.9) | 419.8 (470.7) | 46.4 (58.2) | 42.8 (66.9) | 3 / 5 | 60,743 / 132,065 | 1,137,187 / 1,131,022 | 12 / 19 |
| Catalog, 500 rows | 1,040.5 (1,068.7) | 732.7 (741.9) | 114.1 (142.3) | 156.2 (160.3) | 7 / 9 | 60,743 / 132,065 | 2,489,959 / 2,483,194 | 16 / 21 |
| Compare, two live programs | 1,454.5 (1,467.3) | 2,454.8 (2,462.4) | — | — | 15 / 21 | 60,743 / 141,070 | 2,533,280 / 2,576,540 | 23 / 34 |

The additional React requests include active-release and cursor consistency checks; these counts alone do not establish N+1 behavior. Route-level data composition and repeated release guards are candidates for optimization while retaining fail-closed consistency. Transferred JavaScript is materially larger in the POC: about 5.1× on home, 2.2× on catalog, and 2.3× on comparison. The two-program comparison ready time is about 1.69× the vanilla median and is the clearest performance issue to address before broader migration. At 500 synthetic rows React reached the page-ready condition faster, while filtering was about 28% slower; this single setup is not evidence that one stack is broadly faster.

Median long-task count was zero in all scenarios. Median CLS was 0 for vanilla home/catalog, 0.03 for React catalog, 0.09 for vanilla comparison, and 0 for React comparison. Chromium `performance.memory.usedJSHeapSize` returned the same 10 MB in every sample, so it was not a useful comparative memory measure. No cross-browser performance claim is made; the Firefox and WebKit results are functional E2E only.

## Architecture assessment

| Criterion | Existing vanilla frontend | React prototype |
|---|---|---|
| Startup JavaScript transferred | 23,213 bytes (home), 60,743 bytes (catalog/compare) | 119,170 bytes (home), 132,065 bytes (catalog), 141,070 bytes (compare) |
| Shared API integration | Existing `academic-data.js` adapter and endpoint behavior | One typed OpenAPI-backed API adapter, generated schema, runtime validation and release guards |
| Application code shape | 65 tracked files across nine pages and shared scripts/assets | 29 app/src TypeScript/TSX/CSS modules for the three POC routes |
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

The intended reproducible commands are `npm ci`, `npm run api:check`, `npm run typecheck`, `npm run lint`, `npm run test:coverage`, `npm run build`, `npm run test:e2e`, and `npm run test:paired` from `apps/web-react-poc/`, plus the existing `apps/web/` test/build commands and the repository Python test/Ruff commands. Final backend and local browser results are recorded above; GitHub Actions, PR, and merge status are recorded after delivery.
