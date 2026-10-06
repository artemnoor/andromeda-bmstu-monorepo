# Phase 2 — Fixture-first capture and BMSTU CLI

## Goal and exact files

- Add `parsers/src/andromeda_parser/ingest.py` with typed operations:
  - `capture_sources(mode, fixture_dir, output_dir, fetch_config) -> CaptureReport`
  - `parse_capture(capture_dir, admission_year=2026) -> ParseReport`
  - `write_parse_report(report, output_path)`
- Extend `parsers/src/andromeda_parser/cli.py` to register
  `andromeda-bmstu ingest {capture,parse,stage,review,validate,dry-run,commit}`
  without changing existing `list` and single-file `parse` behavior.
- Add only public non-PII catalog/detail/API fixtures and public curriculum
  PDFs under `tests/fixtures/bmstu/ingestion/`; applicant lists remain
  untracked/external. Generate a tiny PDF in a unit test for PDF text
  extraction limits.
- Extend parser tests under `tests/` for fixture capture, parsing, fetch policy,
  PDF bounds, stable hashes, and no-network execution.

## Interfaces and behavior

- `capture` defaults to fixture mode. `--mode live` is explicit and required
  for any network request.
- Live fetcher config: `browser_mode="never"`; direct HTTP only; validated
  BMSTU and approved public-plan host allowlist; one request per configured
  interval (default at least 1 second); bounded retries/backoff; request
  timeout, overall budget, redirect count, and response-byte cap; PDF page and
  text limits from `PdfResourcePolicy`.
- Capture writes raw response bodies and a manifest only to ignored local
  `artifacts/` storage. The manifest records stable source key, requested and
  final URL, UTC capture time, status/content type, SHA-256, byte length, and
  raw storage status. `--output` cannot write under tracked `data/` by default.
- Parsing consumes a frozen capture directory and emits canonical JSON plus
  source gaps/diagnostics. It makes no network calls.
- Admission order/parser output is restricted to aggregate facts; applicant
  rows, names, IDs, or source list bodies are never serialized to output.
- Live mode is implemented but not invoked during tests or verification.

## Error handling and logging

- Fail closed on invalid URL, disallowed host/redirect, symlink/path escape,
  hash mismatch, oversized body/PDF, unsupported content, or parser contract
  errors. Record typed source gaps where the parser contract allows it.
- Verbose DEBUG logs include stage, safe source host/path, stable source key,
  attempt, status, byte count, content hash, elapsed time, and outcome. Strip
  query strings and redact token-like values. Never log response body, source
  text, PII, or auth headers.
- A failed source does not silently become an empty academic value.

## Tests and acceptance

- All capture/parse tests use fixture directories or an injected in-memory
  transport; no test reaches the network.
- Tests verify `browser_mode="never"`, host/redirect rejection, request
  interval, retry bounds, size limits, redaction, SHA-256, and source gaps.
- Representative BMSTU catalog/details and synthetic PDF extraction execute.
- Existing CLI parser tests continue to pass and the new subcommand help shows
  that live mode is opt-in.

Commands:

```powershell
uv run --no-editable --package andromeda-bmstu-parsers andromeda-bmstu ingest --help
uv run --no-editable pytest -q tests/test_bmstu_parser_cli.py tests/test_bmstu_ingestion.py
```
