# Phase 4: Ingestion Relocation

Plan: [index.md](index.md)
Tasks: 4
Depends on: Task 3

## Objective

Move the active parser and candidate/review pipeline to services/ingestion without changing parser output, exact-key moderation or CLI behavior.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|------|-----------------|----------------|
| parsers/src/andromeda/ingestion | BMSTU capture, parsing and normalization | Active parser implementation |
| parsers/src/andromeda_parser | capture, parse, candidate, diff, review and CLI | Operator pipeline |
| tests/test_bmstu_ingestion.py | parser/review regression | Parser and provenance behavior |
| tests/test_bmstu_parser_cli.py | CLI/module inventory | Command compatibility |
| tests/test_curriculum_identity.py | stable curriculum keys | External-key compatibility |

## Files to Change

| Path | Action | Required change |
|------|--------|-----------------|
| services/ingestion/pyproject.toml | create | Define andromeda-ingestion distribution and existing scripts |
| services/ingestion/src/** | move | Own current parser source namespaces |
| services/ingestion/parsers/bmstu/** | create/move | Place BMSTU adapters, selectors, normalizers and parsers |
| services/ingestion/contracts/** | move | Own raw and normalized parser DTOs |
| parsers/** | delete after migration | Remove duplicate active implementation owner |
| tests/** | modify | Update imports only; preserve fixture bytes |

## Task 4: Move parser pipeline into services/ingestion

### Intent

Give ingestion one runtime owner while keeping the existing capture-to-publication preparation behavior and operator entry points.

### Implementation Steps

1. Move andromeda_parser and andromeda ingestion namespaces into services/ingestion. Preserve source modules and fixtures; do not rewrite parsers during relocation.
2. Organize BMSTU adapters, parser modules, jobs, validation, assets and source contracts under the target service layout. Add README files only where they explain ownership or commands.
3. Update uv workspace/package metadata and explicitly declare contracts, domain and application-service dependencies.
4. Preserve the andromeda-bmstu and academic-data command names and subcommands. Route academic-data DB commands to packages/db and bundle operations to the ingestion/application service.
5. Ensure parser code writes raw/candidate artifacts only. Remove direct ORM imports and direct canonical SQL from ingestion.
6. Remove parsers/ after all tests, entry points and docs use services/ingestion.

### Required Interfaces and Contracts

- Keep capture → parse → normalize → candidate → diff → review → materialize → validate → commit order.
- Preserve exact-key moderation, no fuzzy auto-merge, partial-source protection, hashes/provenance, curriculum identity, quotas, evidence and repeated-parse idempotence.
- Preserve parser/CLI output schemas and checked-in fixture bytes.

### Requirement Evidence

- User task attachment sections 6, 7, 22, 23, 24 and 28.
- Architecture v1.1 sections 5 and 14 phase 4.

### Error Handling and Logging

- Preserve fetch policy, source allowlists, PDF limits, redaction and failure codes.
- Use configurable structured logs with parser ID, source ID, phase, digest and outcome; omit document contents and credentials.

### Tests

- Run ingestion, parser CLI, curriculum identity and offline bundle regression suites.
- Add a dependency-boundary assertion that ingestion imports no andromeda_db adapter.
- Check both console scripts from a locked non-editable install.

### Acceptance Criteria

- services/ingestion is the sole parser owner; parsers/ no longer exists.
- Existing CLI names and tested behavior remain available.
- No parser has a direct canonical write path.

### Verification

- uv sync --locked --all-packages --group dev --no-editable
- uv run --package andromeda-ingestion andromeda-bmstu list
- Compare fixture capture hashes and normalized output digests.
- Search for active imports from parsers and direct andromeda_db imports under services/ingestion.

## Phase Risks and Mitigations

- Risk: lazy imports conceal undeclared package dependencies. Mitigation: run all scripts/modules from a clean non-editable install.
- Risk: tests rely on old import paths. Mitigation: update to canonical paths and remove shims after last call site moves.

## Phase Completion Checklist

- Parser fixtures and CLI regressions pass.
- Old parser root and stale imports are gone.
- Task 4 checkbox is updated in index.md.
