# ADR-007: Defer a dedicated Graph Explorer and graph database

- Status: Proposed; product/runtime deferred
- Date: 2026-10-08
- Basis: Architecture v1.1, section 7

## Context

The data contains relationships, provenance, and temporal facts that may benefit from graph exploration. No Graph Explorer application or production graph-query workload currently exists.

## Decision

Keep PostgreSQL as the canonical store. Defer a dedicated Graph Explorer and any separate graph database until a concrete user workflow, query budget, and measured PostgreSQL limitation justify them. If built, the browser client reads through versioned API contracts rather than connecting directly to PostgreSQL.

## Consequences

- There is no graph UI, graph API, graph-specific read model, or graph database in the current repository.
- A future graph interface must preserve authorization, provenance, active-release semantics, and resource limits.
- A database change is not justified by the existence of graph-shaped relations alone.

## Verification

Deferred. No graph application or workload has been implemented or benchmarked.
