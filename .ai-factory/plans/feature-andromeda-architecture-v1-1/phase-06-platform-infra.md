# Phase 6: Directus and Infrastructure

Plan: [index.md](index.md)
Tasks: 6
Depends on: Tasks 2, 5

## Objective

Relocate Directus metadata and establish a safe reproducible local runtime without selecting a cloud provider or widening canonical write access.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|------|-----------------|----------------|
| infra/directus/metadata | collection/relation manifests and applier | Existing Directus owner |
| tests/test_directus_metadata.py | projection and manifest assertions | UI/config preservation |
| tests/test_directus_permissions.py | PostgreSQL privilege probes | Canonical read-only proof |
| infra/compose.yaml | PG16 and Directus profile | Current local runtime |
| docs/DIRECTUS.md and docs/DIRECTUS_UX.md | setup and browsing constraints | Operational documentation |

## Files to Change

| Path | Action | Required change |
|------|--------|-----------------|
| platform/directus/metadata/** | move | Relocate existing four files without changing metadata |
| docker-compose.yml | move/modify | Single root Compose entry point with local-only DB binding |
| infra/database/** | create | Safe local backup and restore-check scripts |
| infra/environments/{dev,staging,production}/README.md | create | Environment and secret-handling boundary |
| infra/deploy/README.md and infra/monitoring/README.md | create | Explicit ownership without a provider choice |
| .env.example and Makefile | create | Documented local commands and variables |
| tests/test_directus_*.py | modify | Resolve manifests and migrations from new paths |

## Task 6: Relocate Directus and make local infrastructure reproducible

### Intent

Preserve the Directus viewer and enforce its read-only canonical access through database grants and reproducible source configuration.

### Implementation Steps

1. Move collections.json, relations.json, metadata README and apply_metadata.py to platform/directus/metadata. Update root/path discovery, tests and docs.
2. Preserve 25 Core-visible collections, 32 technical collections, 97 virtual relations, navigation, presets, aliases and projection allowlists.
3. Move infra/compose.yaml to root docker-compose.yml; do not keep duplicate Compose owners. Bind PostgreSQL to loopback, retain PG16 and optional Directus profile, add a named local volume and health checks.
4. Make Directus environment interpolation safe for DB-only startup. .env.example uses placeholders; actual credentials stay in ignored .env or shell variables.
5. Add backup and restore-check scripts that require explicit local test/dev targets, fail closed on other database names, use pg_dump/pg_restore without printing passwords, and verify restored migration/schema state.
6. Add Make targets setup, up, down, migrate, test, lint, api, directus and validate. Targets call uv/Compose commands and document needed local variables.
7. Add non-empty boundary READMEs for dev/staging/production, deploy, monitoring, platform/dagster, apps/web, apps/graph-explorer and tests/e2e. Add no Dagster runtime, cloud stack, frontend or Neo4j.

### Required Interfaces and Contracts

- Directus runtime stays SELECT-only on approved directus_read projections and retains only its current directus_meta write capability.
- Root Compose is invoked as docker compose; infra/compose.yaml is removed.
- Document ACADEMIC_DATA_ENV, ACADEMIC_DATA_DATABASE_URL, ANDROMEDA_DB_PORT, DIRECTUS_SECRET, ANDROMEDA_DIRECTUS_DB_PASSWORD, DIRECTUS_ADMIN_EMAIL, DIRECTUS_ADMIN_PASSWORD, DIRECTUS_PORT and DIRECTUS_TEST_URL.
- Backup/restore scripts accept explicit targets and never use production URLs from committed config.

### Requirement Evidence

- User task attachment sections 10, 11, 12, 14, 19 and 28.
- Architecture v1.1 sections 6, 10, 12, 13.2 and phase 3 of section 14.

### Error Handling and Logging

- Missing Directus secrets produce actionable config errors; DB-only startup requires no Directus credentials.
- Backup failures, unsafe target, restore failure or schema mismatch return non-zero.
- Logs identify target DB and outcome; omit passwords, credential-bearing URLs and tokens.

### Tests

- Run Directus metadata and real-role permission tests on PG16.
- Run Directus HTTP smoke only when local service/credentials exist; otherwise mark unverified.
- Test Compose config in DB-only and Directus-profile configurations.
- Exercise backup/restore-check on a temporary local test DB.

### Acceptance Criteria

- platform/directus owns the only metadata config and all count/permission tests pass.
- Directus cannot mutate canonical/projection data; metadata applier writes only directus_meta.
- Compose, Make targets and .env.example support local isolated development.
- Environment docs do not imply a cloud deployment exists.

### Verification

- docker compose config
- make validate, make migrate, make test, make directus
- Directus permission tests with real restricted runtime role
- Compare metadata counts/grants to Task 1 baseline

## Phase Risks and Mitigations

- Risk: relocation changes metadata filtering or applier discovery. Mitigation: preserve manifest content and run exact count/allowlist tests.
- Risk: restore scripts overwrite user data. Mitigation: require local test/dev DB names and explicit target arguments; never target production.

## Phase Completion Checklist

- Directus tests and permission probes pass.
- Root Compose and Make commands validate.
- Task 6 checkbox is updated in index.md.
