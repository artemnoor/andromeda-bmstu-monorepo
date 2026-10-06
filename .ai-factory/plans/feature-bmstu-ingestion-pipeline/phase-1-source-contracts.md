# Phase 1 — Selective BMSTU source and contract closure

## Goal and exact files

Restore only the legacy BMSTU adapter's transitive runtime dependencies into
the active parser package, preserving upstream domain contracts rather than
inventing replacements.

- Copy `andromeda-parsers/parsers/source-tree/src/andromeda/ingestion/universities/bmstu/**`
  to `parsers/src/andromeda/ingestion/universities/bmstu/**`.
- Copy the exact AST-resolved closure from
  `hackathon-max-andromeda/services/andromeda/backend/src/andromeda/modules/**`
  and `.../shared/**` into the corresponding `parsers/src/andromeda/` package
  paths. Keep copied support limited to modules required by the BMSTU runtime;
  record its actual scope in `docs/INGESTION_AUDIT.md` after implementation.
- Copy required ingestion contracts/policies from the monolith into
  `parsers/src/andromeda/ingestion/contracts/**`, including
  `fetch_policy.py` and `pdf_policy.py` only when in the closure.
- Exclude legacy `backend`, ORM/database persistence, FastAPI routes, account
  services, HSE, and
  `parsers/source-tree/src/andromeda/ingestion/universities/bmstu/reconcile_confirmed_plan_links.py`
  because its optional visualizer import is unresolved and it is not part of
  parser correctness.
- Update `parsers/pyproject.toml` and the root `uv.lock` only for direct parser
  runtime dependencies actually used by the copied source (HTTPX, Beautiful
  Soup, Pydantic, PDF text/table readers); do not include browser/Playwright.
- Update `parsers/src/andromeda/ingestion/universities/__init__.py` only as
  needed to expose BMSTU; do not register HSE.

## Interfaces and constraints

- Preserve upstream names: `BmstuUniversityAdapter.capture()` and `.parse()`;
  `CapturedSources`; `RawTracerBundle`; `CanonicalSnapshot`.
- The parser package must not import `academic_data_service` or SQLAlchemy.
- Python baseline is 3.11. Use exact locked dependency versions through the
  existing `uv` workspace.
- No Alembic revisions or importer files change in this phase.

## Error handling and logging

- Keep typed `ContractError` diagnostics for malformed source payloads.
- Never include response bodies, applicant details, cookies, or tokens in
  exception/log fields.
- Follow existing upstream module loggers; the CLI installs redaction before
  running them in Phase 2.

## Tests and acceptance

- All active package modules import on Python 3.11.
- `BmstuUniversityAdapter` imports and parses checked local catalog/detail
  fixtures.
- HSE is absent from active package discovery and CLI registry.
- No module in the copied closure imports legacy ORM, FastAPI, or user-profile
  persistence.
- Recompute and list the exact runtime import closure; all source dependencies
  resolve and the optional visualizer is the only deliberately excluded helper.

Commands:

```powershell
uv sync --locked --all-packages --group dev --no-editable
uv run --no-editable pytest -q tests/test_bmstu_parser_cli.py
uv run --no-editable python -c "import andromeda.ingestion.universities.bmstu.adapter"
```
