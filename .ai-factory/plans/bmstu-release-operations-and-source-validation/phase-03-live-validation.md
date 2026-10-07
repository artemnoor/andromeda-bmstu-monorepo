# Phase 3: Bounded live validation

Plan: [index.md](index.md)
Tasks: 5
Depends on: Phase 1 / Task 1; Phase 2 / Task 3

## Objective

Check a small, fixed sample of official public BMSTU pages, report source
coverage gaps, and compare only by exact keys with an exported release. Never
stage or publish facts from this probe.

## Implementation evidence

| Path | Implemented behavior |
|---|---|
| `parsers/src/andromeda_parser/probe.py` | Fixed-source read-only probe; 12-exchange transport cap including redirects; sanitized JSON report; no DB commit dependency. |
| `parsers/src/andromeda/ingestion/universities/bmstu/capture.py` | Supports a one-document limit for the selected public study-plan link so metadata containing several files cannot fan out. |
| `parsers/src/andromeda_parser/cli.py` | `andromeda-bmstu ingest probe --compare-bundle ... --release-id ... --output ...`. No arbitrary URL, credentials, selectors, or commit action. |
| `tests/test_bmstu_ingestion.py` | Request cap including redirects, query/share-key redaction, exact-only comparison, one-PDF selection, fixture and parser regression checks. |
| `docs/LIVE_VALIDATION.md` | Time-bounded findings and unresolved live-source gaps. |

## Task 5: Add selected-source live probes and a DB comparison report

The fixed probe requests catalog HTML, the first catalog API record, one
detail card selected by that API row, at most one associated plan/PDF, the
admission-information page, the order index metadata, and a linked
requirements PDF only if the selected page exposes one. It does not paginate,
enumerate order documents, or call the broad live capture.

The report records a UTC timestamp, source class, sanitized host/path, status,
response hash/size, parse counts, partial-coverage status, comparison release
ID/digest, and `publication=not_committed`. It omits response bodies, query
tokens, Yandex share keys, applicant rows, and credentials. Comparisons emit
only exact-key matches and actionable differences; parser rows without exact
keys and unmatched year identities are reported as gaps.

## Safety limits

- At most 12 actual HTTP exchanges including redirects; transport refuses any
  thirteenth request. The fixed source budget allows up to 12 fetch calls.
- One-second spacing, 10-second request timeout/budget, 30 MB response limit,
  one redirect maximum, zero retries, and no browser fallback.
- A 403, 429, timeout, parser error, or unsupported response is a source gap.
  There is no mirror fallback, cookie/session reuse, or access-control bypass.
- A study-plan response listing several downloadable items yields only one
  document plus an explicit gap for the unprobed documents.
- The probe reads a previously exported bundle and does not initialize the
  release commit engine. Live findings remain outside the database.

## Verification and outcome

- Mocked HTTP tests passed for the actual-exchange cap, query/share-link
  redaction, exact-key comparison, and one-document selection.
- A real bounded run on 2026-10-07 used 8 fetch calls / 10 HTTP exchanges.
  Seven response records were captured; there were no 403/429 responses and
  no live facts were staged or committed.
- Catalog API, one card, one plan PDF, admission information, and the orders
  index parsed. The HTML catalog returned no recognized links; 113 curriculum
  rows lacked exact keys; 154 tuition keys were unmatched; no safe places/quota
  table or requirements PDF was found in this sample.
- The isolated PostgreSQL 16 test release ID and digest remained active.

See [LIVE_VALIDATION.md](../../../docs/LIVE_VALIDATION.md) for the dated
details and [INGESTION_OPERATIONS.md](../../../docs/INGESTION_OPERATIONS.md)
for the repeatable command.
