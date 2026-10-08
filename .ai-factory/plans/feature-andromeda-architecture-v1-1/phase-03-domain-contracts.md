# Phase 3: Domain and Contracts

Plan: [index.md](index.md)
Tasks: 3
Depends on: Task 2

## Objective

Give framework-independent business semantics and versioned transport schemas separate owners without changing IDs, DTO shape, validation outcomes or parser decisions.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|------|-----------------|----------------|
| academic-data/src/academic_data_service/contracts/v1/models.py | API response records/schema registry | Existing /api/v1 DTO source |
| academic-data/src/academic_data_service/domain/rules.py | resolve_rule_pack_version | Existing policy semantics |
| parsers/src/andromeda/modules/*/domain | Program, Curriculum, Discipline, University, Events, Campus | Domain behavior nested in parser package |
| parsers/src/andromeda/shared/contracts | IDs, provenance and contract base | Parser DTO dependency |
| tests/test_curriculum_identity.py | identity and ambiguity cases | External-key compatibility |

## Files to Change

| Path | Action | Required change |
|------|--------|-----------------|
| packages/contracts/pyproject.toml and src/andromeda_contracts/** | create/move | Own API v1 DTOs and versioned schemas |
| domain/ontology/** and domain/policies/** | create/move | Own business entities, identity rules and policies |
| services/ingestion/contracts/** | create/move | Own raw/normalized parser DTOs |
| tests/test_import_boundaries.py | create | Enforce domain/contracts dependency rules |
| pyproject.toml and uv.lock | modify | Register andromeda-contracts and andromeda-ontology |

## Task 3: Separate ontology semantics from contracts

### Intent

Make business validation reusable without domain imports of SQLAlchemy, FastAPI, Directus, Dagster, network clients, parser implementation or transport models.

### Implementation Steps

1. Create the andromeda-contracts distribution. Move API v1 Pydantic models into andromeda_contracts.api.v1 without changing class names, fields, aliases, discriminators, validators or schema titles. Capture served OpenAPI before and after.
2. Move RuleScope, RuleVersionCandidate, ResolvedRuleVersion, errors and resolve_rule_pack_version to domain/policies. Add date-boundary, wildcard, specificity, no-match and equal-specificity ambiguity cases.
3. Move stable identity and semantic checks from parser Pydantic entities into pure functions/value objects under domain/ontology. Keep parser Pydantic DTOs in services/ingestion/contracts and call domain validators at adapters.
4. Preserve program legacy/current IDs, curriculum identity, duplicate discipline/semester ambiguity, discipline stable hash IDs, exact-vs-taxonomy normalization, admission choice cardinality, tuition and passing-score rules.
5. Keep source/evidence concepts separate from raw snapshots and HTTP DTOs. Do not invent a universal relation vocabulary, add bitemporal columns or reinterpret temporal data in this code move.
6. Add AST boundary checks: domain imports no framework/ORM/service/parser code; contracts import no routers/UI; apps import no DB.

### Required Interfaces and Contracts

- Distribution names andromeda-contracts and andromeda-ontology; import roots andromeda_contracts and andromeda_ontology.
- API response model and OpenAPI component names remain stable.
- Domain functions accept primitive/domain values and return domain values or typed errors; adapters map these to transport errors.
- Source-format DTOs remain under services/ingestion/contracts, not domain/ontology.

### Requirement Evidence

- User task attachment sections 4, 5, 14 and 22.
- Architecture v1.1 sections 2.3, 4.3, 8.2 and 9.

### Error Handling and Logging

- Keep deterministic typed policy errors. Use structured safe identifiers only; do not log raw applicant/source payloads.
- Invalid domain values fail before repository mutation; preserve the current transport error envelope.

### Tests

- Snapshot/compare OpenAPI /api/v1 paths, response models and schemas.
- Add domain tests for program, curriculum, discipline and rule-pack behavior.
- Run curriculum, ingestion and API contract regressions plus AST boundary tests.

### Acceptance Criteria

- Domain imports no ORM, HTTP/framework, platform or parser implementation modules.
- Contracts have one owner and import no routers/UI.
- Existing API schema and stable identity behavior are unchanged.
- No persistence schema or published facts change in this phase.

### Verification

- uv run pytest -q domain packages/contracts services/api/tests services/ingestion/tests
- Run import-boundary check directly and through pytest.
- Compare OpenAPI snapshot and stable identity fixture outputs.

## Phase Risks and Mitigations

- Risk: parser models mix Pydantic shape checks and business semantics. Mitigation: keep Pydantic at ingestion boundaries and call extracted domain validators; do not duplicate validators in DTOs.
- Risk: relation and temporal scope is open. Mitigation: preserve present meanings and record future POC questions.

## Phase Completion Checklist

- Domain and contracts have distinct package owners.
- API, parser and identity regressions pass.
- Task 3 checkbox is updated in index.md.
