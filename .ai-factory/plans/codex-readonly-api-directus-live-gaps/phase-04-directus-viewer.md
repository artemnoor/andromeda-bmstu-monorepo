# Phase 4: Directus viewer

Plan: [index.md](index.md)
Tasks: 5
Depends on: Phase 2 / Task 3

## Objective
Provide an opt-in local Directus Data Studio for reviewed current-release views, with academic read-only enforced in PostgreSQL.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|---|---|---|
| `infra/compose.yaml` | `academic-data-db` | Directus can reuse the current PG16 service/database; no second database is needed. |
| `academic-data/migrations/versions/` | Alembic history | SQL views/grants must be created by migrations, not Directus UI. |
| `docs/API_READINESS.md` | Directus compatibility | No current Directus service/view configuration exists. |
| `ANDROMEDA_ARCHITECTURE_v1.1 (1).md` | sections 6.2-6.4, 12 | UI permissions do not replace database permission boundaries. |
| Official Directus docs | configuration/database; collections; permissions | Use documented DB settings and view collections; keep database privilege as the final boundary. |

## Files to Change

| Path | Action | Required change |
|---|---|---|
| `infra/compose.yaml` | modify | Add opt-in `directus` profile, pinned image, health check, secret inputs, localhost binding. |
| `infra/directus/.env.example` | create | Document required local DB/admin/signing configuration with no real secrets. |
| `infra/db/consumer_roles.sql` | create/modify | Provide local secret-injected Directus login and metadata-schema setup. |
| `docs/DIRECTUS.md` | create | Explain startup, browsable collections, role boundary, configuration and limitations. |
| `tests/test_postgres_read_permissions.py` | modify | Verify real Directus login can read views and cannot mutate academic data. |

## Task 5: Add the Directus viewer

### Intent
Give internal users a visual browse tool while making database permissions authoritative even for a Directus administrator.

### Implementation Steps
1. Configure the approved `directus_read` projection tables from Task 3 as academic collections: release, directions, departments, programs, plans/items, campaigns, requirements/exams, quotas where canonical rows exist, tuition, statistics, source artifacts, and evidence. The projection is refreshed from safe active-release views because Directus 12.4.1 excludes PostgreSQL views from introspection.
2. Use one official pinned stable image tag verified during this implementation (official release observed as 12.4.1 at planning date); never use `latest`. The service stays under Compose profile `directus` and is excluded from default test/ingestion startup.
3. Configure a Directus login that inherits only `andromeda_directus_readonly` for academic reads. Give its DB login metadata DDL only over a dedicated Directus metadata schema; set its search path to that metadata schema and `directus_read`.
4. Read DB password/admin key/secret from environment or *_FILE input. Keep a local .env out of Git. Bind to 127.0.0.1 by default and use non-production local credentials only in local examples.
5. Add health check and setup commands requiring migration and role bootstrap first. Explicitly distinguish Directus system metadata writes from forbidden academic canonical writes.
6. Start Directus locally after migration/role setup and inspect the UI collection list and an item endpoint. If the restricted login cannot discover approved collections, change only the projection/search-path configuration; do not grant access to canonical base tables or DDL.

### Required Interfaces and Contracts
- Compose profile is `directus`; ordinary Compose startup remains PostgreSQL-only.
- Directus academic collections are only current-release projection tables with stable IDs, external keys, safe display columns, and source/evidence links.
- Directus role may modify only its own metadata schema; it has no canonical INSERT/UPDATE/DELETE/ALTER/DROP privileges.
- Academic schema/view definitions remain Alembic-owned.
- The visual layer does not publish, approve, or moderate proposals.

### Error Handling and Logging
- Health fails if database or credentials are missing; do not print secret values.
- Role/view discovery errors are surfaced as service startup errors; fix view grants instead of granting broad table access.
- Document the Directus UI admin limit: database permissions cannot be bypassed with UI admin rights.

### Tests
- PG16 tests connect using a real Directus test login and SELECT every available projection family in the imported release.
- Attempt INSERT/UPDATE/DELETE/TRUNCATE on release, canonical fact, source, and evidence tables and ALTER/DROP in rollback-protected savepoints; all fail with permission denied.
- Assert login cannot own or mutate canonical/projection tables and only has metadata-schema DDL plus SELECT on projection tables.
- Validate Compose with `docker compose --profile directus config --quiet`.
- Start the opt-in service locally; require `/server/ping`, authenticate, confirm expected collections and a representative item read, then stop the POC service.
- Run `uv run pytest -q tests/test_postgres_read_permissions.py`.

### Acceptance Criteria
- Directus starts only on explicit request, is healthy, and lists the expected approved projection collections.
- PostgreSQL denies academic mutations despite Directus admin UI identity.
- No extra database, hosted deployment, public write API, or user-facing frontend is added.

### Verification
- `docker compose --profile directus config --quiet`
- `uv run pytest -q tests/test_postgres_read_permissions.py`
- Expected result: Compose validates and actual login negative tests pass; UI health is separately recorded as verified or unavailable.

## Phase Risks and Mitigations
- Risk: Directus needs metadata DDL. Mitigation: grant it only in a dedicated schema owned by its login; never grant academic schema CREATE/ownership.
- Risk: views have limited editable relationship metadata. Mitigation: include exact keys and FK IDs in columns; keep the POC browse-only.
- Risk: Directus admin expectations include editing academic rows. Mitigation: clearly label views read-only and document the current CLI review/publish process.

## Phase Completion Checklist
- Task 5 acceptance criteria pass.
- Directus health/UI smoke result and role boundaries are documented.
- Update Task 5 checkbox in `index.md` after DB negative tests and the local smoke test.
