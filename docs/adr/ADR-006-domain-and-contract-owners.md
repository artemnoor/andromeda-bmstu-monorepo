# ADR-006: Keep domain semantics and transport contracts out of adapters

- Status: Accepted and implemented for the moved semantics
- Date: 2026-10-08
- Basis: Architecture v1.1, sections 2, 8, and 9

## Context

Parser models, API DTOs, ORM mappings, and framework code had overlapping responsibilities. Repeated validation rules and package imports made it difficult to change a source parser without crossing into persistence or HTTP implementation.

## Decision

Keep ontology validation, selected policy resolution, and repository port types in `domain`. Keep versioned API v1 DTOs in `packages/contracts`. Keep SQLAlchemy mappings and repositories in `packages/db`. Parsers delegate shared semantic validation to the ontology package; routers and persistence adapters remain outside domain code.

## Consequences

- Contract, domain, and storage changes have explicit ownership and dependency direction.
- The moved ontology is a limited set of validators/policies, not a complete rule engine or a second copy of the database schema.
- Published source evidence remains in the existing PostgreSQL release model. A full bitemporal assertion system is not added by this move.

## Verification

The earlier domain/contracts and import-boundary run passed; the focused post-move parser/API/domain-boundary/proposal/bundle set passed 63 tests. The before/after canonical OpenAPI schema matched exactly at 24 paths and 40 schemas. PostgreSQL-backed integration and a final full suite remain pending.
