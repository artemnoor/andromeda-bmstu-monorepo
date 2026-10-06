# Phase 2: Typed materialization and review

Plan: [index.md](index.md)
Tasks: 2–3
Depends on: Phase 1 / Task 1

## Objective

Promote explicitly reviewed parser facts through the existing bundle datasets and importer, while preserving exact identities, source provenance, unknown values, conflicts, and valid facts omitted from partial captures.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|------|-----------------|----------------|
| `parsers/src/andromeda_parser/ingest.py` | `parse_capture`, `_assert_safe_payload`, `write_parse_report` | Produces the canonical BMSTU parser report and capture provenance. |
| `parsers/src/andromeda/ingestion/contracts/raw.py` | `RawProgramRecord` | Detail parsing currently drops the department/chair identity that is present in the source card. |
| `parsers/src/andromeda/modules/programs/contracts/public.py` | `Program` | Canonical program contract is the existing path for carrying exact department code/name into staging. |
| `parsers/src/andromeda/ingestion/universities/bmstu/parser/tracer.py` | `_parse_detail` | Parses program cards and can retain the enclosing chair's official code/title. |
| `parsers/src/andromeda/ingestion/universities/bmstu/normalizers/canonical.py` | `normalize_bundle` | Converts raw programs and provenance to the public canonical form. |
| `parsers/src/andromeda/ingestion/universities/bmstu/parser/campaign_2026/admission_information/parser.py` | `parse_admission_information` | Extracts aggregate historical admission outcomes from a checked-in local page fixture. |
| `parsers/src/andromeda_parser/bundle.py` | `build_candidate_bundle`, `materialize_reviewed_bundle`, `validate_import_bundle` | Current review flow stores one whole parser snapshot as an observation and blocks import until review. |
| `academic-data/src/academic_data_service/importer/mapping.py` | `DATASET_MAPPING_REGISTRY`, `_Projection`, `project_bundle` | Existing importer maps validated bundle datasets into typed release rows and evidence bridges. |
| `academic-data/src/academic_data_service/importer/bundle.py` | `validate_bundle` | Validates row contracts, exact references, and dataset inventory. |
| `academic-data/src/academic_data_service/infrastructure/database/catalog_models.py` | programs, departments, courses, plans, curriculum | Existing typed catalog schema. |
| `academic-data/src/academic_data_service/infrastructure/database/admission_models.py` | offerings, exams, requirements, places, tuition, statistics | Existing typed admission schema. |
| `tests/fixtures/bmstu/admission-information.html` | official aggregate admission table fixture | Existing local fixture exercises a real historical statistic without applicant rows. |

## Files to Change

| Path | Action | Required change |
|------|--------|-----------------|
| `parsers/src/andromeda_parser/ingest.py` | modify | Keep normalized facts and per-field source provenance available to the staging layer. |
| `parsers/src/andromeda/ingestion/contracts/raw.py` | modify | Retain optional exact department code/title from each enclosing BMSTU chair. |
| `parsers/src/andromeda/modules/programs/contracts/public.py` | modify | Carry optional department code/title in canonical `Program` records. |
| `parsers/src/andromeda/ingestion/universities/bmstu/parser/tracer.py` | modify | Extract only chair code/title; do not copy member names or contacts. |
| `parsers/src/andromeda/ingestion/universities/bmstu/normalizers/canonical.py` | modify | Preserve department identity through normalization without name-based joins. |
| `tests/fixtures/bmstu/ingestion/admission_information.html` | create from existing local fixture | Include the existing safe 406-byte aggregate-only admission sample in fixture capture. |
| `tests/fixtures/bmstu/ingestion/source_manifest.json` | modify | Add that local source fixture with exact body provenance. |
| `parsers/src/andromeda_parser/bundle.py` | modify | Generate typed candidates, validate explicit target keys, apply accepted sparse updates, and retain untyped observations. |
| `parsers/src/andromeda_parser/cli.py` | existing interface; no change | Existing `ingest stage/review/validate/dry-run/commit` commands already expose the guarded workflow; the review command consumes exact per-fact decisions. |
| `academic-data/src/academic_data_service/importer/mapping.py` | modify only if needed | Extend only existing registry mappings where current typed contracts cannot consume a supported parsed fact. |
| `tests/test_bmstu_ingestion.py` | modify | Cover typed facts and manual review behavior on checked-in source fixtures and base bundle rows. |

