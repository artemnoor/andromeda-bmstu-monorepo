from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path
from typing import Any

import pytest
from academic_data_service.infrastructure.database import (
    admission_models,  # noqa: F401
    catalog_models,  # noqa: F401
    evidence_models,  # noqa: F401
    models,  # noqa: F401
    source_models,  # noqa: F401
    subject_classification_models,  # noqa: F401
)
from academic_data_service.infrastructure.database.base import Base

PROJECT_ROOT = Path(__file__).resolve().parents[1]
METADATA_ROOT = PROJECT_ROOT / "infra" / "directus" / "metadata"
MIGRATION_PATH = (
    PROJECT_ROOT
    / "academic-data"
    / "migrations"
    / "versions"
    / "f4b19a7c2d61_add_readonly_runtime_roles_and_views.py"
)


def _read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(value, dict)
    return value


def _read_directus_allowlist() -> set[str]:
    spec = importlib.util.spec_from_file_location("directus_roles_migration", MIGRATION_PATH)
    assert spec is not None and spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return set(migration.DIRECTUS_READ_TABLES)


def _read_metadata_applier():
    path = METADATA_ROOT / "apply_metadata.py"
    spec = importlib.util.spec_from_file_location("directus_metadata_applier", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _projected_columns(collection: str) -> set[str]:
    explicit_columns = {
        "active_release": {
            "id",
            "release_key",
            "source_bundle_sha256",
            "mapper_version",
            "committed_at",
            "reconciliation_status",
            "schema_revision",
        },
        "source_artifacts": {
            "id",
            "release_id",
            "external_key",
            "source_type",
            "requested_url",
            "final_url",
            "fetched_at",
            "sha256",
            "content_type",
            "byte_size",
            "status_code",
            "storage_status",
            "note",
            "created_at",
        },
        "source_evidence": {
            "id",
            "release_id",
            "external_key",
            "source_artifact_id",
            "field_path",
            "locator",
            "observed_at",
            "verification_status",
            "created_at",
        },
        "source_observations": {
            "id",
            "release_id",
            "external_key",
            "dataset_name",
            "source_artifact_id",
        },
    }
    if collection in explicit_columns:
        return explicit_columns[collection]
    assert collection in Base.metadata.tables, f"no SQLAlchemy model for {collection}"
    return set(Base.metadata.tables[collection].c.keys())


def test_directus_manifests_match_exact_read_allowlist_and_projection_fields() -> None:
    collection_manifest = _read_json(METADATA_ROOT / "collections.json")
    relation_manifest = _read_json(METADATA_ROOT / "relations.json")

    assert collection_manifest["directus_version"] == "12.4.1"
    assert collection_manifest["metadata_only"] is True
    assert relation_manifest["directus_version"] == "12.4.1"
    assert relation_manifest["physical_schema_changes"] is False

    folders = collection_manifest["folders"]
    collections = collection_manifest["collections"]
    relations = relation_manifest["relations"]
    presets = collection_manifest["presets"]
    allowlist = _read_directus_allowlist()

    collection_names = [item["collection"] for item in collections]
    assert len(collection_names) == len(set(collection_names))
    assert set(collection_names) == allowlist
    assert len(collection_names) == 57

    folder_names = {item["collection"] for item in folders}
    assert len(folder_names) == len(folders)
    assert len(folders) == 7
    assert all(item.get("group") in folder_names for item in collections)
    assert any(item.get("hidden") is True for item in folders)
    assert sum(not item.get("hidden", False) for item in collections) == 25
    assert sum(item.get("hidden", False) for item in collections) == 32

    columns_by_collection = {
        item["collection"]: _projected_columns(item["collection"]) for item in collections
    }
    assert "admission_result_sources" not in columns_by_collection
    assert "payload" not in columns_by_collection["source_observations"]
    assert "raw_path" not in columns_by_collection["source_artifacts"]

    for item in collections:
        name = item["collection"]
        columns = columns_by_collection[name]
        visible_fields = set(item.get("list_fields", []))
        assert visible_fields <= columns, f"{name} has unknown list fields: {visible_fields - columns}"
        template = item.get("display_template", "")
        template_fields = set(re.findall(r"{{\s*([A-Za-z_][A-Za-z0-9_]*)\s*}}", template))
        assert template_fields <= columns, (
            f"{name} display template has unknown fields: {template_fields - columns}"
        )

    for preset in presets:
        collection = preset["collection"]
        assert collection in columns_by_collection
        columns = columns_by_collection[collection]
        assert set(preset["fields"]) <= columns
        sort_field = preset["sort"].lstrip("+-")
        assert sort_field in columns
    assert len(presets) == 14
    assert len(relations) == 97

    relation_keys: set[tuple[str, str]] = set()
    reverse_aliases: set[tuple[str, str]] = set()
    for relation in relations:
        source = relation["collection"]
        field = relation["field"]
        target = relation["related_collection"]
        one_field = relation["one_field"]
        assert source in columns_by_collection
        assert target in columns_by_collection
        assert field in columns_by_collection[source]
        assert one_field.isidentifier()
        assert field not in {"id", "release_id"}
        key = (source, field)
        reverse_alias = (target, one_field)
        assert key not in relation_keys, f"duplicate relation source: {key}"
        assert reverse_alias not in reverse_aliases, f"duplicate reverse alias: {reverse_alias}"
        relation_keys.add(key)
        reverse_aliases.add(reverse_alias)

    assert relation_keys


def test_directus_1241_presets_use_the_actual_filter_contract() -> None:
    collection_manifest = _read_json(METADATA_ROOT / "collections.json")
    applier = _read_metadata_applier()

    payload = applier._preset_payload(collection_manifest["presets"][0])

    assert payload["filter"] is None
    assert "filters" not in payload


def test_directus_reverse_aliases_are_explicit_and_unique() -> None:
    relation_manifest = _read_json(METADATA_ROOT / "relations.json")
    applier = _read_metadata_applier()

    aliases = applier._reverse_aliases(relation_manifest["relations"])

    assert len(aliases) == 97
    assert len(aliases) == len(set(aliases))
    assert ("educational_programs", "study_plans") in aliases
    assert ("study_plans", "curriculum_items") in aliases
    assert ("admission_campaigns", "program_offerings") in aliases

    duplicate_aliases = [
        {"related_collection": "programs", "one_field": "study_plans"},
        {"related_collection": "programs", "one_field": "study_plans"},
    ]
    with pytest.raises(applier.DirectusApiError, match="Duplicate Directus reverse relation alias"):
        applier._reverse_aliases(duplicate_aliases)


def test_core_collection_metadata_keeps_navigation_folders() -> None:
    collection_manifest = _read_json(METADATA_ROOT / "collections.json")
    applier = _read_metadata_applier()

    program = next(
        item for item in collection_manifest["collections"]
        if item["collection"] == "educational_programs"
    )
    metadata = applier._collection_metadata(program, core_mode=True, core_sort=3)

    assert metadata["group"] == "01_catalog"
    assert metadata["sort"] == 3
    assert metadata["display_template"] == program["display_template"]
    assert metadata["translations"][0]["translation"] == program["label"]


def test_directus_metadata_writer_rejects_remote_or_production_targets() -> None:
    applier = _read_metadata_applier()

    for database_url in (
        "postgresql+psycopg://operator:secret@db.example.com/academic_data_test",
        "postgresql+psycopg://operator:secret@localhost/academic_data_2026",
        "postgresql+psycopg://andromeda_directus_runtime:secret@localhost/academic_data_test",
    ):
        with pytest.raises(applier.DirectusApiError):
            applier._validate_metadata_target(database_url)

    with pytest.raises(applier.DirectusApiError, match="local operator connection"):
        applier._validate_metadata_target(None)
