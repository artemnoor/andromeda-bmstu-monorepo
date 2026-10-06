<!-- aif:plan-mode:ultra -->

# BMSTU source ingestion and release pipeline

## Original request

See [the exact supplied goal and expanded requirements](request.md).

## Settings

- Mode: ultra
- Tests: required by the user
- Documentation: required by the user
- Logging: Verbose — DEBUG detail, with redacted URLs and no response bodies/secrets
- Roadmap linkage: none; no roadmap exists in this repository
- Git: enabled; work on `codex/bmstu-ingestion`; publish the completed result to a new public repository only after local verification
- Source repositories: read-only; no writes or pushes to original repositories
- Data scope: BMSTU only; HSE stays inactive; no applicant PII or raw closed documents
- Campaign scope: preserve explicit admission campaign/year keys; never mix campaigns

## Requirements reconciliation

| Requirement | Evidence/decision | Planned result |
|---|---|---|
| Use existing academic schema and atomic importer | `docs/INGESTION_AUDIT.md`; current importer is already tested and has no proven defect | Keep schema/migrations/importer unchanged unless a failing integration check proves otherwise |
| Recover useful BMSTU parser functionality | Legacy BMSTU source adapter and its required runtime support | Selectively restore source, contract, parser, and normalizer modules; exclude legacy ORM/API and broken optional visualizer helper |
| Reproducible offline path | Real upstream fixture test passed locally; current repo has unit fixture test | Fixture mode is default for tests and writes deterministic source hashes |
| Explicit live source mode | Existing fetcher supports timeout/retry/allowlist, but default browser fallback is too broad | Opt-in direct HTTP mode with strict BMSTU/source-host allowlist, request spacing, limits, bounded retries, and DEBUG logging; no browser fallback or anti-bot bypass |
| Candidate review, normalized bundle, import | Existing bundle validator rejects unknown import mappings; import activation is atomic | Stage candidates separately, require explicit review/materialization before import, preserve baseline typed facts and source evidence, then use existing validate/dry-run/commit commands |
| Stable keys, provenance, conflicts, unknown values | Current bundle uses exact external keys and evidence; source parsers expose hashes/locators/gaps | Preserve exact source identity and provenance; null unknown facts; log unresolved links/conflicts as review items |
| Admissions structures | Current importer supports AND/OR/AT_LEAST; bundle has 81 trees, no AT_LEAST tree | Keep tree operators and campaign identity without flattening; test operators and publish only verified structures |
| No loss/atomic activation | Existing PostgreSQL tests cover same-digest idempotency and failure-before-activation rollback | Re-run full disposable PostgreSQL suite and compare before/after active release and typed row counts |
| Public repository | User explicitly asked for a new public GitHub repo and upload | Create a new unique public repo under `artemnoor` and push verified `main`; do not change `andromeda-prod` remote |

## Architecture

```text
official BMSTU source URLs OR checked-in/local fixtures
  -> bounded direct-HTTP capture / local fixture reader
  -> hashed capture manifest + local ignored raw bodies
  -> upstream BMSTU raw parser and canonical normalizer
  -> sanitized, review-gated candidate bundle based on the current BMSTU-2026 bundle
  -> existing validator -> existing dry-run mapper -> explicit review -> existing importer
  -> immutable release transaction -> atomic active-release pointer
```

The capture layer never writes to PostgreSQL. Raw capture bodies stay outside
the Git index; the exported candidate contains only source hashes, URLs,
timestamps, safe parsed data, and review metadata. Tests never use live mode.
HSE and olympiad publication are not active paths.

## Phase index

| Phase | File | Deliverable | Depends on |
|---|---|---|---|
| 1 | [phase-1-source-contracts.md](phase-1-source-contracts.md) | Selective BMSTU source/contracts closure and pinned dependency set | Audit complete |
| 2 | [phase-2-capture-cli.md](phase-2-capture-cli.md) | Fixture-first capture/parse CLI, direct HTTP live mode, redacted verbose logging | Phase 1 |
| 3 | [phase-3-bundle-review.md](phase-3-bundle-review.md) | Stable candidate bundle builder, review barrier, baseline preservation, importer-compatible materialization | Phase 1, Phase 2 |
| 4 | [phase-4-verification-docs.md](phase-4-verification-docs.md) | Unit/integration/CI checks and factual documentation | Phases 1–3 |
| 5 | [phase-5-publication.md](phase-5-publication.md) | New public GitHub repository with verified project contents | Phase 4 |

