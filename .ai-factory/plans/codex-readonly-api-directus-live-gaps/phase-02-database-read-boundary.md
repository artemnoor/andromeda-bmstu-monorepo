# Phase 2: Database read boundary

Plan: [index.md](index.md)
Tasks: 3
Depends on: Phase 1 / Tasks 1-2

## Objective
Expose only the reviewed active canonical release through least-privilege PostgreSQL roles and stable Directus SQL views without changing importer or release semantics.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|---|---|---|
| `academic-data/src/academic_data_service/infrastructure/database/read_repository.py` | `SQLAlchemyAcademicDataReadRepository`, `_ensure_active_release`, `EVIDENCE_BRIDGES` | Existing repository caches an active release and resolves source evidence using that release. |
| `academic-data/src/academic_data_service/infrastructure/database/models.py` | release and active-pointer models | Alembic owns lifecycle schema and release immutability. |
| `academic-data/src/academic_data_service/infrastructure/database/catalog_models.py`, `admission_models.py`, `evidence_models.py`, `source_models.py` | typed canonical and provenance models | Source for explicit read grants and projections. |
| `academic-data/migrations/versions/` | existing linear migration history | Add a forward migration; do not rewrite prior revisions. |
| `infra/compose.yaml` | existing PostgreSQL 16 test service | All negative permission checks run in the isolated test DB. |

## Files to Change

| Path | Action | Required change |
|---|---|---|
| `academic-data/migrations/versions/<new_revision>_readonly_consumer_roles_and_views.py` | create | Create NOLOGIN consumer groups, explicit SELECT grants, and current-release views. |
| `infra/db/consumer_roles.sql` | create | Document/test provisioning of login roles with secret inputs and isolated Directus metadata schema. |
| `tests/test_postgres_read_permissions.py` | create | Use actual test login roles to verify SELECT and denial of DML/DDL. |
| `infra/compose.yaml` | modify | Add an opt-in Directus profile after role/view setup while preserving default PG16 service. |
| `academic-data/src/academic_data_service/infrastructure/database/read_repository.py` | modify only if required by API integration | Preserve framework-independent connection-scoped behavior. |

## Task 3: Add PostgreSQL roles and active-release views

### Intent
Enforce read-only API/Directus access in PostgreSQL, independent of application or UI settings.

### Implementation Steps
1. Enumerate exact tables used by current `AcademicDataQueries` and `SQLAlchemyAcademicDataReadRepository`: active pointer/release metadata; exposed release-scoped facts; source artifacts/evidence and evidence bridges; manual-review lookup used for public gap metadata; classification/taxonomy tables only if exposed DTOs query them.
2. Add a new Alembic revision. Create NOLOGIN groups `andromeda_api_readonly` and `andromeda_directus_readonly`. Grant API SELECT on an explicit table allowlist. Directus 12.4.1 does not introspect PostgreSQL views, so grant Directus SELECT only on a separate projection populated from approved views. Do not grant DML, TRUNCATE, DDL, ownership, sequence writes, or CREATE on either read schema.
3. Create a dedicated read schema (for example `academic_read`) containing stable `directus_*` views for release metadata, directions, departments, programs, study plans, curriculum items, campaigns, offerings, requirement trees/exams, quotas, tuition, statistics, source artifacts, and evidence.
4. Every view resolves one active pointer and joins all release-scoped references on the same release ID. Give each view one unique UUID `id` plus external keys and safe display/provenance columns. Do not expose applicant-level data, parser staging, private review controls, or archived bundle payloads.
5. Add secret-free role bootstrap instructions/script: deployment supplies a login/password outside Git; API login inherits API group. Directus login inherits Directus group and can create only Directus metadata in a separate schema, with a connection search path covering that schema and the projection schema. Do not create production passwords in Alembic.
6. Create temporary real login roles in the isolated PG16 test DB. Run allowed reads using those logins, not the migration owner. Run denied mutation statements in savepoints and roll back regardless of outcome.
7. Test that publish and rollback atomically refresh the Directus projection from one active release; verify no projected record set combines releases.

### Required Interfaces and Contracts
- `andromeda_api_readonly` can SELECT only the enumerated query tables; it cannot INSERT/UPDATE/DELETE/TRUNCATE, ALTER/DROP, own those tables, or write sequences.
- `andromeda_directus_readonly` can SELECT only the active-release projection; a security-definer trigger refreshes it atomically from source views in the pointer-change transaction. Its associated login can write Directus metadata only in its isolated metadata schema.
- Runtime credentials are supplied through environment/secrets, never stored in migration or tracked compose files.
- Alembic remains sole owner of canonical DDL; Directus cannot mutate the academic schema or view definitions.
- Source views are database-filtered to the active release, and the projection contains only the same selected release, not a UI-filtered collection.

### Error Handling and Logging
- Migration fails atomically if any required role, view, projection table, trigger, or grant cannot be established.
- Downgrade refuses to remove Directus metadata if it is nonempty, then removes only the new read schemas, trigger, and roles created by this revision.
- Never print, log, or commit runtime passwords.

### Tests
- Upgrade an empty PG16 test DB to migration head.
- Create dedicated API and Directus test logins with ephemeral credentials. Verify expected SELECTs succeed.
- Attempt INSERT/UPDATE/DELETE/TRUNCATE on representative release, fact, source, and evidence tables; expect permission denied.
- Attempt ALTER/DROP inside nested transactions/savepoints on representative canonical/release/evidence tables; expect permission denied and verify objects remain.
- Assert API login cannot SELECT unapproved audit/import tables and Directus login cannot SELECT underlying canonical tables.
- Switch and roll back the active release; assert the projection changes atomically and contains only one release.
- Run `uv run pytest -q tests/test_postgres_read_permissions.py`.

### Acceptance Criteria
- Runtime roles connect and have exactly the documented read allowlists.
- PostgreSQL itself denies canonical DML and DDL even if the Directus application user has UI admin rights.
- Existing migration chain, importer, rollback, and immutable release behavior remain intact.

### Verification
- `uv run --package andromeda-academic-data-db academic-data db upgrade`
- `uv run pytest -q tests/test_postgres_read_permissions.py`
- Expected result: migration check succeeds; actual API/Directus login negative permission tests all pass.

## Phase Risks and Mitigations
- Risk: Directus needs DDL for its own metadata. Mitigation: isolate that schema and grant no academic schema ownership or write access.
- Risk: a query adds a new table dependency. Mitigation: run endpoint integration tests using the restricted API login, so missing grants fail visibly.
- Risk: a view omits part of the release join. Mitigation: review generated SQL and test cross-release referential joins after active pointer switch.

## Phase Completion Checklist
- Task 3 acceptance criteria pass on PG16.
- Exact grant allowlists, login bootstrap, views, projection tables, and refresh trigger are documented.
- Update Task 3 checkbox in `index.md` after negative DML/DDL tests pass.