## Task 2: Materialize reviewed parser facts into existing typed bundle datasets

### Intent

Make accepted normalized output usable by existing release tables instead of storing it only in `source_observations`.

### Implementation Steps

1. Define a typed-candidate projection from the canonical report to the existing bundle contracts. Cover populated structures for universities/directions, departments, programs, study plans, catalog courses/curriculum items, campaigns and offerings, exams and requirement trees, quota/place assertions, tuition, and current/historical admission statistics.
2. Use the existing normalized fact `id`/external key as the source identity. Carry exact source-artifact key, body hash, original source hash when available, URL, capture time, and locator into the bundle evidence fields.
3. Resolve parser references only through explicit source-to-bundle external-key links. A source program code may be used as a conflict check but never as an automatic fuzzy identity link. Reject missing or ambiguous required references.
4. Retain the chair's official code/title on canonical programs, derive a department candidate under the exact `department:bmstu:<code>` key, and stage the program-department relationship using the existing `relationships.jsonl` contract.
5. Parse only aggregate `historical_results` from the checked-in admission-information fixture into `historical_admission_statistics.jsonl`; keep raw table/page text out of the candidate payload.
6. Add one deterministic review candidate for each typed record plus the canonical snapshot observation. Keep raw source observations for audit; do not put captured response bodies or applicant rows in the bundle.
7. On explicit acceptance, materialize only rows that pass the importer bundle validator and dry-run mapper. Preserve all unrelated dataset rows and their byte content.
8. Map only values actually present in parser output. Do not turn absent fields into `null`, zero, empty arrays, or removals.

### Required Interfaces and Contracts

- Candidate review is keyed by a deterministic candidate `external_key`; accepted links name an exact existing target key or an exact new key. Each typed fact has its own decision.
- Supported target datasets remain importer-recognized files, including `educational_programs.jsonl`, `departments.jsonl`, `study_plans.jsonl`, `courses.jsonl`, `curriculum_items.jsonl`, `exams.jsonl`, `admission_exam_requirements.jsonl`, `program_offerings.jsonl`, `competition_pools.jsonl`, `tuition.jsonl`, `historical_admission_statistics.jsonl`, and `admission_statistics.jsonl`.
- Each typed row includes or resolves to source artifact provenance that the existing importer turns into source evidence/bridges.
- A typed row with a required unknown target or invalid reference is not silently downgraded to a different target table; it stays in review or causes validation failure.

### Error Handling and Logging

- Reject malformed parser payloads, unsupported typed candidate kinds, unsafe applicant/olympiad fields, duplicate review keys, invalid decisions, unresolved exact links, and mapping conflicts.
- Record conflicts in manual review with source keys and safe provenance; do not choose a source by order or overwrite an existing fact.
- DEBUG logs may contain dataset name, candidate key, source key, decision, and digest only. Do not log payload text, PII, query tokens, or raw response data.

### Tests

- Parse the checked-in catalog/detail/API/PDF fixtures and the checked-in `admission_information.html` fixture offline; assert populated department/program/curriculum/historical-statistic candidates become valid typed bundle rows after explicit review.
- Assert typed datasets include deterministic provenance and the source observation remains present.
- Assert no decision, reject, or unreviewed decision cannot materialize a typed row.
- Assert importer `project_bundle` and dry-run accept the reviewed bundle and report nonzero typed counts for the populated mapped entities.

### Acceptance Criteria

- The reviewed fixture path creates actual importer-mapped typed rows in the applicable existing tables, including programs, plans/curriculum, courses/disciplines, and aggregate statistics.
- Any candidate categories not present in the fixture report remain absent and are not fabricated; existing typed base categories continue to validate and import.
- Existing academic ORM/migrations remain the sole database schema.

