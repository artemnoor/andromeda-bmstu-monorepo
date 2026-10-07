# Phase 1: Source identity and bounded validation

Plan: [index.md](index.md)
Tasks: 1-2
Depends on: none

## Objective
Close source identity gaps where the official document supports deterministic identity, keep unsupported data unresolved, and repeat the official source check within the existing probe limits.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|---|---|---|
| `parsers/src/andromeda/ingestion/universities/bmstu/parser/campaign_2026/curricula/parser.py` | `parse_curriculum_document`, `_parse_pdf` | Parses selected PDF rows but currently returns no importer external key. |
| `parsers/src/andromeda/ingestion/universities/bmstu/parser/curriculum.py` | `_study_plan_records` | Shared PDF row extraction, including source positions and locators. |
| `parsers/src/andromeda/ingestion/universities/bmstu/parser/campaign_2026/tuition/parser.py` | `parse_cost_page`, `_year_key` | Emits a noncanonical year-unspecified key when no year is known. |
| `parsers/src/andromeda_parser/probe.py` | `run_live_probe`, exact-key comparison and request budget | Existing official-source bounded probe and sanitized report writer. |
| `tests/fixtures/bmstu/ingestion/curriculum_*.pdf` | two saved PDF fixtures | Real local inputs for deterministic identity and duplicate regression tests. |
| `docs/LIVE_VALIDATION.md` | 2026-10-07 report | Records 113 unkeyed curriculum rows, 154 year-unspecified tuition rows, catalog mismatch, and aggregate source gaps. |

## Files to Change

| Path | Action | Required change |
|---|---|---|
| `parsers/src/andromeda/ingestion/universities/bmstu/parser/campaign_2026/curricula/parser.py` | modify | Attach importer-compatible exact identity using the resolved plan key and stable official row identity; preserve the PDF locator and evidence. |
| `parsers/src/andromeda/ingestion/universities/bmstu/parser/campaign_2026/tuition/parser.py` | modify | Emit canonical rows only when the owning official section proves a direction and academic year; retain other rows as pending observations. |
| `parsers/src/andromeda/ingestion/universities/bmstu/parser/campaign_2026/catalog/parser.py` | modify only if the fixture supports a safe fix | Otherwise mark HTML as fallback/deferred and document the API as primary based on observed responses. |
| `parsers/src/andromeda_parser/probe.py` | modify | Compare new parser identities, report source gaps, and preserve hard network bounds. |
| `tests/test_bmstu_ingestion.py`, `tests/test_bmstu_parser_cli.py` | modify | Cover repeat parse, facts changed at stable identity, duplicate protection, year identity, and source gaps. |
| `tests/fixtures/bmstu/ingestion/source_manifest.json` | modify only if fixture bytes change | Preserve original source_sha256; update capture digest independently. |

## Task 1: Add stable curriculum-item identity

### Intent
Give each extracted curriculum row an exact key so the existing diff/review/importer can update a fact at that identity without matching similar names.

### Implementation Steps
1. Inspect the two checked-in PDF fixtures and the full row extraction structure. Identify the exact selected program profile, plan key fields, page/table/row locator, and whether a real official discipline code is present. Do not assume the code exists.
2. Resolve one importer-compatible study-plan external key from the same exact program-card/profile identity used by the adapter and the official study-plan document identity. If the academic year is missing in the PDF, use the exact selected source-plan URL/document identity already stored in provenance; do not synthesize an academic year.
3. Define row identity as the exact plan key plus the global order of parsed data rows. The printed row number can repeat across semesters, so retain it as provenance rather than identity. Do not include subject title, hours, semester, or assessment form in the identity, because these are candidate facts that must be diffed. Never use title similarity to join rows.
4. Emit keys in the existing importer convention `curriculum_item:<study-plan-external-key>:row:<global-position>` and verify exact compatibility against the checked-in base bundle.
5. Preserve source PDF artifact SHA-256, requested/final URL, page/table/row locator, extracted quote, and parser version through existing provenance structures.
6. Add fixture tests that parse the same bytes twice and compare keys; mutate subject name, hours, semester, and assessment on the same row and assert the key is unchanged; append a new row and assert it gets the next deterministic key; ensure repeated printed row numbers remain distinct.

### Required Interfaces and Contracts
- Every canonicalizable item includes a nonempty exact external key and a plan association resolved from the selected exact source profile.
- Subject title, hours, semester, and assessment are updateable values, not fuzzy identity. Global parsed row position is the current exact identity convention.
- If plan identity or provenance is insufficient, emit a source gap and no importer key.
- Same input bytes and parser version produce identical ordered keys; repeat parsing does not create a duplicate.

### Error Handling and Logging
- Log successful parse summary at INFO with source kind, plan key, row count, and identity gap count.
- Log invalid/missing identity at WARNING with stable error code and sanitized source URL; never log query/share tokens, full row text, or applicant data.
- A missing exact plan key makes the affected document noncanonicalizable.

