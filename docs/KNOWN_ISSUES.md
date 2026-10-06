# Ingestion status and known limits

## Working path

The supported update path uses the existing components:

`local capture -> parser -> candidate bundle -> explicit review -> typed bundle -> validator/mapper -> PostgreSQL release`

The fixture path is offline and deterministic. Seven sanitized snapshots cover
the catalog, program details, API data, two public curriculum PDFs, university
identity, and one aggregate admission outcomes table. `.gitattributes` pins
HTML/JSON fixture checkout bytes to LF. The fixture `content_sha256` values and
capture digest describe those bytes; the six original upstream
`source_sha256` values remain pinned separately.

The candidate builder can produce rows for the existing typed datasets:
universities, directions, departments, educational programs, study plans,
curriculum items, exams, admission requirements, program offerings,
competition pools (including supported place/quota facts), tuition assertions,
current and historical statistics, and source relationships. It also retains
reviewed observations and source-artifact provenance. The selected schema has
no separate discipline table, so parsed curriculum disciplines map to
`curriculum_items`.

Typed candidates remain pending until a reviewer chooses `accept_typed_fact`
and supplies the exact destination `external_key`. Suggested keys are aids for
review only. Source/candidate keys never silently become destination IDs.
Candidate conflicts for the same exact target fail closed. Accepted sparse
updates preserve omitted fields; `null` values do not erase stored values;
rejected or missing rows do not delete base facts. Materialization keeps the
full normalized base bundle and is validated by the existing mapper before it
can be committed.

The PostgreSQL 16 integration test exercises an actual changed aggregate
admission statistic from the checked-in fixture, its source evidence,
successful release activation, repeat-import `no_op`, rollback before
activation, and recovery to a baseline-equivalent release. Other typed
categories are exercised through candidate materialization and importer
dry-run. CI runs the full unit and PostgreSQL integration suite using the same
local fixture corpus.

## Current limitations

- No live source capture or mass parsing was run. Current production-page
  markup, redirects, completeness, and every document variant remain
  unverified. Fixture-mode commands make no network calls.
- The fixture corpus is a regression sample, not a complete current admission
  campaign. It has only two program/curriculum examples and one aggregate
  statistic. Passing-score coverage is not complete.
- A tuition amount is promoted only when its source also provides a usable
  academic year and exact campaign identity. The current parser fixtures do
  not establish a new year-valid price, so they do not prove fresh tuition
  assertions are persisted.
- Facts that cannot be represented by existing typed datasets, or whose exact
  direction/program/funding/quota/campaign link is not confirmed, remain
  observations or rejected candidates. Program-scope places without a
  supported exact destination are not forced into a direction-level pool.
- Current imports retain the existing bundle's unresolved exact references
  and manual-review items. A successful release does not resolve those
  pre-existing gaps automatically.
- Applicant-level competition rows and personal data, olympiad records,
  achievements supplied by users, profiles, auth, recommendations, events,
  and venues are outside this ingestion scope. Applicant PII and raw captures
  are excluded from committed bundles.
- The active academic importer requires PostgreSQL 16. No schema migration or
  new service was added for this work.

## Verification record

Verified locally on Python 3.11 and PostgreSQL 16:

- `uv sync --locked --all-packages --group dev --no-editable` completed.
- `uv run --no-editable --all-packages pytest -q --tb=short` completed with
  **17 passed in 223.22 seconds** from the rebuilt non-editable workspace
  packages. The PostgreSQL lifecycle case parsed a real
  local fixture, committed a reviewed typed statistic update with source
  evidence, returned `no_op` on repeat, rolled back an injected activation
  failure, and activated a baseline-equivalent release afterward.
- The fixture capture digest is
  `dedc5d2731b78a285c42bfdcdf85d6e8e6634d729a1a975ecd7d7f00b0145afc`.
  Manifest tests verify all sanitized content hashes and all six original
  upstream `source_sha256` pins. `git check-attr` reports `eol=lf` for HTML and
  JSON and `text=unset` for PDFs.
- The checked-in bundle validates as **21,911 normalized records**, zero
  errors, one warning, digest
  `42616ee9348ee009fa1b297f7ef697862134835e562c7840f413643ce71d2130`.
  Baseline importer dry-run completed with `outcome=dry_run` and zero network
  requests. Candidate review tests also materialize and map accepted typed
  records without opening a database connection.
- The local PostgreSQL service reports server major version **16**, schema
  revision `de41afbb52c8`; migration upgrade, database check, and Alembic
  autogenerate check succeeded. The parser registry lists `catalog-html`,
  `catalog-api`, `program-card`, `admission-information`, and `tuition`.
- The documented CLI path completed with the checked-in fixtures: capture
  (7 snapshots), parse, stage, one explicitly reviewed historical statistic,
  validate, dry-run, and PostgreSQL commit. No live source was used.
- The first GitHub Actions run exposed that the Ubuntu runner lacked the
  existing parser's `pdftotext` dependency. After adding `poppler-utils`, run
  [`37531892896`](https://github.com/artemnoor/andromeda-bmstu-monorepo/actions/runs/37531892896)
  completed with **success** for implementation SHA `491ea6f4fbb047607529b260d03156211bef6020`.
  All CI steps passed, including bundle validation/dry-run, migration checks,
  and the full PostgreSQL 16 test suite.
- The plan/result commit `aa79e58f5a4a600999b4dc5375fdd5104c3d597d` was also
  green on its matching head SHA in
  [Actions run 37532464710](https://github.com/artemnoor/andromeda-bmstu-monorepo/actions/runs/37532464710).

The baseline before this follow-up had been verified separately with 15
passing tests. The figures below describe the checked-in baseline bundle, not
the newly reviewed fixture release.

The checked-in baseline bundle contains 53 directions, 77 departments, 152
educational programs, 127 offerings, 940 competition pools, 152 study plans,
14,165 curriculum items, 81 requirement sets, 405 requirement nodes, 311
admission statistics, 783 historical statistics, 498 source artifacts, 13,886
source evidence rows, 23,020 source observations, 3,478 source relationships,
and 560 manual-review items.

The baseline bundle's validator and importer dry-run are separate checks. A
dry-run does not open a database connection. PostgreSQL commits are restricted
to the test database in integration tests; release activation occurs only
after row reconciliation succeeds inside one transaction.
