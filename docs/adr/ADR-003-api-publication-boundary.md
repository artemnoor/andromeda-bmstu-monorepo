# ADR-003: Route publication through one API application service

- Status: Accepted and implemented in code; focused post-move checks passed, PostgreSQL integration pending
- Date: 2026-10-08
- Basis: Architecture v1.1, sections 1.3, 5, and 8

## Context

Reviewed publication must have one validation and transaction boundary. Two CLI entry points previously converged on a shared importer transaction, but a shared function is not itself the application-service boundary owned by the API. The public `/api/v1` remains read-only.

## Decision

The target write path is a single API application service that invokes domain checks and the DB repository within the guarded PostgreSQL transaction. CLI publication callers may invoke this service; neither a parser nor Directus receives an independent canonical write path. Keep `/api/v1` read-only. Any future moderation routes must be designed separately with identity, authorization, state transitions, idempotency, and audit requirements.

## Consequences

- The existing release lock, active-base check, immutable release model, and activation history remain the transaction invariants.
- No proposal/approve/reject/publish HTTP endpoint or proposal table is implied by this decision.
- The service and both CLI call sites are present in code. The focused post-move parser/API/domain-boundary/proposal/bundle set passed 63 tests; PostgreSQL-backed publication integration remains pending.

## Verification

The focused post-move set passed 63 tests, but PostgreSQL-backed publication integration and final clean-checkout parity remain pending because Docker Desktop could not start.
