# Andromeda architecture

> Current hardening snapshot: 2026-10-08. Read the migration report for historical checkpoints and the verification evidence for this hardening pass.

## Components and ownership

| Area | Responsibility | Boundary |
|---|---|---|
| `domain/` | Ontology semantics, proposal values/state rules, authorization and repository ports | No FastAPI, SQLAlchemy, Directus, Dagster, or ingestion implementation imports |
| `packages/contracts/` | Versioned HTTP request/response DTOs | Independent of routers and persistence |
| `packages/release-bundles/` | Safe, offline bundle reading, integrity checks, archive creation | No API, DB, ORM, or ingestion imports |
| `packages/db/` | PostgreSQL models/repositories, connection and settings, Alembic history | Repository adapters implement domain ports; canonical release publisher owns the guarded DB transaction |
| `services/ingestion/` | Capture, parsing, candidate construction, exact-key diff/review materialization, offline validation | Depends on domain, contracts, and neutral bundle reader; no API or database runtime dependency |
| `services/api/` | Read-only FastAPI v1 and application use cases for proposal moderation, publication, lifecycle, and classification | Application services compose domain policies and DB repositories; no write HTTP routes are registered |
| `services/ingestion-cli/` | `andromeda-bmstu` operator entry point and composition adapter | Depends on API application plus ingestion; contains no SQL or repository implementation |
| `platform/directus/` | Read-only academic projection and separately scoped metadata | Runtime cannot write canonical academic or proposal tables |

The workspace dependency direction is:

```text
services/ingestion ──────> domain + contracts + release-bundles
services/api ────────────> application services ──> domain + repositories
services/ingestion-cli ──> services/api + services/ingestion
packages/db ─────────────> domain ports
domain ─X─> FastAPI, SQLAlchemy, Directus, Dagster, ingestion implementation
```

The automated AST check covers ordinary imports and literal lazy/runtime imports (`__import__` and `import_module`). A parser subprocess test also blocks API, DB, FastAPI, and SQLAlchemy imports while loading the parser package and parsing a fixture.

## Canonical publication and other write paths

There is one canonical academic release publisher: `PublicationApplicationService` in `services/api`, delegating to `publish_projection` in `packages/db`. It accepts only a validated, reviewed bundle, checks its exact review journal and proposal bindings, prepares an immutable archive, and calls the existing guarded PostgreSQL publisher.

| Command or action | Application owner | Repository / database effect |
|---|---|---|
| `andromeda-bmstu ingest stage/diff/review/validate/dry-run/commit` | CLI adapter calls the API proposal/publication use cases where persistence is needed; pure parse and review materialization remains in ingestion | Proposal state/evidence/revisions/events use `SQLAlchemyProposalRepository`; `commit` alone enters the canonical release transaction |
| `academic-data bundle import --commit` | API publication application service | The same `publish_projection` transaction as ingestion CLI |
| Release rollback / legacy archive adoption | API release lifecycle use cases | `packages/db` lifecycle repository; rollback changes the active pointer and appends activation history; adoption attaches only an exact-digest archive to an existing immutable release |
| Classification result import | API classification use case | Separate release-scoped classification repository and transaction; does not publish or replace an academic release |
| Proposal create, validate, approve/reject, rebase, conflict | Internal API application use cases called by the trusted local ingestion CLI | Proposal repository CAS updates the current row and appends a matching event; revisions and evidence are append-only |
| Schema changes | Alembic migration command | DDL under the migration credential; runtime services do not apply migrations |
| Directus presentation metadata | Guarded metadata operator | `directus_meta` only; Directus runtime cannot write canonical data |

This separates distinct ownership and privilege domains while preventing a second, independent academic-facts publisher.

## Proposal and publication transaction

The persisted workflow and explicit transitions are documented in [Proposal workflow](PROPOSAL_WORKFLOW.md). In short, the pipeline remains `capture → parse → candidate → diff → review → materialize → validate → commit`; proposals persist moderation state for exact typed candidates within that pipeline rather than forming a competing ingest path.

`publish_projection` takes the existing PostgreSQL advisory transaction lock, checks the active release and expected base, and checks an `import_batches` idempotency record before work that could create another release. In one database transaction it writes the immutable release rows and archive, marks the import batch committed, updates every linked proposal to `PUBLISHED`, appends the proposal audit events, switches the active pointer, and appends the activation event. Failure rolls back the release, proposal updates/events, and activation together. A later failed-batch diagnostic may be recorded separately after rollback; it cannot mark a failed publication successful.

Two idempotency levels are enforced: the release import batch has a stable command key and normalized whole-request SHA-256; each proposal event has its own stable key and normalized proposal-command SHA-256. An exact retry after commit returns the prior release. Reusing either key with different request content is rejected. Stale proposal versions and stale active-release IDs fail closed; database compare-and-swap and transaction locks prevent silent overwrites.

## PostgreSQL and immutable history

Alembic revision `71d8c4a29f30` is additive after `f4b19a7c2d61`. The original 11 migration files and their revision IDs, parent links, and operations are unchanged. The new revision adds proposal workflow tables and import-batch publication idempotency fields; it does not rewrite release records or activation history. Proposal revisions, evidence references, and events are protected by append-only triggers.

The API runtime role can update proposal aggregates and insert proposal history. API read-only and Directus roles have no proposal write privileges. Directus still reads the allowlisted projection, has no academic DML/DDL privileges, and can write only its scoped metadata schema through the configured metadata path.

## API and frontend boundary

`/api/v1` retains its GET-only routes and DTO contract. There are no administrative proposal HTTP routes. The internal use cases default to deny authorization; the local CLI supplies an explicit trusted-operator policy and local OS identity. This is not a public authentication or authorization system.

The frontend in `apps/web/` has not been integrated or moved. The current DTOs and read-only API remain the integration seam. Graph Explorer, Dagster runtime, Neo4j, Kafka, Kubernetes, applicant/user domain, and recommendation features remain future scope.

## Verification limits

Use [the migration report](MIGRATION_REPORT.md) for exact local, CI, PostgreSQL 16, Directus, lint, PR, and merge results. Local Docker Desktop was unavailable during this hardening pass; the local PostgreSQL 17 service was deliberately not used. Only an isolated PostgreSQL 16 CI service can establish the proposal persistence, migration, permission, and concurrency integration results. No production database or deployment is implied.
