# ADR-001: Keep modular components in one monorepo

- Status: Accepted
- Date: 2026-10-08
- Basis: Architecture v1.1, sections 1–3 and 9

## Context

The project needs clear code ownership and reproducible package installation without paying the overhead of separate repositories or assuming that every module is a microservice. Repository structure should make dependency direction visible.

## Decision

Keep the current project in one Git repository. Use the `uv` workspace for separately named Python packages with explicit dependencies. Keep domain semantics, HTTP DTOs, persistence adapters, API composition, and ingestion in their designated owners. Add a shared package only when there is concrete reuse.

## Consequences

- One change can coordinate schema, API, and ingestion updates while CI selects affected checks by path.
- A workspace package boundary does not prove independent deployment, process isolation, or release cadence.
- Web, Graph Explorer, and service-specific deployment artifacts remain deferred.

## Evidence and limits

The repository has separately installable DB, ontology, contracts, API, and ingestion distributions as the migration completes. Independent deployability has not been demonstrated.
