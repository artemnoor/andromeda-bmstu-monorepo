# Phase 2: Reconciliation and review integration

Plan: [index.md](index.md)
Tasks: 3
Depends on: Phase 1 / Tasks 1-2

## Objective

Use the active-release bundle as the matching baseline, retain legacy keys for proven matches, and show ambiguous or missing source rows through the existing diff/review path.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|------|-----------------|----------------|
| `parsers/src/andromeda_parser/bundle.py` | `_build_typed_candidates`, `build_candidate_bundle`, `materialize_reviewed_bundle` | Candidate targets currently come from parser-internal item IDs; the builder already reads and copies the active-release-compatible bundle and materializer supports an explicit reviewer target. |
| `parsers/src/andromeda_parser/moderation.py` | `_conflicting_candidate_keys`, `compare_candidate_bundle` | Current diff is exact-key-only and supports changed/new/conflicting plus whole-file potential removals. |
| `parsers/src/andromeda_parser/probe.py` | `_compare_exact_keys`, `probe_official_sources` | Bounded live probe currently compares direct parser keys, independent from normal candidate reconciliation. |
| `academic-data/src/academic_data_service/importer/mapping.py` | `add_curriculum_items` | Importer already maps `chair` and `source_row`; `source_row` is currently hardcoded to null for curriculum items. |
| `docs/INGESTION_OPERATIONS.md` | exact-key review instructions | Review decisions are exact-key, actor/timestamp recorded, and rejected candidates can be reviewed again. |

## Files to Change

| Path | Action | Required change |
|------|--------|-----------------|
| `parsers/src/andromeda_parser/bundle.py` | modify | Resolve the exact base study plan, reconcile source rows to current canonical curriculum rows, preserve old targets, add new identity metadata and locator, and stage unresolved rows with no prefilled review target. |
| `parsers/src/andromeda_parser/moderation.py` | modify | Classify explicit identity state as `ambiguous` and report plan-scoped `potentially_removed` keys without deleting rows. |
| `parsers/src/andromeda/ingestion/universities/bmstu/parser/campaign_2026/curricula/parser.py` | modify | Emit stable source identity keys and explicit ambiguous observation keys; retain source position and printed row only in locator. |
| `parsers/src/andromeda_parser/probe.py` | modify | Reconcile the bounded live rows against the exact plan in the comparison release using the shared resolver, not a raw positional key join. |
| `academic-data/src/academic_data_service/importer/mapping.py` | modify | Persist the existing `source_row` JSON metadata into the existing JSONB column. No migration. |

## Task 3: Reconcile active-release curriculum keys through diff and review

### Intent

Make consecutive updates safe without renaming or rewriting any existing canonical external key. Ensure both online bounded comparison and the standard candidate workflow use the same exact matching rules.

### Implementation Steps

1. In `build_candidate_bundle`, load base `study_plans.jsonl` and find a unique current plan by exact profile code plus education year. If none or multiple exist, do not match curriculum rows across plans; stage them as ambiguous/new candidates for individual review.
2. Load only base curriculum rows whose `curriculum_key` equals that exact plan external key. Invoke the shared resolver with normalized items, chair code, optional block/part, semester, printed row, and existing external keys.
3. For a proven one-to-one match, set the candidate's `suggested_target` and payload `external_key` to the existing legacy/current canonical key. Persist `source_row.identity` with the resolver version and exact signature; persist locator separately.
4. For an unambiguous new row, use the deterministic identity hash key. For rename, collisions, repeated titles that cannot be disambiguated, or uncertain plan identity, stage a unique observation candidate, label it `ambiguous`, leave the decision target blank, and include exact candidate old keys as reviewer hints. Never prefill a similar-name target.
5. Attach source artifact SHA-256, retrieval timestamp, document URL, page, printed row, parsed position, and semester to every item candidate. Keep PDF SHA and locators out of canonical key material.
6. Extend `compare_candidate_bundle` to report `ambiguous` explicitly and validate plan-scoped completeness metadata. Add `potentially_removed` only for old keys in the exact plan scope; leave base rows in the candidate bundle untouched.
7. Keep conflicting source rows at the existing exact target classified `conflicting`. Existing review materialization remains the only way to map an ambiguous observation to an old key; its actor, time, target, and payload remain in the audit journal.
8. Update the bounded probe to use the same resolver and report exact, changed, new, ambiguous, and potentially removed counts; do not refetch live sources as part of unit tests.