### Verification

- `uv run --no-editable --all-packages pytest -q tests/test_bmstu_ingestion.py`
- `uv run --no-editable --all-packages academic-data bundle validate --input <reviewed-fixture-bundle>`
- `uv run --no-editable --all-packages academic-data bundle import --input <reviewed-fixture-bundle> --dry-run`
- Expected result: candidate review succeeds, the importer validates all typed rows, and dry-run opens no database connection.

## Task 3: Enforce exact-key review, provenance, conflict, and partial-snapshot safety

### Intent

Make every typed mutation deliberate and prevent incomplete or conflicting observations from erasing correct data.

### Implementation Steps

1. Define review decisions for accept, reject, and explicit exact-key link/update; reject duplicate decisions and targets that do not exist when an update was requested.
2. Before applying an update, require the target bundle row's `external_key` to match the reviewed target exactly and validate any source-to-target relationship against exact related keys.
3. Merge only keys present in the reviewed patch. Treat `None` as an unknown observation unless the fact contract explicitly represents a source-confirmed null; retain the old value otherwise.
4. Add new facts only when their exact key is unused and the validated bundle/importer confirms no natural-key or foreign-key conflict. If another exact key owns the same constrained identity, add a conflict review item and stop the conflicting promotion.
5. Never delete a base row because it is absent from a capture. Require a separate explicit, provenance-backed withdrawal contract before any deletion; this task does not implement deletion.
6. Recompute the validator report, file hashes, and candidate manifest after materialization. Keep every accepted/rejected decision auditable.

### Required Interfaces and Contracts

- Review rows identify `candidate_external_key`, `decision`, `reviewed_at`, and when linking/updating, `target_external_key`.
- Exact target lookup is a direct dictionary lookup on the bundle's `external_key`; no case folding, code/name similarity, fuzzy matching, or first-match fallback.
- A fact update that changes no values is reported as unchanged and leaves canonical bundle data identical.
- Source provenance is additive. Updating a typed value does not delete prior provenance or unrelated source evidence.

### Error Handling and Logging

- Fail before writing output if decisions are incomplete, conflicting, invalid, or point to a different target than the candidate contract permits.
- Preserve the original candidate bundle on any materialization error by writing to a new/temporary output and atomically replacing only after validation succeeds.
- Redact URL query strings and credential-like content at DEBUG level.

### Tests

- Exact source key to exact target key accepted; similar-but-not-exact key rejected.
- A source program with a chair maps to a typed department and exact program-department relationship; member names and contacts are absent from the candidate.
- Two sources with different values for the same target produce a conflict and do not change the target row.
- Missing fields and missing records in a partial snapshot preserve previous values/rows byte-for-byte.
- Sparse explicit update changes only named fields and retains old provenance plus new evidence.
- Rejected/unreviewed candidate and invalid review file leave the source bundle untouched.

### Acceptance Criteria

- No typed mutation occurs without a valid manual decision.
- The only update target is an exact approved external key.
- Unknown or incomplete facts are retained as observations/review items without clearing typed values.
- Conflict and partial-source scenarios preserve all previously valid data.

### Verification

- `uv run --no-editable --all-packages pytest -q tests/test_bmstu_ingestion.py -k 'review or conflict or partial or exact_key'`
- Expected result: safe acceptance cases pass; all ambiguous, incomplete, and conflicting cases fail closed without changing base files.

## Phase Risks and Mitigations

- Risk: parser and academic bundle identities differ. Mitigation: require explicit exact-key mapping in review; use codes only to detect collisions, never to auto-link.
- Risk: a typed projection could silently omit source evidence. Mitigation: require an artifact reference for every promoted row and verify the generated importer evidence counts.
- Risk: broad table data exceeds local fixture coverage. Mitigation: promote only populated parser facts, retain empty facts as unknown, and use the checked-in baseline bundle to verify all existing typed table contracts.

## Phase Completion Checklist

- Tasks 2 and 3 satisfy their acceptance criteria and pass all focused tests.
- `index.md` is updated only after successful verification.
