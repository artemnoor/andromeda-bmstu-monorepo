# Phase 1: Evidence and source contracts

Plan: [index.md](index.md)
Tasks: 1-2
Depends on: none

## Objective

Define a conservative, deterministic source identity contract and expose enough exact source evidence for both the direct PDF probe and ordinary candidate builder to use it. Keep old release keys and database schema intact.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|------|-----------------|----------------|
| `parsers/src/andromeda/ingestion/universities/bmstu/parser/campaign_2026/curricula/parser.py` | `_attach_exact_identity` | Current live parser assigns global `row:<position>` keys and records source SHA, printed row, semester, and URL. |
| `parsers/src/andromeda/ingestion/universities/bmstu/parser/curriculum.py` | `_study_plan_records`, `_pdf_layout_text` | Extracts name, chair abbreviation, printed row number, semester, workload, and control. It does not expose an official discipline code or block value; fixture PDFs have page form-feeds and `Б1`/mandatory/variable headings. |
| `parsers/src/andromeda/ingestion/contracts/raw.py` | `RawCurriculumRow`, `SourceLocator` | Raw row now retains parsed position, printed row number, page, chair abbreviation, and structural labels independently. |
| `parsers/src/andromeda/modules/curricula/domain/entities.py` | `CurriculumItem`, `Curriculum.validate_identity` | Internal ID is name-hash + semester; duplicate discipline/semester rows are rejected after `_append_curriculum_item` merges them. |
| `parsers/src/andromeda/ingestion/universities/bmstu/normalizers/canonical.py` | `normalize_bundle`, `_append_curriculum_item` | Creates parser-internal IDs and currently combines same-name/same-semester observations, which can hide a real duplicate. |
| `academic-data/src/academic_data_service/infrastructure/database/catalog_models.py` | `CurriculumItemModel.source_row` | Existing JSONB column can retain source identity metadata without a migration. |

## Files to Change

| Path | Action | Required change |
|------|--------|-----------------|
| `parsers/src/andromeda/ingestion/universities/bmstu/curriculum_identity.py` | create | Pure resolver, exact normalization, deterministic identity key, one-to-one matching, ambiguity hints, and scoped missing-row results. |
| `parsers/src/andromeda/ingestion/contracts/raw.py` | modify | Preserve source page, parser order, printed row, chair abbreviation, and parsed structural block/part when available. |
| `parsers/src/andromeda/ingestion/universities/bmstu/parser/curriculum.py` | modify | Retain page markers and block/part context as source metadata; keep those fields out of canonical identity except as exact disambiguation evidence. |
| `parsers/src/andromeda/ingestion/universities/bmstu/parser/tracer.py` | modify | Populate raw row source metadata without changing workload/control parsing. |
| `parsers/src/andromeda/modules/curricula/domain/entities.py` | modify | Carry exact source metadata and explicit ambiguous state; permit same title/semester only when every colliding row is marked ambiguous. |
| `parsers/src/andromeda/ingestion/universities/bmstu/normalizers/canonical.py` | modify | Stop merging duplicate observations; mark and retain them for review. |

## Task 1: Add the conservative curriculum identity resolver

### Intent

Make identity decisions reusable by parse output, candidate staging, and the bounded probe. Position must not affect canonical keys. No source ID is invented.

### Implementation Steps

1. Add `normalize_curriculum_label` using the existing lossless normalization convention: Unicode NFKC, case-fold, and collapse whitespace only; keep punctuation, qualifiers, and `ё` distinctions.
2. Add `reconcile_curriculum_rows(plan_key, incoming_rows, current_rows, complete_scope)` returning one resolution per input plus candidate ambiguity hints and unmatched current keys. Require exact plan key equality before considering any row match.
3. Match exact identity only when one-to-one: exact normalized title plus exact chair code where available. Ignore hours, credits, assessment, parsed order, and source SHA. If that exact title/context appears multiple times, use exact semester only to disambiguate unique pairs; do not infer which duplicate moved when semester differs.
4. Create new stable keys as `curriculum_item:<exact-plan-key>:identity:<sha256>` over canonical JSON of exact normalized title, exact chair/block signals, and semester only when needed to disambiguate a duplicate title group. Detect collisions and return `ambiguous`, never suffix by order.
5. For a title that does not match exactly, compute optional bounded similarity suggestions for reviewer display only. Do not set an automatic target from a suggestion. Return `ambiguous` only when a plausible old record exists; otherwise return `new`.
6. Emit `potentially_removed` only for old keys in a declared complete exact-plan scope. Partial scope returns no removal classifications.

### Required Interfaces and Contracts

- New pure result contract: each incoming row yields `{status, canonical_external_key, source_identity_key, suggested_existing_keys, reason}`. Status is one of `matched`, `new`, `ambiguous`, or `conflicting`.
- The report separately returns exact old keys absent from a complete plan as `potentially_removed`; it never mutates or deletes input rows.
- `study_plan_key` is exact and required. Empty/multiple plan resolution yields `ambiguous` for every incoming row.
- Source identity metadata is JSON-safe and versioned (`bmstu-curriculum-identity-v1`). It does not contain PDF hash, source row number, or order as canonical identity material.

