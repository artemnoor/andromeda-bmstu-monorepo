# Phase 4: Documentation, CI, and publication

Plan: [index.md](index.md)
Tasks: 5–6
Depends on: Phase 3 / Task 4

## Objective

Document the actual verified update path and limitations, publish the finished changes to the existing public repository, and verify green GitHub Actions on `main`.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|------|-----------------|----------------|
| `README.md` | BMSTU ingestion workflow | Primary operator entry point. |
| `docs/KNOWN_ISSUES.md` | parser coverage and mapping limitations | Must distinguish supported behavior from unsupported sources/facts. |
| `docs/INGESTION_AUDIT.md` | fixture/source evidence and current limitations | Audit trail for checked-in local sources. |
| `docs/MIGRATION_REPORT.md` | schema/import ownership and integration results | Explains why the existing academic schema remains authoritative. |
| `.github/workflows/ci.yml` | `verify` job | Required GitHub Actions gate uses PostgreSQL 16. |
| Git remote `andromeda-public` | `https://github.com/artemnoor/andromeda-bmstu-monorepo.git` | Existing public repository to update. |

## Files to Change

| Path | Action | Required change |
|------|--------|-----------------|
| `README.md` | modify | Add reproducible fixture capture, review, validation, dry-run, migration, import, and active-release commands. |
| `docs/KNOWN_ISSUES.md` | modify | Remove the observation-only blocker once verified; list unavailable source facts and untested live capture accurately. |
| `docs/INGESTION_AUDIT.md` | modify | Record stable fixture digest, source hash invariants, typed promotion evidence, and local fixture coverage. |
| `docs/MIGRATION_REPORT.md` | modify | Record PostgreSQL lifecycle test results and preserve the no-new-schema decision. |
| `.github/workflows/ci.yml` | modify | Keep fixture validation, bundle dry-run, migrations, and the entire PostgreSQL 16 test suite; install `poppler-utils` because the existing curriculum parser requires `pdftotext`. |
| `.ai-factory/plans/complete-bmstu-ingestion-pipeline/index.md` | modify | Check off tasks only after verified completion. |

## Task 5: Document the verified update workflow and truthful limitations

### Intent

Give an operator a reproducible, review-gated way to update BMSTU academic data without implying live or source coverage that has not been verified.

### Implementation Steps

1. Document the exact offline commands to capture local fixtures, parse the frozen capture, stage candidates, review exact keys, validate, dry-run, migrate PostgreSQL 16, and commit/activate a release.
2. Explain where review decisions and provenance are recorded, how conflicts are resolved, and why absent rows are retained during partial captures.
3. Report factual local test totals, typed table coverage, and the fixture capture digest from the completed run.
4. State which admissions facts the checked-in fixture does not contain, which parser/source paths have not been exercised live, and that no mass live crawl was performed.
5. Keep `README`, audit, known-issues, and migration report consistent with the final implementation.

### Required Interfaces and Contracts

- Commands must use paths and flags present in the final CLI help output.
- Documentation must distinguish source fixture `source_sha256` from sanitized body `content_sha256`.
- Do not claim all categories have new fixture-backed facts if the fixture set only supplies a subset; existing baseline typed coverage is a separate claim.

### Error Handling and Logging

- Document the safe recovery action for invalid review, parser error, conflict, failed dry-run, and rolled-back import.
- Include DEBUG as the selected default level and document URL/query redaction and payload/secret exclusions.

### Tests

- Run every documented command against the local checked-in fixtures and disposable PostgreSQL 16 service.
- Check Markdown command paths/flags against `andromeda-bmstu ingest --help` and README output.

### Acceptance Criteria

- An operator can reproduce the tested fixture update end to end using the documented commands.
- Limitations reflect actual fixture/source coverage and live requests remain opt-in.

### Verification

- `uv run --no-editable --all-packages andromeda-bmstu ingest --help`
- Run the documented offline and PostgreSQL commands from a clean working tree/capture directory.
- Expected result: all commands exist and produce the documented outcomes.

## Task 6: Publish to the existing public repository and verify green GitHub Actions

### Intent

Publish only the verified source changes to the existing `andromeda-bmstu-monorepo` and confirm the default-branch CI result.

### Implementation Steps

1. Confirm all required local tests pass, working tree diff is reviewed, fixture/source hashes are safe, and no secret, applicant PII, raw capture, database dump, or environment file is staged.
2. Commit the implementation and documentation on the current `main` branch using the planned conventional commits where useful.
3. Push only to `andromeda-public`; leave `origin` unchanged.
4. Wait for the GitHub Actions run for the pushed SHA and inspect every job/step.
5. If GitHub Actions fails, inspect the exact failure, fix it locally, rerun the affected checks and full suite, then publish the correction to the same repository.
6. Verify the green run's head SHA equals the final `andromeda-public/main` SHA.

### Required Interfaces and Contracts

- No force-push, history rewrite, new repository, workflow secret, or live scraping.
- The public repository remains `artemnoor/andromeda-bmstu-monorepo` and `main` remains its default branch.
- Do not stage ignored captures, `.venv`, pytest/bytecode caches, or source document bodies beyond the already approved public fixtures.

### Error Handling and Logging

- Never expose credential values while using GitHub CLI.
- If auth or required repository permissions fail, preserve local verified commits and report the exact failed operation; do not change another remote/repository.

### Tests

- Local complete test suite and bundle checks pass before push.
- GitHub Actions is green for the final pushed SHA.
- Remote SHA and `git status` are checked after publication.

### Acceptance Criteria

- Final source and plan changes are visible on `main` of the same public repository.
- GitHub Actions conclusion is `success` for the final head SHA.
- Original-source `source_sha256` values and the `origin` URL remain unchanged.

### Verification

- `git ls-remote andromeda-public refs/heads/main`
- `gh run list --repo artemnoor/andromeda-bmstu-monorepo --branch main --limit 5`
- `gh run view <run-id> --repo artemnoor/andromeda-bmstu-monorepo --json conclusion,headSha,jobs,url`
- Expected result: remote SHA equals local `main`, and the final matching run reports `success`.

## Phase Risks and Mitigations

- Risk: CI timing delays a final answer. Mitigation: poll boundedly and keep the user updated; correct failures rather than declaring success from local tests only.
- Risk: documentation overstates unsupported exam/requirements/tuition source coverage. Mitigation: compare each statement with observed fixture output and importer typed row counts.

## Phase Completion Checklist

- Task 5 is complete: the documented CLI capture/parse/stage/review/validate/dry-run/commit workflow was executed against local fixtures and the disposable PostgreSQL 16 database; docs state the verified limits and Poppler requirement.
- Task 6 implementation commit `491ea6f4fbb047607529b260d03156211bef6020` is published to `andromeda-public/main`; [Actions run 37531892896](https://github.com/artemnoor/andromeda-bmstu-monorepo/actions/runs/37531892896) reports `success` for every job/step. The plan/result commit `aa79e58f5a4a600999b4dc5375fdd5104c3d597d` was also checked by [Actions run 37532464710](https://github.com/artemnoor/andromeda-bmstu-monorepo/actions/runs/37532464710), which succeeded for its exact head SHA.
- `index.md` is updated only after GitHub Actions is green on the published final SHA.
