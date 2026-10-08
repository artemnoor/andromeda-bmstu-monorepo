# ADR-004: Directus is a constrained academic-data reader

- Status: Accepted; configuration and metadata checks pass, moved-tree database enforcement pending
- Date: 2026-10-08
- Basis: Architecture v1.1, sections 1.3 and 6

## Context

Directus provides a convenient staff view, but its generic database capabilities must not become a second writer for published academic records. UI visibility alone cannot enforce this boundary.

## Decision

For the academic-data viewer, Directus reads the allowlisted active-release projection using a restricted PostgreSQL runtime role. Its metadata writer is limited to `directus_meta`. Academic writes, schema changes, moderation, and publication through Directus are not allowed. Staff publication is reserved for the reviewed application path described in ADR-003.

## Consequences

- PostgreSQL grants, not hidden collections or UI permissions, enforce the academic-data boundary.
- This decision covers the existing viewer only; a general editorial CMS workflow and SSO/identity mapping are not implemented.
- Licensed-mode and manual browser review remain outside the verified local contour.

## Verification

The metadata test module passed 5/5 tests and both Compose profiles validate. PostgreSQL-backed runtime-role denials and the Directus runtime smoke have not been rerun against the moved tree because Docker Desktop could not start. Do not infer production security from configuration or static metadata tests.
