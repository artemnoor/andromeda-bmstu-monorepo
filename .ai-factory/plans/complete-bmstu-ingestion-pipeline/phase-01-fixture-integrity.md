# Phase 1: Fixture integrity

Plan: [index.md](index.md)
Tasks: 1
Depends on: none

## Objective

Keep the fixture bytes that are parsed and hashed identical on Windows and Linux, reconcile sanitized fixture hashes and the deterministic capture digest, and preserve upstream source hashes.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|------|-----------------|----------------|
| `tests/fixtures/bmstu/ingestion/source_manifest.json` | `snapshots[].content_sha256`, `snapshots[].source_sha256` | Separates the sanitized checked-in bytes from the upstream-source digest. |
| `tests/fixtures/bmstu/ingestion/*.html` | `common.html`, `catalog.html`, `detail.html` | GitHub's LF checkout currently disagrees with the CRLF worktree bytes. |
| `parsers/src/andromeda/ingestion/universities/bmstu/capture.py` | `BmstuSource._load_fixture` | Rejects any fixture whose byte hash differs from `content_sha256`. |
| `parsers/src/andromeda_parser/ingest.py` | `_capture_digest`, `capture_sources` | Computes the digest recorded by deterministic ingestion tests. |
| `tests/test_bmstu_ingestion.py` | `test_checked_in_source_fixtures_are_redacted_with_hash_provenance`, `test_fixture_capture_and_parse_are_offline_and_reproducible` | Existing checks prove the regression and expected capture output. |

## Files to Change

| Path | Action | Required change |
|------|--------|-----------------|
| `.gitattributes` | create or modify | Set deterministic LF handling for HTML/JSON fixtures and mark PDF fixtures binary under `tests/fixtures/bmstu/ingestion/`. |
| `tests/fixtures/bmstu/ingestion/source_manifest.json` | modify | Update only sanitized fixture `content_sha256` fields and associated fixture metadata if required; do not change any `source_sha256`. |
| `tests/test_bmstu_ingestion.py` | modify | Assert stable source hashes, byte hashes, and the newly computed capture digest. |

## Task 1: Make fixture hashes checkout-stable and reproduce the capture digest

### Intent

Make the fixture parser contract portable instead of relying on a local Git autocrlf setting.

### Implementation Steps

1. Add scoped Git attributes for fixture HTML/JSON with `text eol=lf` and for PDF with `-text`; leave other repository files under their existing policies.
2. Stage those HTML files under the new attributes, then read the staged bytes with `git show :<path>` and compute SHA-256 from those exact bytes.
3. Update each affected `content_sha256` to the staged body hash. Leave every `source_sha256` string byte-for-byte unchanged.
4. Run fixture capture and parsing, record the resulting `source_capture_digest`, and update the deterministic test expectation and documentation references to the old digest.
5. Verify the manifest remains valid UTF-8 JSON and its own line-ending policy is stable.

### Required Interfaces and Contracts

- `source_sha256` describes the original upstream response and is immutable in this fix.
- `content_sha256` describes the sanitized fixture bytes read by the parser.
- `source_capture_digest` is derived by the existing `_capture_digest` function from the actual captured fixtures; do not hand-compose it.

### Error Handling and Logging

- Fixture hash mismatch remains a hard contract error; do not add a fallback that silently normalizes input before hashing.
- Use DEBUG logging only for safe source key/hash/count fields; never log fixture body content.

### Tests

- Verify every snapshot's on-disk SHA-256 equals `content_sha256`.
- Verify `source_sha256` values equal the pre-change values.
- Verify the capture/parse test reaches six or more expected local sources with no network calls and reproduces one stable digest.
- Verify `git ls-files --eol` and a clean re-checkout/index read show no platform conversion for the protected HTML fixtures.

### Acceptance Criteria

- The original failing GitHub Actions fixture tests pass on the Linux runner.
- Repeated fixture capture returns the same digest on Windows and Linux.
- Upstream source hashes are unchanged.

### Verification

- `uv run --no-editable --all-packages pytest -q tests/test_bmstu_ingestion.py -k 'fixture_capture or checked_in_source_fixtures'`
- `git ls-files --eol tests/fixtures/bmstu/ingestion`
- Expected result: both targeted tests pass and HTML fixtures are stored/checked out without text conversion.

## Phase Risks and Mitigations

- Risk: changing `.gitattributes` after the initial commit does not rewrite existing blob bytes by itself. Mitigation: stage the fixture bodies with the attributes active and verify their staged SHA-256 values before updating the manifest.
- Risk: stale capture digests remain in docs/tests. Mitigation: search the entire tracked repository for the old digest and replace only references that describe this checked-in fixture set.

## Phase Completion Checklist

- Task 1 satisfies all acceptance criteria and hash invariants: seven local snapshots reproduce capture digest `dedc5d2731b78a285c42bfdcdf85d6e8e6634d729a1a975ecd7d7f00b0145afc`; the six original `source_sha256` values pass regression assertions.
- Git attributes report `eol=lf` for HTML/JSON and `text=unset` for PDFs; the full fixture suite passes from the rebuilt non-editable install and Linux verification remains part of the pending GitHub Actions run.
- `index.md` is updated only after successful verification.