### Required Interfaces and Contracts

- Candidate manifest supports an optional `complete_scopes` list restricted to `{dataset: "curriculum_items.jsonl", field: "curriculum_key", value: <exact study-plan external key>}`. It never declares the whole 14,165-row dataset complete for one PDF.
- Candidate row metadata includes `identity_status`, `source_identity_key`, and `identity_candidate_keys`; these fields stay outside importer fact payload except the versioned `source_row` evidence.
- `materialize_reviewed_bundle` accepts an ambiguous row only with an explicit reviewer decision and exact `target_external_key`. It rewrites the typed row key to that explicit target and records the existing decision event.
- `add_curriculum_items` persists `source_row` JSONB from the importer-compatible bundle. Existing rows with no metadata remain valid and use the compatibility matcher.
- Direct probe reads the canonical base data and exact plan. If exact reconciliation cannot prove a match, it reports the row for review instead of claiming a match.

### Error Handling and Logging

- Invalid scope shape, duplicate plan identity, conflicting candidate targets, or absent review target fails closed with a safe `IngestionError`.
- DEBUG logs report exact plan key, matched/new/ambiguous/missing counts, and resolver version. WARN logs report ambiguous locator IDs and conflict counts, not full source content.
- Partial or parser-error curriculum capture declares no complete scope. It cannot produce deletion behavior.

### Tests

- Candidate/diff tests cover legacy-key preservation, changed fields, inserted new row, ambiguous rename, duplicate-source conflict, scoped removal, and partial source with no removals.
- Materialization tests explicitly target an old `row:<n>` key and prove the candidate bundle keeps that key and its provenance.
- Probe comparator unit test uses the saved 113-row release slice; no live HTTP request.
- Commands: `uv run pytest -q tests/test_curriculum_identity.py tests/test_bmstu_ingestion.py`.

### Acceptance Criteria

- Reorder and inserted rows do not create a mass diff; every proven old row keeps its exact canonical key.
- A removed row is only `potentially_removed` in a complete exact-plan scope and remains in the bundle until a separate reviewed deletion workflow exists.
- A changed name or repeated ambiguous title is never auto-merged; reviewer target must be explicitly set.
- Source hash, retrievability metadata, locator, and accepted identity signature survive candidate materialization and importer mapping.
- Both bounded probe and candidate workflow call the same resolver.

### Verification

- `uv run pytest -q tests/test_curriculum_identity.py tests/test_bmstu_ingestion.py`
- Expected result: legacy key targets, review gating, scoped omission classification, and source evidence round-trip all pass.

## Phase Risks and Mitigations

- Risk: an apparently exact title may denote two different entries. Mitigation: exact plan scope, exact chair where available, one-to-one multiplicity check, semester disambiguation only for duplicate groups, and explicit ambiguity on collisions.
- Risk: review accepts a renamed item under a second key. Mitigation: no default target for ambiguous rows; show possible old keys and require reviewer to choose the exact existing target.
- Risk: a parser omission is mistaken for a removal. Mitigation: only exact, successfully parsed PDF plan scopes are marked complete; diff remains non-destructive and partial failures produce no scope.

## Phase Completion Checklist

- Candidate and probe use the same active-release resolver.
- Old keys are preserved where exact evidence proves the match.
- Ambiguous and potentially removed statuses are machine-readable and non-destructive.
- No API, Directus, database schema, or release lifecycle changes were made.
