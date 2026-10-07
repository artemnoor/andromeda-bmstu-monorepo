# Phase 4: Documentation and publication

Plan: [index.md](index.md)
Tasks: 7
Depends on: Phase 3 / Tasks 1-6

## Objective

Give operators a reproducible viewer setup and publish the fully tested UI metadata to the existing Andromeda monorepo.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|---|---|---|
| `README.md` | Directus viewer section | Current startup steps omit exact metadata restore sequence. |
| `docs/DIRECTUS.md` | Current POC limits | Must be revised from current status to tested behavior and remaining gaps. |
| `docs/ARCHITECTURE.md` | consumer/data ownership boundaries | Must state Directus remains a consumer and directus_meta stays separated. |
| `docs/KNOWN_ISSUES.md` | known risks | Must retain performance and capability limits after UX curation. |
| `docs/DIRECTUS_UX.md` | new operator guide | Explains menu, core paths, display templates, filters, quality review, setup/apply and limits. |
| `.github/workflows/ci.yml` | existing PostgreSQL 16 test workflow | Final test evidence and workflow link. |

## Files to Change

| Path | Action | Required change |
|---|---|---|
| `README.md` | modify | Add concise bootstrap/apply metadata commands and link to UX guide. |
| `docs/DIRECTUS.md` | modify | Explain security, service setup, configuration apply, actual smoke evidence, and exact limits. |
| `docs/ARCHITECTURE.md` | modify | Document metadata-only virtual relations and Directus UI consumer boundary without changing architecture. |
| `docs/KNOWN_ISSUES.md` | modify | Record unverified URL clickability/preset/dashboard/language limitations and DB refresh scale. |
| `docs/DIRECTUS_UX.md` | create | Reproducible menu/group, relationships, display/filter, data quality, active release and restore guide. |
| `.ai-factory/plans/codex-directus-viewer-ux/index.md` | modify | Mark tasks complete only with matching evidence. |

## Task 7: Document restoration, limits, test evidence, and publish on this repository

### Intent

Make a fresh local setup reproducible and deliver the approved read-only UI config only after runtime and security checks pass.

### Implementation Steps
1. Update README startup to explain isolated PostgreSQL 16 setup, role password provisioning, Directus profile, admin env, health wait, metadata dry-run/apply and repeat apply.
2. Update `docs/DIRECTUS.md` for exact data boundary, collections/folders, display templates, virtual relations with no SQL FK, actual directus_meta storage, tested DML/DDL denial, and runtime smoke status.
3. Add `docs/DIRECTUS_UX.md` with visible menu groups, hidden technical collections, key click paths, exact dynamic filters available, read-only quality/review use, active release fields, evidence navigation and complete restore steps.
4. Update architecture/known issues without suggesting that Directus can moderate/publish, that UI-hidden data is secure, or that missing dashboards/URL displays are complete.
5. Run full test suite, format/static checks, and verify working tree contains no secrets or fixture/production data.
6. Make one commit containing implementation, tests, documentation, and this plan; push only to `andromeda-public`, open a PR in `artemnoor/andromeda-bmstu-monorepo`, and wait for the PostgreSQL 16 GitHub Actions run on the exact PR head.
7. Confirm the branch SHA, PR URL, and Actions run ID. Leave merge for the repository's normal review/approval process.

### Required Interfaces and Contracts
- Document the exact environment variables and commands; never write secrets into Compose files, JSON manifests, shell history, logs, or committed `.env` files.
- Metadata restore command must be the exact checked-in runner command and must work after the service is available.
- Published workflow remains capture → parse → candidate → diff → review → commit → release; Directus adds no write endpoint or publish action.

### Error Handling and Logging
- Failed smoke or CI blocks publication as a completed PR; retain tests and fix implementation rather than weakening them.
- Keep CI/test logs readable and redact credentials. Use minimal summaries with run IDs/URLs.

### Tests
- `uv run pytest -q` (all existing and new tests).
- `git diff --check` and JSON/metadata validator.
- GitHub Actions on the exact PR head.
- Actual smoke evidence listed in `docs/DIRECTUS.md` and `docs/DIRECTUS_UX.md`.

### Acceptance Criteria
- All four required docs are updated; new UX guide exists.
- Documentation separates implemented, fixture/DB tested, live Directus smoke verified, and still limited behavior.
- Full CI suite is green on the exact published commit.
- A green PR is open in the same monorepo; working tree has no uncommitted changes or credentials.

### Verification
- `uv run pytest -q`
- `git diff --check`
- `gh pr checks <number> --repo artemnoor/andromeda-bmstu-monorepo`
- `gh run view <run-id> --repo artemnoor/andromeda-bmstu-monorepo`
- Expected result: all tests/actions pass; the published PR points at the reviewed branch commit.

## Phase Risks and Mitigations
- Risk: metadata runner requires an operator action after Compose start. Mitigation: make it a single checked-in idempotent command; document that as the one restore step if no safe lifecycle hook exists in Directus 12.4.1.
- Risk: GitHub auth configured for the wrong `origin`. Mitigation: explicitly address `andromeda-public` and pass `--repo artemnoor/andromeda-bmstu-monorepo` for GitHub CLI operations.
- Risk: the PR head changes after its green workflow. Mitigation: verify the run's `headSha` equals the final branch commit SHA.

## Phase Completion Checklist
- README and Directus guides reproduce metadata configuration from repository files.
- Limitations are clear and no unsupported UX is claimed.
- Full local tests pass and a green PR is published in the existing repository.
- The AIF plan records final commit, PR and run evidence.
