# Known issues and next work

## Current limitations

- Live capture is implemented but was not run against university sites. Tests
  use checked-in public fixtures only; a fixture pass does not establish that
  current live pages, redirects, or every document variant will parse.
- A reviewed parser snapshot is stored as a source observation. It is not
  automatically promoted into typed program, curriculum, admission, or
  statistics tables. Exact-key typed mappings and conflict handling remain
  separate work before fresh parsed facts can update those records.
- The checked-in normalized bundle still contains no raw source files. Redacted
  public HTML/JSON and curriculum PDF fixtures exist under `tests/fixtures/`
  solely for regression tests; raw live capture bodies belong under ignored
  `artifacts/`.
- User profiles, achievements entered by a user, exam scores, shortlist,
  olympiad benefits, authentication, recommendations, proftest, events, and
  venues are not part of the active schema. Their source implementations remain
  in the original repositories and need separate data ownership/mapping work.
- The bundle omits olympiad records and applicant-level competition-list
  rows. Historical statistics are aggregate observations and are not a full
  2026 passing-score dataset.
- The active importer requires PostgreSQL 16. The older `andromeda-data`
  README's PostgreSQL 13 requirement and its PostgreSQL 17 workflow apply to a
  different schema; this monorepo uses PostgreSQL 16 for both code and tests.

## Verification record

Verified locally on Python 3.11 and PostgreSQL 16:

- The non-editable install is required for this workspace on the current
  Windows path because editable workspace imports were not exposed reliably
  by Python 3.11 under the Cyrillic user directory.
- `uv sync --locked --all-packages --group dev --no-editable` completed, and
  `docker compose -f infra/compose.yaml up -d --wait` reported the disposable
  PostgreSQL 16 service healthy.
- `uv run --no-editable pytest -q`, with the test-only local database
  environment set, completed with **15 passed**. This includes offline
  ingestion/bundle tests and PostgreSQL importer commit, idempotency, and
  failure rollback checks.
- A fresh database upgraded to Alembic head `de41afbb52c8`; `alembic check`
  reported no new upgrade operations. `academic-data db check` confirmed a
  PostgreSQL 16 server and the expected schema head.
- The CLI validated the checked-in bundle as valid, with **21,911 records**
  checked, zero errors, one warning, and SHA-256
  `42616ee9348ee009fa1b297f7ef697862134835e562c7840f413643ce71d2130`.
  The separate importer dry-run completed without opening a database
  connection or accessing the network.
- The CLI committed release `a897c88a-9a3b-59bd-b563-3b055fe6fb42` to a fresh
  local test database. Repeating the commit returned `no_op`; the release ID
  and representative row counts remained unchanged. An injected failure before
  activation rolled back release writes, preserved the active pointer, and
  retained the failed batch audit record.
- The active parser registry exposes `catalog-html`, `catalog-api`,
  `program-card`, `admission-information`, and `tuition`. The fixture ingestion
  flow parsed six checked-in sources into 2 programs, 2 curricula, 101
  disciplines, and 212 curriculum items with zero source gaps. No live request
  was made; live behavior against current pages remains unverified.
- Candidate staging, explicit review, and importer dry-run passed in the
  ingestion tests. The reviewed fixture candidate carried the baseline's typed
  facts unchanged and added source-artifact/observation provenance only. No
  reviewed fresh candidate was committed to PostgreSQL.
- Separately, the unselected `andromeda-data` source schema was tested in its
  own disposable PostgreSQL 16 database: **13 passed**, with one pytest
  configuration warning. This is source-audit evidence, not coverage of the
  selected `academic-data` schema.

The checked bundle currently imports 53 directions, 77 departments, 152
educational programs, 127 offerings, 940 competition pools, 152 study plans,
14,165 curriculum items, 81 requirement sets, 405 requirement nodes, 311
admission statistics, 783 historical statistics, 498 source artifacts, 13,886
source evidence rows, 23,020 source observations, 3,478 source relationships,
and 560 manual-review items. Requirement nodes include 81 `AND`, 40 `OR`, and
284 leaf nodes without an operator.

Dry-run reports unresolved exact-key mappings for 6
`admission_statistic_direction` references and 49
`competition_pool_direction` references. The bundle also emits one validator
warning for 22 noncanonical manual-review keys. These are known coverage and
review items; successful import does not resolve them automatically.

## Next steps before the site

1. Decide the user-profile schema owner and map v1 user tables without coupling
   them to immutable academic releases.
2. Extend the checked public fixtures to cover more admission and source
   variants, and verify live-source behavior only under an explicitly approved
   operational window.
3. Add reviewed exact-key mappings from accepted parser observations into the
   supported typed datasets; run validate and dry-run before a database commit.
4. Specify the site/API read model and permissions only after product data
   ownership and the user-profile boundary are agreed.
