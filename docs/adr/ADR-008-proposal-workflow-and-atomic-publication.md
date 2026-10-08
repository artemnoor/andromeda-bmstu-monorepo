# ADR-008: Persist proposals within the canonical ingestion workflow

- Status: Accepted and implemented
- Date: 2026-10-08
- Basis: Architecture v1.1 final hardening

## Context

Ingestion already captures sources, parses them into candidate bundles, performs exact-key diff and review, materializes an immutable reviewed bundle, validates it, and commits a release. A second proposal publisher would duplicate decision and release semantics. The earlier in-memory proposal service also could not preserve transition history or safely coordinate a publish retry.

## Decision

Persist proposal aggregates, immutable revisions, source evidence references, and transition events in PostgreSQL. Use the existing candidate bundle and exact `review_decisions.jsonl` event as the handoff and reviewer evidence. Proposal state is a durable moderation record attached to the existing pipeline.

Use optimistic aggregate versions for proposal transitions and the existing active-release advisory lock/row lock for release publication. Only the API `PublicationApplicationService` may publish canonical releases. Its DB adapter writes the canonical release, archive, proposal PUBLISHED state/events, active pointer, activation event, and whole-command idempotency record in one transaction. A timeout retry with the same idempotency key/request hash returns the committed release.

Keep moderation application use cases internal. `/api/v1` stays read-only until a real authentication and authorization model is designed. The local CLI uses an explicit trusted-operator authorization policy and is not a public security boundary. Directus has no proposal or canonical academic write privilege.

## Consequences

- Proposal transition history and source hashes survive process restarts and bundle movement.
- A stale proposal version or active release is rejected rather than silently overwritten.
- A failed publication cannot leave a proposal marked published or partially switch the active release.
- Proposal revisions, evidence references, and events are append-only; the original release history is unchanged.
- The CLI executable is owned by `services/ingestion-cli`; parser and ingestion libraries remain API-free.
- PostgreSQL integration checks require an isolated PostgreSQL 16 environment.

## Verification

See [the hardening migration report](../architecture/MIGRATION_REPORT.md) for local and CI results, PostgreSQL 16 integration, and any remaining limits.
