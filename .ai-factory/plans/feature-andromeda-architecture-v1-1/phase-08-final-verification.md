# Phase 8: Clean Checkout and Merge

Plan: [index.md](index.md)
Tasks: 8
Depends on: Tasks 1-7

## Objective

Prove the final tree installs and behaves from a clean checkout, compare data identity, resolve regressions, then merge the verified branch to main.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|------|-----------------|----------------|
| uv.lock and workspace pyproject.toml | locked package graph | Reproducible install |
| packages/db/migrations | existing Alembic revisions | Clean schema recreation |
| data/bmstu-2026 | checked-in normalized bundle | Deterministic test release |
| tests/integration | lifecycle and permission checks | Data safety behavior |
| .github/workflows/ci.yml | final workflow | Remote verification |

## Files to Change

| Path | Action | Required change |
|------|--------|-----------------|
| Tracked source paths | verify | No ownership changes unless a failed check requires a scoped fix |
| docs/architecture/MIGRATION_REPORT.md | update | Record only verified final test/data evidence |
| .ai-factory/plans/feature-andromeda-architecture-v1-1/index.md | modify | Mark tasks complete after evidence |

## Task 8: Verify clean install, PG16, data parity and merge

### Intent

The refactor is complete only after clean install, database, importer, API, Directus security, full tests, boundaries, Compose and CI have been checked. Never delete or rewrite existing tmp/.

### Implementation Steps

1. Create a clean checkout/worktree of the implementation branch in a new verified temporary path outside the tracked source tree. Exclude ignored .env and the user's untracked tmp directory.
2. Install with uv sync --locked --all-packages --group dev --no-editable; validate the bundle and active parser set.
3. Start PostgreSQL 16, upgrade an empty DB, inspect Alembic current/heads, run upgrade head and command.check. Bootstrap one test release only after confirming there is no active release.
4. Capture active release ID/key, bundle digest, row counts, external keys, source hashes, evidence links, curriculum IDs, quotas, relationships and review-state counts. Export and verify the same release; compare before/after structural checks.
5. Run API/read-only role tests, parser/import/review/release tests, Directus metadata/permission tests, full pytest, lint/type checks, import boundaries, Make targets and docker compose config.
6. Run Directus HTTP smoke only when local service/credentials are available; otherwise record it as unverified.
7. Search old owner paths/imports; confirm no active academic-data/, parsers/, infra/directus/ or infra/compose.yaml remains.
8. Push the branch only after local checks pass; wait for GitHub Actions and fix failed checks. Merge to main only after required checks are green. If remote policy/auth blocks this, preserve the tested branch and report the exact external blocker.
9. Verify main contains the merge commit, rerun git status, and leave pre-existing tmp/ untouched.

### Required Interfaces and Contracts

- Compare only the isolated release created from data/bmstu-2026; no production/user DB exists in this workspace.
- Structural migration leaves Alembic history/head identical and adds/changes no release facts.
- Merge target is main. Record SHA and GitHub Actions run URL only if verified.

### Requirement Evidence

- User task attachment sections 20, 21, 26, 28, 29 and final report requirements.
- Architecture v1.1 sections 13, 14, 17 and 20.

### Error Handling and Logging

- Stop merge on any required failure or changed data identity; fix and rerun affected checks plus full suite.
- Distinguish local, remote CI, runtime smoke and unavailable checks.
- Never claim production restore, identity, licensed Directus or deploy verification from local fixtures.

### Tests

- Run all final acceptance commands from the clean checkout.
- Run full pytest after the last fix; targeted tests alone are insufficient.

### Acceptance Criteria

- Locked clean checkout builds; migrations reach one unchanged head; importer/API/Directus and all regressions pass.
- Active release facts and identities are unchanged across structural relocation.
- Directus canonical write denial and metadata counts remain valid.
- No stale duplicate owners remain.
- Main contains the verified commit and GitHub Actions passes, or a concrete remote blocker is reported.

### Verification

- Repeat clean-checkout commands from the final branch/merge commit.
- Record exact test counts, migration head, data comparison, lint/boundary results, CI conclusion and SHA in MIGRATION_REPORT.md.

## Phase Risks and Mitigations

- Risk: tests alter data/schema. Mitigation: use dedicated disposable PG16 DB, compare release identities and never use a shared/production URL.
- Risk: clean checkout loses local-only artifacts. Mitigation: use an isolated new worktree and preserve tmp/ and .env in the user's checkout.
- Risk: branch protection/credentials block remote merge. Mitigation: do not misstate completion; preserve tested branch and state the exact gate.

## Phase Completion Checklist

- Clean checkout, PG16, data parity, full test, lint, boundary, Compose and CI evidence recorded.
- Main merge is verified or external blocker is stated precisely.
- Task 8 checkbox is updated in index.md only after final evidence.
