# Phase 2: Diff and moderation

Plan: [index.md](index.md)
Tasks: 3–4
Depends on: Phase 1 / Tasks 1–2

## Objective

Compare parser candidates with the active-release bundle using exact external
keys, report source coverage, and reduce repeat review without risking partial
data or unverified links.

## Implementation evidence

| Path | Implemented behavior |
|---|---|
| `parsers/src/andromeda_parser/moderation.py` | Exact-key classifications, safe-field eligibility, JSON/CSV reports, review-template, rejected-candidate replay. |
| `parsers/src/andromeda_parser/bundle.py` | Materializes only exact reviewed typed destinations and persists review/rejection history in the importer bundle. |
| `parsers/src/andromeda_parser/cli.py` | `ingest diff`, `review-template`, `review`, and `remoderate`. |
| `tests/test_bmstu_ingestion.py` | Exact-key conflicts, partial omissions, unchanged exclusion, bulk allowlist, actor/source/value journal, reject/re-review. |

## Task 3: Exact-key diff and partial-source safety

The diff classifies staged candidates as `new`, `changed`, `unchanged`,
`conflicting`, or `unreviewed`. It includes exact target, changed fields,
source identity/artifact/hash, moderation state, provenance status, and reason.
Matching is case-sensitive `external_key` equality; candidate source keys and
similar names never become destination keys automatically.

Captures are partial by default. A missing current row is reported as
`potentially_removed` only when the candidate manifest explicitly declares a
dataset complete. It remains report-only. Other absence is identified in the
report coverage as `unobserved_partial`; no database deletion is implied.

## Task 4: Conservative group review and audit

The review template omits verified unchanged candidates entirely, so they do
not need another decision or audit event. It pre-fills changed candidates only
when their exact target/provenance are verified and changed fields are within
the allowlist: source locator/URL/retrieval metadata, or a historical
statistic `finality_note`. Academic values such as scores, tuition, dates,
curriculum, requirements, places, and quotas remain individual review.

Each explicit decision writes an append-only `review_decisions.jsonl` event
into the reviewed bundle. The release archive preserves reviewer, UTC time,
decision, candidate and exact target keys, source artifact key/SHA, payload,
and payload hash. Rejected payloads are preserved and can be reopened; earlier
rejection events remain. These decisions are archive-backed, not exposed as a
standalone SQL event table or query endpoint.

## Verification

- `uv run pytest -q tests/test_bmstu_ingestion.py tests/test_offline_bundle.py`
- Full candidate fixture validates/maps after review; a new or conflicting
  source target cannot be bulk accepted.
- Tests assert partial omission never deletes, unchanged candidates are absent
  from the review CSV/event journal, and rejected items can be explicitly
  re-reviewed.

See [INGESTION_OPERATIONS.md](../../../docs/INGESTION_OPERATIONS.md) for the
actual CLI sequence and [KNOWN_ISSUES.md](../../../docs/KNOWN_ISSUES.md) for
review-journal storage limits.
