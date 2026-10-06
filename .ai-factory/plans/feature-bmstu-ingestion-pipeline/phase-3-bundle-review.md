# Phase 3 — Candidate bundle, review gate, and safe publication

## Goal and exact files

- Add `parsers/src/andromeda_parser/bundle.py` with:
  - `build_candidate_bundle(base_bundle, parse_report, output_dir) -> CandidateReport`
  - `materialize_reviewed_bundle(candidate_dir, decisions_path, output_dir) -> BundleReport`
  - deterministic JSONL and CSV read/write helpers.
- Keep the current bundle as the base so a partial scrape cannot replace its
  existing release facts. Stage new parser output under a review-only candidate
  dataset that `project_bundle()` does not recognize; this makes an unreviewed
  candidate fail importer mapping closed.
- Candidate source artifacts use stable external keys and store source URL,
  capture time, response hash/status, and explicit raw storage policy. Do not
  add raw response files to an exported bundle.
- Serialize only the allowlisted safe canonical fields. Exclude applicant
  records, olympiad payloads, account/session content, and raw document bytes.
- Preserve base typed facts byte-for-byte and do not overwrite, fuzzy-match, or
  coerce null to zero/false. Automatic exact-key promotion and conflict
  detection remain future work because this phase preserves observations only.
- On explicit reviewer decisions, materialize accepted candidate data as
  source observations using the existing
  `admission_information_source_tables.jsonl` observation mapping, preserve all
  original datasets/requirement trees, and remove the review-only dataset so
  the existing importer can map the result. The first safe release stores
  reviewed source observations; it does not invent a new typed fact mapping.
- Add a candidate manifest with base/capture digests and source artifact keys,
  plus a review report with accepted/rejected outcomes. Typed-field conflict
  detection is deferred with typed fact promotion.

## Contracts and integration

- Candidate schema version is versioned separately from normalized bundle
  schema. Each row carries `external_key`, `source_artifact_key`,
  `candidate_type`, `payload`, and `review_state`.
- Review CSV requires exact `external_key`, `decision`, `reviewed_at`, and
  optional notes. Accepted values are enumerated; no wildcard approval.
- Review materialization validates all artifact references, stable key
  uniqueness, campaign identity, and source evidence before producing output.
- Run the current validator and mapper from the installed
  `academic_data_service`; do not fork validator/importer code.
- Existing current release data and `AND`/`OR`/`AT_LEAST` requirement trees are
  copied byte-for-byte unless a reviewed accepted observation is appended.

## Error handling and logging

- Reject missing/duplicate decisions, unexpected schema versions, unknown
  candidate fields, invalid hashes/URLs, unsafe paths, and candidate/base
  digest changes between read and write.
- Report unresolved exact links and conflicts as review items; never infer a
  target based on names or approximate codes.
- DEBUG events identify stage, digest, record count, exact key hash, and
  outcome. Do not log source payloads or reviewer notes that may contain
  personal information.

## Tests and acceptance

- Candidate creation is deterministic and source keys stable across repeated
  fixture runs.
- Candidate bundle validates but importer dry-run fails closed until reviewed.
- Reviewed materialized bundle validates and importer dry-run maps successfully.
- Tests prove the baseline's typed-record counts, source links, campaign IDs,
  and requirement trees survive materialization unchanged.
- Conflict/null/unresolved-link cases stay manual-review items and do not
  silently create typed facts.

Commands:

```powershell
uv run --no-editable pytest -q tests/test_bmstu_ingestion.py tests/test_offline_bundle.py
uv run --no-editable --package andromeda-academic-data-db academic-data bundle validate --input artifacts/bmstu-reviewed
uv run --no-editable --package andromeda-academic-data-db academic-data bundle import --input artifacts/bmstu-reviewed --dry-run
```
