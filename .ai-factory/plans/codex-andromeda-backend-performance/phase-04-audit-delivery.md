# Phase 4: Independent Audit and Delivery

Plan: [index.md](index.md)
Tasks: 7–8
Depends on: Phase 3 / Tasks 5–6

## Objective

Have a reviewer who did not implement the change audit the design, correctness and benchmark claims; resolve critical findings; then publish the evidence and deliver through GitHub.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|---|---|---|
| All changed API/query/contract files | candidate diff | Compatibility, release consistency, query shape, N+1 and response-limit review |
| `apps/web-react-poc/BACKEND_PERFORMANCE_RESEARCH.md` | final evidence tables | Separates observation, assumption, missing evidence and recommendation |
| `.github/workflows/ci.yml` | required branch jobs/artifact upload | CI coverage and raw benchmark retention |
| PR checks and review artifacts | exact PR/run/head SHA | Verifies delivered code, not just local worktree |

## Task 7: Independent Review and Recheck

### Intent

Get an independent architectural, academic-safety and performance review from a specialized reviewer with access to the requirements, diff and evidence but not the implementation decision history as a presumed conclusion.

### Implementation Steps

1. Assign the Independent Reviewer subagent to inspect the final diff and report independently on chosen option, maintainability, request/response bounds, release transaction, active-release switching, N+1 elimination, large data, failure behavior, academic facts/provenance, old API compatibility and benchmark methodology.
2. Give the reviewer the raw paired benchmark artifact and exact run/environment metadata; ask for recomputation of claimed deltas and flags for sample/readiness mismatch.
3. Classify findings P0/P1/P2/P3 with file/line evidence. Fix each P0/P1 finding before delivery; tests must cover corrections. Resolve P2 that can alter performance, completeness, identity or UI behavior; document any unrelated non-blocking suggestion.
4. Re-run focused tests and matched benchmark after any P0/P1 or performance-critical fix. Refresh the research report and plan checkbox ledger from new evidence.
5. Review the final changed-file list for forbidden scope (Vanilla runtime/production routing, database schema without evidence, design/function expansion, unused dependencies, unrelated files).

### Required Interfaces and Contracts

- Reviewer is independent and must not simply approve the implementer's summary.
- P0/P1 blocks Task 8. An unresolved performance or academic-correctness issue cannot be waived by a faster median.
- Review evidence points to the exact candidate head and exact benchmark artifact.

### Error Handling and Logging

- Preserve review output and all unresolved non-blocking notes in the report.
- Avoid including credentials or full academic-source content in review evidence.

### Tests

- Re-run the tests that exercise each P0/P1/P2 fix.
- Re-run all relevant CI checks before considering findings closed.

### Acceptance Criteria

- Independent audit addresses every requested reviewer criterion.
- No unresolved P0/P1 issue remains; fixes have regression coverage and re-review evidence.

### Verification

- Compare reviewer findings against final diff and raw benchmark artifact.
- Expected result: written independent review with no unresolved blocking issue.

## Task 8: Publish PR and Deliver

### Intent

Complete the requested public engineering workflow with an actionable report, reviewable PR, green CI and merge only if checks and permissions allow.

### Implementation Steps

1. Finalize `apps/web-react-poc/BACKEND_PERFORMANCE_RESEARCH.md` with catalog-variance root cause/evidence, complete dependency graph, endpoint/SQL/frontend bottlenecks, A/B/C table, selected option, release semantics, before/after results, academic correctness, tests, independent review, subagent roles, PR/commit/Actions references and limitations.
2. Record a single conclusion: GO, CONDITIONAL GO, or NO-GO. Base it on material measured product benefit and correctness/sustainability priorities; don't target-tune or delete required academic data to pass a threshold.
3. Commit the implementation, test harness/data and report on `codex/andromeda-backend-performance`, preserving the original user's pre-existing worktree state.
4. Push the branch to `artemnoor/andromeda-bmstu-monorepo` and create a PR targeting `main`. Include concise architecture choice, measured results, critical data guarantees, exact benchmarks, raw artifact link and known limits.
5. Wait for all required GitHub Actions jobs. Diagnose and fix failures without changing expected academic results; rerun the relevant checks and update artifact/report evidence.
6. Merge only if CI is green, review is complete, no blocking finding remains, `main` base is current, and the merge method/permissions allow it. If GitHub lacks permission or required checks are unavailable, leave the PR open and report the exact blocker.
7. After merge, record PR number/URL, merged commit SHA, final head SHA, check run IDs, and verify `main` contains the delivered commit.

### Required Interfaces and Contracts

- PR target is the requested public repository and `main`; production React routing stays unchanged.
- Every performance claim points to saved raw samples and the exact commit/seed. Report does not claim an unrun test or browser passed.
- If selected architecture is NO-GO, the PR still records the evidence/report and any safe query optimization independently justified; it does not add a speculative endpoint.

### Error Handling and Logging

- Report push/permission/conflict/CI errors by their actual status and preserve the branch/PR for user review if merge cannot proceed.
- Do not bypass required checks, force-push over unexpected remote history, or merge a failing PR.

### Tests

- Verify final local status and commit ancestry.
- Verify PR head matches tested commit, required check conclusions are success, and merge state is accurate.

### Acceptance Criteria

- Research report and Ultra plan are present in the PR.
- User can inspect branch, PR, CI artifacts and final report; merge is complete only if criteria and permissions permit.
- Final response states exact result: PR/commit/Actions, GO outcome, tests, limitations and whether merged.

### Verification

- `git status --short --branch`; `git rev-parse HEAD`; `git diff --check`.
- GitHub PR files/base/head/checks/merge state and exact final `main` SHA.
- Expected result: no uncommitted task changes, required checks green, and merge only if available.

## Phase Risks and Mitigations

- Risk: GitHub connector/credential or branch protection prevents push, PR, or merge. Mitigation: preserve concrete branch/PR state and report the exact blocker; do not imply merge happened.
- Risk: benchmark artifact expiry. Mitigation: keep a permanent raw JSON/report evidence copy in the repository or link it in the report before artifact retention expires.
- Risk: independent review is too close to implementation. Mitigation: assign a different subagent after implementation and provide criteria, not a prescribed conclusion.
