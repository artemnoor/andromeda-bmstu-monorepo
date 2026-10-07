# ADR-0001: Read-only academic API and separate applicant domain

- Status: accepted for the first backend/data-view contour
- Date: 2026-10-07
- Baseline: ANDROMEDA_ARCHITECTURE_v1.1

## Context

The academic core publishes immutable, source-backed releases through the
reviewed importer. FastAPI and Directus are being added as consumers. Applicant
profiles and preferences have different owners, access rules, retention needs,
and update frequency from public academic facts.

## Decision

1. FastAPI v1 is read-only and calls `AcademicDataQueries`. Each request uses
   one read-only PostgreSQL `REPEATABLE READ` snapshot of the active release.
2. Directus reads only active-release views through a separate PostgreSQL role.
   It can write only its own metadata under `directus_meta`; it cannot write,
   alter, or drop canonical/release/evidence data.
3. Academic data remains in immutable release-scoped tables. Applicant data is
   a future separate domain and must not enter those releases or their
   provenance.
4. Any future proposal API must be designed separately. Candidate route shape
   only:
   `POST /admin/v1/proposals`,
   `POST /admin/v1/proposals/{id}/approve`,
   `POST /admin/v1/proposals/{id}/reject`, and
   `POST /admin/v1/proposals/{id}/publish`.
   These routes are not implemented. The design must define identity and roles,
   proposal state transitions, source/evidence references, conflict handling,
   idempotency, audit retention, validation, and guarded publication.

## Consequences

- A frontend and Directus can read a stable release contract without receiving
  write credentials to canonical PostgreSQL.
- HTTP errors and payloads are versioned independently of the importer write
  workflow.
- Applicant profiles, EGE/olympiad results, shortlists and preferences need a
  separately designed persistence and authorization boundary.
- Directus system configuration is mutable in its own schema, while academic
  views continue to reflect only the active immutable release.

## Verification

PostgreSQL 16 integration tests connect as the actual API and Directus runtime
logins, verify least-privilege permissions, and exercise active-release
switching through the HTTP API. API OpenAPI and no-write-route checks run in
the unit suite.