### Error Handling and Logging

- Reject malformed external keys and duplicate current external keys with a typed identity error; do not guess.
- DEBUG logs may contain the plan key, identity algorithm version, row counts, exact match counts, and status counts. Do not log full PDF text or applicant data.
- WARN logs identify ambiguous collisions by plan key and source locator only; titles and source URLs are not required in logs.

### Tests

- Add pure-function tests in `tests/test_curriculum_identity.py` for exact normalization, source key stability, exact one-to-one matching, duplicate title/semester handling, fuzzy hint-only behavior, invalid plan identity, and partial versus complete scope.
- Commands: `uv run pytest -q tests/test_curriculum_identity.py`.

### Acceptance Criteria

- Reordering or inserting an unrelated row does not change an exact identity signature.
- Hours/control changes do not affect the signature; unique-title semester changes do not affect the signature.
- Similar title alone never yields `matched`; duplicate competing rows yield `ambiguous`.
- Complete scope reports missing keys, while partial scope leaves them unclassified and all input records unchanged.

### Verification

- `uv run pytest -q tests/test_curriculum_identity.py`
- Expected result: all new resolver cases pass; test output confirms zero identity assignment by source position or similarity.

## Task 2: Preserve identity signals, duplicate rows, and source locators

### Intent

Carry the resolver's exact evidence from the official PDF through raw parsing and domain normalization. Preserve repeated source observations for human review instead of merging them.

### Implementation Steps

1. Extend `RawCurriculumRow` with optional chair abbreviation, `course_block`, `source_page`, `printed_row_no`, and `parsed_position`; keep parsed position separate from the printed row locator.
2. In `_study_plan_records`, retain the PDF form-feed page number while scanning. Track exact `Б1` block and `Обязательная часть` / `Вариативная часть` labels as source metadata; do not treat those labels or page/row as a stable item identifier.
3. Extract the chair abbreviation already detected before the workload columns and pass it through `tracer.py`. Keep page null if a parser implementation cannot reliably determine it.
4. Add those source metadata fields and an `identity_status` (`exact` or `ambiguous`) to the parser-domain `CurriculumItem`. Keep the existing discipline name hash for internal taxonomy identity; it is not the importer canonical key.
5. Change `_append_curriculum_item` so repeated `(discipline_id, semester)` rows are retained as separate items and both marked `ambiguous`; do not merge hours or assessment values. Relax curriculum validation only for duplicate pairs where every item is explicitly ambiguous.
6. Preserve source locators as `{page, printed_row_no, parsed_position, semester}` in candidate provenance; keep source document SHA-256 and retrieval timestamp from the existing source artifact.

### Required Interfaces and Contracts

- No SQL schema or Alembic migration is added. The existing `CurriculumItemModel.source_row` JSONB stores versioned exact identity metadata and source locator when a typed candidate is accepted.
- Keep API DTO and immutable release contracts unchanged; source locator remains evidence metadata.
- Duplicate parser-internal IDs are not emitted as canonical external keys. Candidate staging must add a unique source-observation candidate identity derived from the exact locator and capture, mark it ambiguous, and require a reviewer target.

### Error Handling and Logging

- If page/block extraction is absent or malformed, retain null/unknown source metadata and continue parsing; never infer from neighboring text.
- Duplicate collision emits WARN with plan/profile, semester, and count. It does not collapse values.
- Parsing remains deterministic and bounded; no browser or network work is introduced.

### Tests

- Unit tests build two exact same-name/same-semester raw rows with distinct locators and assert both survive as ambiguous.
- Fixture tests assert page, printed row, and parsed position are provenance only and the source PDF SHA stays unchanged.
- Commands: `uv run pytest -q tests/test_bmstu_ingestion.py -k 'curriculum or pdf'`.

### Acceptance Criteria

- The two real fixture PDFs retain their current parsed row counts and never lose provenance.
- Duplicate same-name/same-semester rows are preserved but not automatically assigned a canonical identity.
- Existing unique curriculum rows continue to validate and normalize.

### Verification

- `uv run pytest -q tests/test_bmstu_ingestion.py -k 'curriculum or pdf'`
- Expected result: the source locator and no-merge cases pass without changing any fixture bytes or original source hashes.

## Phase Risks and Mitigations

- Risk: page separator handling shifts line indices. Mitigation: retain content order and run both fixture PDFs before proceeding; page is locator metadata only.
- Risk: duplicate retention affects a Pydantic uniqueness invariant. Mitigation: allow duplicates only when every colliding item is explicitly ambiguous; assert unique external candidate IDs later.

## Phase Completion Checklist

- Task 1 resolver signatures and statuses are implemented and independently tested.
- Task 2 preserves parser source evidence and refuses duplicate merges.
- The two PDF fixtures still parse at their established counts.