## Cross-phase dependencies and decisions

1. Source capture supplies immutable bodies and provenance; parser tests only
   consume local fixtures.
2. Parser normalization must finish before bundle staging. Staging uses exact
   keys only and must preserve the checked-in release snapshot.
3. Review/materialization runs before `academic-data bundle import --dry-run`.
   An unreviewed candidate must not be accepted as a canonical release.
4. `academic-data` validation/dry-run/commit behavior remains the publication
   contract. No parallel importer or schema is introduced.
5. Public GitHub creation/push is the final external action, after secret/PII/raw
   document checks and the full local verification run.

## Task inventory

1. Compute and copy only the BMSTU adapter's dependency closure; omit legacy
   services, ORM, FastAPI endpoints, HSE registry, and the broken visualizer.
2. Pin direct parser dependencies in the workspace lock; ensure all active
   modules import under Python 3.11.
3. Add an explicit BMSTU ingestion command with fixture default, explicit live
   opt-in, direct HTTP only, allowlist, request spacing, timeout/retry/body/PDF
   bounds, and redacted verbose logs.
4. Emit capture manifests with stable source keys, exact URLs, UTC retrieval
   times, SHA-256, content type, status, and explicit raw-storage status.
5. Serialize sanitized parser output into a candidate bundle based on the
   checked-in BMSTU-2026 bundle; detect same-key conflicts and unresolved links
   without overwriting facts or coercing unknown values.
6. Implement explicit review/materialization so unreviewed candidate rows are
   not accepted by the importer; preserve existing datasets and AND/OR/AT_LEAST
   trees.
7. Add offline fixture tests for capture, parsers, PDFs, source policy,
   normalization, provenance, conflicts, and candidate validation.
8. Re-run importer validate/dry-run/full disposable-PostgreSQL commit,
   idempotency, rollback, row-count, and active-pointer checks.
9. Update README, architecture, migration, known-issues, source audit, CI, and
   record exact test results/limitations.
10. Scan the exact commit contents for secrets, PII, raw docs, build products,
    and check the new bundle against the original BMSTU-2026 export.
11. Create a new unique public repository under `artemnoor` and push the
    verified default branch, leaving existing repositories unchanged.

## Acceptance and definition of done

- All active Python modules import on Python 3.11; HSE is absent from the
  installed/active registry.
- Representative locally stored catalog/detail/PDF fixtures parse without
  network access; tests do not invoke live acquisition.
- Live mode is opt-in and cannot invoke a browser or follow unapproved hosts;
  timeouts, size limits, request spacing, retries, and verbose redacted logs are
  covered by tests.
- Candidate keys/provenance are deterministic; baseline facts remain intact;
  accepted snapshots remain source observations pending typed mapping; HSE and
  olympiad rows are absent from the published dataset.
- Candidate bundle validates; importer dry-run succeeds only after review and
  preserves all current bundle data. Existing release tests prove idempotency,
  rollback, and active-pointer integrity in disposable PostgreSQL 16.
- CI passes; docs report factual results and known omissions.
- A distinct public GitHub repository contains the verified project and
  `main` branch; `andromeda-prod` and all source repositories remain unchanged.

## Verification commands

```powershell
uv sync --locked --all-packages --group dev --no-editable
uv run --no-editable pytest -q
uv run --no-editable --package andromeda-bmstu-parsers andromeda-bmstu ingest --help
uv run --no-editable --package andromeda-academic-data-db academic-data bundle validate --input data/bmstu-2026
uv run --no-editable --package andromeda-academic-data-db academic-data bundle import --input data/bmstu-2026 --dry-run
docker compose -f infra/compose.yaml up -d --wait
uv run --no-editable --package andromeda-academic-data-db academic-data db upgrade
uv run --no-editable --package andromeda-academic-data-db academic-data bundle import --input data/bmstu-2026 --commit
```

## Commit plan

1. `feat(parsers): restore bounded BMSTU ingestion core`
2. `feat(ingestion): add reviewed importer-compatible candidates`
3. `test(docs): verify and document BMSTU release pipeline`
4. `chore(repo): publish verified monorepo to new public origin`
