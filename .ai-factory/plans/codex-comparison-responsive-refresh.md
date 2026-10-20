# Andromeda: admission data repair and consistent React presentation

Date: 2026-10-19. Branch: `codex/comparison-responsive-refresh`.

## Scope and priorities

Trace missing admission facts from official evidence through parsing, immutable
release publication, FastAPI and React. Preserve verified identity, campus,
release consistency and the distinction between zero, unknown and BVI. Reuse
the existing adapter and read model. Keep Vanilla source and production routing
unchanged. Preserve the earlier requested dark React styling in this worktree.

## Execution record

- [x] Capture the original API data and reproduce missing BVI / quota facts.
- [x] Audit parser identity and composite direction/profile/department rows.
- [x] Compare source rows with existing offer/competition-pool projections.
- [x] Fix false quota conflicts and preserve 582 targeted organization pools.
- [x] Confirm the official main-order hash and correct 46 competition routes.
- [x] Add source-evidenced shared-program keys without replacing scalar IDs.
- [x] Retain independent bulk/unbatched DTO parity and production batch limits.
- [x] Publish a new, base-bound release in isolated PostgreSQL 16 on port 55437.
- [x] Revalidate unchanged JeV inputs and retain all 14,165 curriculum labels.
- [x] Display BVI, zero seats and three quota types distinctly in React.
- [x] Reproduce and fix WebKit blank catalog cards caused by content visibility.
- [x] Bound the decorative noise layer and intrinsic SVG texture dimensions.
- [x] Check actual runtime-role permissions; add SELECT-only ACL migration.
- [x] Run Python regression, SQL profiling, real-role and lifecycle tests.
- [x] Complete independent review and resolve P1 findings.
- [x] Document causes, all 34 unmatched profiles, provenance and screenshots.
- [x] Finish the final Chromium / Firefox / WebKit production-build run (151 pass, 2 intentional scale skips).
- [ ] Commit and push reviewable changes to the existing GitHub PR.
- [ ] Inspect CI results; retain any pre-existing failures explicitly.

## Delegation

- `admission_identity_audit`: parser identities, source grouping, repair CLI.
- `admission_scores_audit`: competition routes, API batching/fallback, ACL tests.
- `admission_independent_review`: source identity, permissions, architecture,
  release safety and final UI-layer review.
- Main agent: React presentation, immutable local publication, classification
  revalidation, browser checks, integration coordination and documentation.

## Deployment gates

The corrected release and API are available locally. Remote cloud authentication
is unavailable; no production data or routing was changed. The new API requires
ACL revision `c7e2b4a91d63` first, followed by verified data publication and its
matching profile snapshot. Do not merge or claim green CI while checks fail.
The previous PR browser job contains Vanilla contrast failures; this task does
not remove those checks or alter Vanilla to conceal them.

## Evidence

- `apps/web-react-poc/ADMISSION_DATA_REPAIR_REPORT.md`
- `apps/web-react-poc/docs/data/admission-repair-audit.json`
- `apps/web-react-poc/docs/data/admission-repaired-read-profile.json`
- Local raw results: `output/admission-audit/` and React `test-results/`.
