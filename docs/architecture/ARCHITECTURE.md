# Andromeda architecture

> Status: implementation snapshot for the Architecture v1.1 migration, 2026-10-08. The attached Architecture v1.1 document is a proposed target. This page distinguishes the code established in this migration from capabilities still being relocated or designed.

## Repository boundaries

The monorepo uses Python workspace packages to give persistence, domain semantics, HTTP contracts, and the API separate owners. A package boundary is not a claim that the component is independently deployed or production-ready.

| Area | Current implementation | Status and limit |
|---|---|---|
| Persistence | `packages/db` owns SQLAlchemy models, repositories, connection/settings, Alembic configuration and runner, and migration history. | Implemented. The existing 11 revision files, revision IDs, parent links, one head (`f4b19a7c2d61`), and `academic_data_alembic_version` table are preserved. |
| Domain | `domain` contains framework-independent ontology validators, policy resolution, and repository port types. | Implemented for the moved semantics. This is not a complete rule engine, graph model, or bitemporal implementation. |
| HTTP contracts | `packages/contracts` owns the versioned API v1 DTOs. | Implemented. Contracts do not depend on FastAPI routers. |
| API | `services/api` composes the read-only FastAPI v1 surface and the `PublicationApplicationService` used by both CLI commit entry points. | The shared application service is present in code. A focused post-move set covering parser, API, domain-boundary, proposal, and offline-bundle behavior passed 63 tests; PostgreSQL-backed publication integration remains pending. Existing `/api/v1` routes are GET-only. Proposal, approval, rejection, and publication HTTP routes are not implemented. |
| Ingestion | The BMSTU parser and review CLI are in `services/ingestion` and retain capture, parse, candidate, diff, review, validation, dry-run, and commit commands. | The move and focused CLI/parser checks are represented in the 63-test post-move set. The parser pipeline is not Dagster-orchestrated. |
| Directus | The repository contains the Directus metadata and a separate read projection/runtime-role configuration. | Metadata tests passed 5/5 and both root Compose profiles validate. PostgreSQL-backed permission enforcement and the Directus runtime smoke remain pending because Docker Desktop could not start. |
| Apps and orchestration | No public web app, Graph Explorer, Dagster runtime, or independent deployment artifacts are present. | Deferred. |

## Dependency direction

The enforced code boundaries are:

```text
services/api ───────> domain / packages/contracts / packages/db
services/ingestion -> domain / packages/contracts
packages/db ────────> domain ports

 domain ─X─> web frameworks, API services, ORM adapters, parsers, or platform tools
 contracts ─X─> routers, UI, or persistence adapters
```

AST boundary tests cover the ontology, contracts, API query/routers, and parser implementation. The API query/application code does not import the DB adapter directly; the API dependency composes repositories at its edge. These checks establish import boundaries only; they do not prove runtime isolation or deployment separation.

## Published data and current write path

PostgreSQL is the canonical store for the published academic release. Alembic history is owned by `packages/db`; no migration was added or rewritten for the ownership move. Release publication continues to use the existing guarded transaction, including active-release/base checks and immutable release records.

The parser `ingest commit` command and API distribution `academic-data bundle import --commit` both call `publish_reviewed_bundle` in `services/api`, which delegates publication to `PublicationApplicationService` and the `packages/db` publication repository. Both CLI paths use the shared boundary in code, and focused post-move tests passed. Real PostgreSQL publication and permission integration remain unverified because Docker Desktop could not start. Do not describe this as a new public API write route. The public API remains read-only and no applicant profile or proposal persistence is present.

The ontology package now owns selected semantic validation previously embedded in parser models and the published-rule selection policy. It does not introduce a new canonical schema or copy ORM models into the domain.

## Read consumers

The API reads a single active-release snapshot per request through the existing query layer and stable v1 DTOs. Canonical OpenAPI remains unchanged through the contract move (24 paths and 40 schemas; canonical SHA-256 `59cfcd54a15eb78e2f22e70bb25395c78d65d84139516b01dfe7666e1c1feec4`).

Directus is configured to read the allowlisted active-release projection and scope metadata writes to `directus_meta`. The moved-tree PostgreSQL grants have not been exercised in the current verification checkpoint, so runtime denial of academic writes remains pending. Directus is not a moderator or publisher. Production identity, SSO, policies, and licensed-mode/browser review are outside the verified local contour.

## Data and migration invariants

- Existing migration IDs, revision parents, operations, schema head, and version-table name stay unchanged.
- The checked-in `data/bmstu-2026` bundle is a reproducible input fixture, not an owner of schema or a production backup.
- The locally exported active release is an isolated test fixture. Its identity and file hashes are recorded in [CURRENT_STATE](CURRENT_STATE.md) and compared during final verification.
- Production database state, production backups, restore drills, RPO/RTO, and deployment credentials were unavailable. No production parity or restore claim is made.
- Provenance and release history remain part of the existing schema. The move does not add full bitemporal assertion history, outbox processing, or general proposal audit storage.

## Verification status

Post-move verification includes a locked non-editable workspace install, a focused 63-test parser/API/domain-boundary/proposal/offline-bundle set, 5/5 Directus metadata tests, and successful validation of both Compose profiles. The focused suite emitted one existing Starlette deprecation warning. Docker Desktop could not start, so PostgreSQL-backed permission and full integration checks remain pending. GitHub Actions results and final clean-checkout parity are not implied by these local checks.

## Target architecture boundary

The v1.1 proposal describes Directus editorial workflows, Dagster orchestration, Graph Explorer, public Web, and a complete review/publish API. The current API has a shared CLI publication application service but no proposal persistence or moderation HTTP endpoints; the broader capabilities remain target work until their code and verification evidence exist. See the [migration report](MIGRATION_REPORT.md), [baseline inventory](CURRENT_STATE.md), and [ADRs](../adr/).