### Tests
- Parse both checked-in curriculum PDFs twice; assert stable keys and no duplicate keys.
- Change only subject title, hours, semester, and assessment in a normalized row; assert exact key stability and changed fact values.
- Add one row at the end and assert it gets the next external key; preserve distinct keys for repeated printed row numbers.
- Assert provenance source key/hash/locator remains connected to the original PDF.
- Run `uv run pytest -q tests/test_bmstu_ingestion.py tests/test_bmstu_parser_cli.py`.

### Acceptance Criteria
- Real local PDF fixtures produce stable importer-compatible keys on repeat parse.
- Four specified mutable facts can change without creating a false new record.
- A new row gets the next deterministic positional identity, and repeated printed row numbers remain distinct.
- No title-only matching is used.

### Verification
- `uv run pytest -q tests/test_bmstu_ingestion.py tests/test_bmstu_parser_cli.py`
- Expected result: existing parser tests and new exact-identity regressions pass.

## Task 2: Resolve tuition, catalog, and bounded live gaps

### Intent
Promote only source-backed facts and update the existing live report based on a new limited official-source sample.

### Implementation Steps
1. Inspect the saved admission-information HTML fixture and current parser selectors. Trace year heading to its exact containing tab/panel, table, and rows. Do not infer year from current date, URL, or campaign conventions.
2. Update `parse_cost_page` so canonical tuition requires an exact direction code and explicit academic-year interval attached to that same official section. Use the canonical model's supported year key. Return rows without a proven year as pending source observations containing raw cells, source URL, table/row locator, and a reason; do not place them in canonical tuition records or assign a year-unspecified canonical key.
3. Check the official HTML catalog once through the bounded probe. If it contains no stable links while the official catalog API returns rows, label HTML client-rendered/unsupported fallback and API primary. Fix HTML extraction only if saved public markup contains stable links and a regression fixture demonstrates it.
4. Probe one official program/card and the existing public admission information page for exams, aggregate seats, quotas, campaign dates, and statistics. Inspect only aggregate summary content and metadata. Do not fetch applicant result/order file bodies. Keep any unsupported field as an explicit source gap.
5. Keep the live-probe hard maximum at 12 HTTP exchanges including redirects; no more than one catalog row, one program/detail, one plan/PDF, one admission page, and one aggregate metadata/index check. Retain official-host allowlist, 10-second timeout, no retries after 403/429, minimum one-second spacing, response-body cap, URL/query redaction, and no live DB writes.
6. Compare values only by exact external key. Write a sanitized report with probe timestamp, exchange count, HTTP outcomes, current-release comparison counts, parser identity status, and explicit unresolved gaps.

### Required Interfaces and Contracts
- Tuition parser returns distinct canonical records and pending observations. A row without explicit year never has a canonical tuition external key.
- Catalog source registry/report names the official API as primary only when observed successful; HTML is fallback/deferred based on captured response evidence.
- Exam, seat, quota, and deadline facts require official public aggregate evidence plus exact program/campaign identity.
- Live output remains an uncommitted observation/report; it never changes the active release.

### Error Handling and Logging
- HTTP 403/429 is terminal for that host/source, recorded as a sanitized source gap, no retry.
- Timeout, parser error, missing year, unconfirmed mapping, or budget exhaustion yields a gap, not a guessed canonical value.
- Log source identifier, status, response byte count, and remaining budget only; redact credentials, share tokens, and queries.

### Tests
- Add tuition fixture cases for explicit year in the owning section, absent year, malformed year, and multiple year sections.
- Assert absent/malformed year yields pending source gap and no canonical key.
- Assert exact code/year keys are stable and accepted by the canonical tuition mapper.
- Assert the no-link HTML catalog fixture does not imply an empty catalog; API fixture is the observed primary route.
- Assert unconfirmed exam/quota data is not emitted and the probe does not request applicant-level files.
- Run parser tests, then one documented bounded live probe and inspect its sanitized report.

### Acceptance Criteria
- Only a proven academic year yields canonical tuition identity; uncertain rows stay pending.
- Catalog API/HTML status and aggregate gaps reflect actual observed responses.
- Repeat probe stays within the exchange budget, does not publish results, and records current DB release unchanged.

### Verification
- `uv run pytest -q tests/test_bmstu_ingestion.py tests/test_bmstu_parser_cli.py`
- Run the documented capped probe command; expected result is one sanitized report and unchanged active release ID/digest.

## Phase Risks and Mitigations
- Risk: an upstream PDF reorders rows, shifting positional identities. Mitigation: compare only exact keys, preserve row-level PDF provenance, and send resulting additions/changes for review; never remap by similar titles.
- Risk: an admission page has multiple year scopes. Mitigation: attach year only to the exact containing official section; otherwise keep pending.
- Risk: live markup changes again during implementation. Mitigation: record response and timestamp; stop on 403/429/budget rather than broadening the probe.

## Phase Completion Checklist
- Task 1 and Task 2 acceptance criteria pass.
- The new live probe is sanitized, bounded, and did not alter an academic release.
- Update Task 1-2 checkboxes in `index.md` only after verification.
