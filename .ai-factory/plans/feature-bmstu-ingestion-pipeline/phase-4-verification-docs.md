# Phase 4 — Verification, CI, and factual documentation

## Goal and exact files

- Add focused tests in `tests/test_bmstu_ingestion.py` and extend
  `tests/test_bmstu_parser_cli.py` as needed.
- Extend `.github/workflows/ci.yml` only for parser dependency/import and
  fixture checks; retain PostgreSQL 16 validation, migrations, and importer
  integration tests.
- Update `README.md`, `docs/ARCHITECTURE.md`, `docs/MIGRATION_REPORT.md`,
  `docs/KNOWN_ISSUES.md`, and `docs/INGESTION_AUDIT.md` with actual
  capabilities, commands, fixture/source provenance, test results, and known
  gaps.
- Keep the original BMSTU-2026 export intact and add a deterministic
  per-file comparison summary for any produced candidate bundle.

## Verification matrix

1. Import every active parser and academic-data Python module.
2. Run parser unit fixtures: catalog HTML/API, program cards, admissions,
   tuition, PDF extraction, normalization, stable identities, source policy.
3. Validate the existing BMSTU-2026 bundle and the staged/reviewed candidate.
4. Run dry-run for the existing bundle and reviewed candidate without opening
   PostgreSQL.
5. Upgrade the disposable PostgreSQL 16 test database from a clean state and
   run all importer integration tests.
6. Commit to disposable PostgreSQL, repeat same digest, inject preactivation
   failure, and compare release IDs, typed table counts, provenance, and active
   pointer.
7. Compare generated results with the checked-in bundle, describing every
   count/hash/key difference and retaining all unresolved mapping warnings.
8. Run CI-equivalent commands locally. Do not run live acquisition.

## Error handling and documentation

- A failed check is recorded with command, exit status, and actual cause; never
  relabel skipped or source-only checks as passed.
- Update old issue text that says shared contracts are missing: audited
  contracts exist in the separate legacy monolith and are selectively restored.
- Keep actual remaining limits visible: no 2026 passing-score completeness,
  missing/blocked sources, unresolved exact references, no olympiad import,
  no raw documents, and first-stage candidate evidence rather than automatic
  typed-fact promotion.
- Describe live network mode as opt-in and explicitly state it is not exercised
  by CI.

## Acceptance

- The full local suite passes against disposable PostgreSQL 16.
- Validator and dry-run behavior is recorded with exact count/digest and warning
  details.
- Failure rollback leaves the previous active release unchanged.
- CI includes no credentials, source crawling, production DB, browser
  automation, or raw document upload.
- Public-content scan reports no secrets, applicant PII, raw closed documents,
  local paths, or build/cache artifacts in the staged commit.
