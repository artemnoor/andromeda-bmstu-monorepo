from __future__ import annotations

import ast
from pathlib import Path
import tomllib


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _imports(source_root: Path) -> list[tuple[Path, str]]:
    imports: list[tuple[Path, str]] = []
    for path in ([source_root] if source_root.is_file() else source_root.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imports.extend((path, alias.name.split(".", 1)[0]) for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                imports.append((path, node.module.split(".", 1)[0]))
    return imports


def _assert_no_roots(source_root: Path, forbidden_roots: set[str]) -> None:
    violations = [
        (path.relative_to(PROJECT_ROOT), module_root)
        for path, module_root in _imports(source_root)
        if module_root in forbidden_roots
    ]
    assert not violations, f"forbidden imports under {source_root}: {violations}"


def test_domain_has_no_framework_database_service_or_parser_imports() -> None:
    domain = PROJECT_ROOT / "domain" / "src" / "andromeda_ontology"
    _assert_no_roots(
        domain,
        {
            "academic_data_service",
            "andromeda",
            "andromeda_api",
            "andromeda_contracts",
            "andromeda_db",
            "andromeda_parser",
            "dagster",
            "directus",
            "fastapi",
            "httpx",
            "pydantic",
            "requests",
            "sqlalchemy",
            "starlette",
        },
    )


def test_contracts_have_no_router_ui_database_or_platform_imports() -> None:
    contracts = PROJECT_ROOT / "packages" / "contracts" / "src" / "andromeda_contracts"
    _assert_no_roots(
        contracts,
        {
            "andromeda_api",
            "andromeda_db",
            "andromeda_parser",
            "apps",
            "dagster",
            "directus",
            "fastapi",
            "routers",
            "services",
            "sqlalchemy",
            "starlette",
        },
    )


def test_query_usecase_and_http_routers_do_not_import_database_adapters() -> None:
    query_module = PROJECT_ROOT / "services" / "api" / "src" / "andromeda_api" / "application" / "queries.py"
    routers = PROJECT_ROOT / "services" / "api" / "src" / "andromeda_api" / "routers"
    forbidden = {"andromeda_db", "sqlalchemy"}
    _assert_no_roots(query_module, forbidden)
    _assert_no_roots(routers, forbidden)


def test_ingestion_does_not_import_database_adapters_or_sql() -> None:
    ingestion = PROJECT_ROOT / "services" / "ingestion" / "src"
    _assert_no_roots(ingestion, {"andromeda_db", "sqlalchemy"})


def test_ingestion_does_not_depend_on_database_packages_directly() -> None:
    package = PROJECT_ROOT / "services" / "ingestion" / "pyproject.toml"
    project = tomllib.loads(package.read_text(encoding="utf-8"))["project"]
    dependencies = {
        dependency.split("[", 1)[0].split(">", 1)[0].split("=", 1)[0]
        for dependency in project["dependencies"]
    }
    assert not dependencies.intersection({"andromeda-db", "andromeda-academic-data-db"})


def test_api_service_does_not_import_ingestion_implementation() -> None:
    api = PROJECT_ROOT / "services" / "api" / "src" / "andromeda_api"
    _assert_no_roots(api, {"andromeda", "andromeda_parser"})