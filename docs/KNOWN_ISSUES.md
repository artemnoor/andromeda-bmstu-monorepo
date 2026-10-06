# Known issues and next work

## Current limitations

- The installable parser set is intentionally a local-file subset. It does not
  crawl sites or create a complete normalized release bundle.
- The checked-in bundle has no raw source files. A handcrafted local HTML
  fixture is used to smoke-test one parser; that does not verify the parsers
  against the original official pages or PDFs.
- The existing curriculum PDF path and older BMSTU/HSE adapter layer depend on
  legacy public contracts absent from both supplied repositories. Those
  adapters are not in the active build. The safe normalized bundle already
  contains study-plan and curriculum rows, but parsing fresh documents needs
  the missing contract source or an explicit reviewed replacement.
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

- `uv sync --locked --all-packages --group dev --no-editable` completed. The
  non-editable install is required for this workspace on the current Windows
  path because editable workspace imports were not exposed reliably by Python
  3.11 under the Cyrillic user directory.
- `uv run --no-editable pytest -q` completed with **8 passed**. This includes
  offline bundle/parser checks and PostgreSQL integration checks against the
  disposable Compose database.
- A fresh database upgraded to Alembic head `de41afbb52c8`; `alembic check`
  reported no new upgrade operations. `academic-data db check` confirmed a
  PostgreSQL 16 server and the expected schema head.
- The CLI validated the checked-in bundle as valid, with **21,911 records**
  checked, zero errors, one warning, and SHA-256
  `42616ee9348ee009fa1b297f7ef697862134835e562c7840f413643ce71d2130`.
  Dry-run completed without writing to the database or accessing the network.
- The CLI committed release `a897c88a-9a3b-59bd-b563-3b055fe6fb42` to a fresh
  local test database. Repeating the commit returned `no_op`; the release ID
  and representative row counts remained unchanged. An injected failure before
  activation rolled back release writes, preserved the active pointer, and
  retained the failed batch audit record.
- The checked-in parser registry exposes only `catalog-html`, `catalog-api`,
  `program-card`, `admission-information`, and `tuition`. A hand-authored local
  HTML fixture passed the parser smoke check. This confirms local-file parsing
  only; it does not establish correctness against current official pages or
  PDFs and does not test crawling.
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
2. Restore or formally replace the missing shared parser contracts, then add
   local, safe fixtures for catalog, program cards, curriculum documents, and
   admission requirements.
3. Build a reviewed parser-to-bundle export step that preserves source evidence
   and exact keys; run validate and dry-run on its output before any database
   commit.
4. Specify the site/API read model and permissions only after product data
   ownership and the user-profile boundary are agreed.
