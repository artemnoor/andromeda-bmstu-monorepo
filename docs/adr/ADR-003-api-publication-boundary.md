# ADR-003: Route publication through one API application service

- Status: Accepted and implemented; PostgreSQL 16 integration evidence recorded in the migration report
- Date: 2026-10-08
- Basis: Architecture v1.1, sections 1.3, 5, and 8

## Context

Reviewed publication must have one validation and transaction boundary. The public `/api/v1` remains read-only. Proposal moderation must join that release transaction rather than introduce a second publisher.

## Decision

The canonical write path is `PublicationApplicationService` → `publish_projection`. The database repository retains the existing guarded release transaction and invokes the proposal participant on that same connection. Release rows, archive, proposal PUBLISHED states/events, active pointer, and activation event commit or roll back together. Both supported CLI entry points call this service. Neither ingestion parsers nor Directus receives an independent canonical write path. Keep `/api/v1` read-only; any future moderation routes require a real identity and authorization model.

## Consequences

- The existing release lock, active-base check, immutable release model, and activation history remain the transaction invariants.
- Proposal persistence and internal moderation use cases are implemented by additive migration `71d8c4a29f30`; they do not add HTTP write endpoints.
- The API-free ingestion package delegates durable writes only through the separate CLI composition root. Proposal and release command idempotency are enforced at their respective DB boundaries.

## Verification

See the final hardening evidence in [MIGRATION_REPORT.md](../architecture/MIGRATION_REPORT.md). Local PostgreSQL 16 was unavailable; PostgreSQL-backed tests use the isolated PostgreSQL 16 GitHub Actions service. The local PostgreSQL 17 service was not used.
