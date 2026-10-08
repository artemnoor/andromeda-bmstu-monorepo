"""Apply checked-in Directus presentation and virtual-relation metadata.

Collection, field, and preset presentation uses Directus system endpoints.
Virtual relations and reverse aliases are upserted only in the local
``directus_meta`` schema because Directus 12.4.1's Relations API attempts
physical foreign-key DDL on existing columns even with ``schema: null``.
The operator connection is restricted to local PostgreSQL 16 test/dev targets;
the script never writes academic items or changes academic schemas.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError, SQLAlchemyError

ROOT = Path(__file__).resolve().parent
COLLECTIONS_PATH = ROOT / "collections.json"
RELATIONS_PATH = ROOT / "relations.json"
INTERNAL_FIELDS = {"id", "release_id", "external_key"}


class DirectusApiError(RuntimeError):
    """A sanitized error from the Directus API."""


class DirectusClient:
    def __init__(self, base_url: str, access_token: str):
        self.base_url = base_url.rstrip("/")
        self.access_token = access_token

    def request(self, method: str, path: str, payload: Any = None) -> Any:
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        request = Request(
            f"{self.base_url}{path}",
            data=body,
            method=method,
            headers={
                "Authorization": f"Bearer {self.access_token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        try:
            with urlopen(request, timeout=20) as response:
                raw = response.read()
        except HTTPError as exc:
            # Avoid printing response bodies, which can contain internal details.
            raise DirectusApiError(f"Directus returned HTTP {exc.code} for {method} {path}") from None
        except URLError as exc:
            raise DirectusApiError(f"Could not reach Directus at {self.base_url}: {exc.reason}") from None
        if not raw:
            return None
        try:
            result = json.loads(raw)
        except json.JSONDecodeError:
            raise DirectusApiError(f"Directus returned invalid JSON for {method} {path}") from None
        if isinstance(result, dict) and "errors" in result:
            raise DirectusApiError(f"Directus reported an API error for {method} {path}")
        return result.get("data", result) if isinstance(result, dict) else result


def _login(base_url: str, email: str, password: str) -> str:
    payload = json.dumps({"email": email, "password": password, "mode": "json"}).encode("utf-8")
    request = Request(
        f"{base_url.rstrip('/')}/auth/login",
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urlopen(request, timeout=20) as response:
            result = json.loads(response.read())
    except HTTPError as exc:
        raise DirectusApiError(f"Directus authentication failed (HTTP {exc.code})") from None
    except (URLError, json.JSONDecodeError) as exc:
        reason = getattr(exc, "reason", "invalid JSON response")
        raise DirectusApiError(f"Could not authenticate with Directus: {reason}") from None
    token = result.get("data", {}).get("access_token")
    if not token:
        raise DirectusApiError("Directus login response did not contain an access token")
    return str(token)


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise DirectusApiError(f"Cannot read valid JSON from {path}: {exc}") from None
    if not isinstance(value, dict):
        raise DirectusApiError(f"Metadata file must contain a JSON object: {path}")
    return value


def _as_list(value: Any, label: str) -> list[dict[str, Any]]:
    if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
        raise DirectusApiError(f"Metadata property {label} must be a list of objects")
    return value


def _collection_metadata(
    item: dict[str, Any], *, core_mode: bool, core_sort: int | None = None
) -> dict[str, Any]:
    label = item.get("label")
    metadata = {
        "collection": item["collection"],
        "icon": item.get("icon"),
        "note": item.get("note"),
        "display_template": item.get("display_template"),
        "hidden": bool(item.get("hidden", False)),
        "singleton": bool(item.get("singleton", False)),
        "group": item.get("group"),
        "sort": core_sort if core_mode else item.get("sort"),
        "translations": [
            {
                "language": "ru-RU",
                "translation": label,
                "singular": label,
                "plural": label,
            }
        ] if label else item.get("translations"),
    }
    result = {key: value for key, value in metadata.items() if value is not None}
    return result


def _folder_metadata(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "collection": item["collection"],
        "icon": item.get("icon"),
        "note": item.get("note"),
        "hidden": bool(item.get("hidden", False)),
        "singleton": False,
        "group": None,
        "sort": item.get("sort"),
        "collapse": "closed",
        "translations": item.get("translations"),
    }


def _relation_payload(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "collection": item["collection"],
        "field": item["field"],
        "related_collection": item["related_collection"],
        # CTAS read-model tables have no physical FK constraints. Keep the
        # relationship exclusively in Directus metadata.
        "schema": None,
        "meta": {
            "many_collection": item["collection"],
            "many_field": item["field"],
            "one_collection": item["related_collection"],
            "one_field": item["one_field"],
            "one_allowed_collections": None,
            "one_collection_field": None,
            "one_deselect_action": "nullify",
            "sort_field": None,
            "junction_field": None,
        },
    }


def _reverse_aliases(relations: list[dict[str, Any]]) -> list[tuple[str, str]]:
    """Return the exact O2M metadata fields declared by the relation manifest."""
    aliases = [
        (relation["related_collection"], relation["one_field"])
        for relation in relations
        if relation.get("one_field")
    ]
    if len(aliases) != len(set(aliases)):
        raise DirectusApiError("Duplicate Directus reverse relation alias in relation manifest")
    return sorted(aliases)


def _validate_metadata_target(database_url: str | None) -> None:
    """Fail closed unless metadata writes target a local PostgreSQL 16 test/dev DB."""
    if not database_url:
        raise DirectusApiError(
            "Set ACADEMIC_DATA_DATABASE_URL to a local operator connection for directus_meta"
        )
    try:
        parsed = make_url(database_url)
    except (ArgumentError, TypeError, ValueError):
        raise DirectusApiError("ACADEMIC_DATA_DATABASE_URL is not a valid SQLAlchemy URL") from None
    if parsed.drivername not in {"postgresql", "postgresql+psycopg"}:
        raise DirectusApiError("Directus metadata can only be applied to PostgreSQL")
    if parsed.host not in {"localhost", "127.0.0.1"}:
        raise DirectusApiError("Directus metadata writes are restricted to localhost PostgreSQL")
    if parsed.database != "academic_data_test" and not (parsed.database or "").endswith("_dev"):
        raise DirectusApiError(
            "Directus metadata writes are restricted to academic_data_test or a local *_dev database"
        )
    if parsed.username == "andromeda_directus_runtime":
        raise DirectusApiError("Use the local database operator connection, not the Directus runtime role")

    engine = create_engine(database_url, pool_pre_ping=True)
    try:
        with engine.connect() as connection:
            current_database, server_version = connection.execute(
                text("SELECT current_database(), current_setting('server_version_num')::integer")
            ).one()
            if current_database != parsed.database or server_version // 10000 != 16:
                raise DirectusApiError(
                    "Directus metadata writes require the matching local PostgreSQL 16 database"
                )
            required_metadata = {
                "directus_relations": {
                    "many_collection", "many_field", "one_collection", "one_field",
                    "one_collection_field", "one_allowed_collections", "junction_field",
                    "sort_field", "one_deselect_action",
                },
                "directus_fields": {
                    "collection", "field", "special", "interface", "readonly", "hidden",
                },
                "directus_collections": {"collection"},
            }
            for table, required_columns in required_metadata.items():
                available = {
                    row[0]
                    for row in connection.execute(
                        text(
                            "SELECT column_name FROM information_schema.columns "
                            "WHERE table_schema='directus_meta' AND table_name=:table"
                        ),
                        {"table": table},
                    )
                }
                if not required_columns <= available:
                    raise DirectusApiError(
                        "Directus metadata store is uninitialized or has an unsupported schema; "
                        "no UI metadata has been changed"
                    )
                for privilege in ("INSERT", "UPDATE", "DELETE"):
                    allowed = connection.execute(
                        text("SELECT has_table_privilege(current_user, :table, :privilege)"),
                        {"table": f"directus_meta.{table}", "privilege": privilege},
                    ).scalar_one()
                    if not allowed:
                        raise DirectusApiError(
                            "The local operator connection lacks required Directus metadata table privileges"
                        )
            if not connection.execute(
                text("SELECT has_schema_privilege(current_user, 'directus_meta', 'USAGE')")
            ).scalar_one():
                raise DirectusApiError("The local operator connection cannot access directus_meta")
    except SQLAlchemyError as exc:
        detail = getattr(exc, "orig", exc)
        safe_detail = str(detail).splitlines()[0][:180]
        raise DirectusApiError(
            f"Could not preflight the local Directus metadata database ({type(exc).__name__}: {safe_detail})"
        ) from None
    finally:
        engine.dispose()


def _preset_payload(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "bookmark": None,
        "user": None,
        "role": None,
        "collection": item["collection"],
        "search": None,
        # Directus 12.4.1 exposes the stored `filter` column on this endpoint.
        "filter": None,
        "layout": "tabular",
        "layout_query": {
            "tabular": {
                "fields": item["fields"],
                "sort": item.get("sort"),
                "page": 1,
            }
        },
        "layout_options": {"tabular": {"widths": {}}},
    }


def preflight(
    client: DirectusClient,
    collections_config: dict[str, Any],
    relations_config: dict[str, Any],
) -> tuple[
    dict[str, dict[str, Any]],
    dict[str, dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
]:
    collections = _as_list(collections_config.get("collections"), "collections")
    folders = _as_list(collections_config.get("folders"), "folders")
    relations = _as_list(relations_config.get("relations"), "relations")
    presets = _as_list(collections_config.get("presets"), "presets")

    folder_names = [folder.get("collection") for folder in folders]
    if any(not isinstance(name, str) or not name for name in folder_names):
        raise DirectusApiError("Every navigation folder must have a collection name")
    if len(folder_names) != len(set(folder_names)):
        raise DirectusApiError("Duplicate navigation folder in collections.json")
    unknown_groups = sorted(
        {
            item.get("group")
            for item in collections
            if item.get("group") is not None and item.get("group") not in folder_names
        }
    )
    if unknown_groups:
        raise DirectusApiError(
            "Collections reference undefined navigation folders: " + ", ".join(unknown_groups)
        )

    collection_rows = client.request("GET", "/collections?limit=-1")
    if not isinstance(collection_rows, list):
        raise DirectusApiError("Directus collections endpoint did not return a list")
    collection_map = {row.get("collection"): row for row in collection_rows if row.get("collection")}

    expected = {row["collection"] for row in collections}
    if len(expected) != len(collections):
        raise DirectusApiError("Duplicate collection entry in collections.json")
    missing = sorted(expected - collection_map.keys())
    if missing:
        raise DirectusApiError(
            "Expected directus_read collections are unavailable; refusing partial metadata apply: "
            + ", ".join(missing)
        )

    fields_by_collection: dict[str, dict[str, Any]] = {}
    for name in sorted(expected):
        encoded_name = quote(name, safe="")
        field_rows = client.request("GET", f"/fields/{encoded_name}")
        if not isinstance(field_rows, list):
            raise DirectusApiError(f"Directus did not return fields for {name}")
        fields_by_collection[name] = {
            field.get("field"): field for field in field_rows if field.get("field")
        }

    errors: list[str] = []
    for item in collections:
        name = item["collection"]
        for field in item.get("list_fields", []):
            if field not in fields_by_collection[name]:
                errors.append(f"{name}.{field} missing (display/preset field)")

    relation_sources: set[tuple[str, str]] = set()
    alias_targets: set[tuple[str, str]] = set()
    for relation in relations:
        source_key = (relation.get("collection"), relation.get("field"))
        target = relation.get("related_collection")
        if source_key in relation_sources:
            errors.append(f"duplicate relation source {source_key}")
        relation_sources.add(source_key)
        alias_key = (target, relation.get("one_field"))
        if alias_key in alias_targets:
            errors.append(f"duplicate reverse alias {alias_key}")
        alias_targets.add(alias_key)
        source_fields = fields_by_collection.get(source_key[0], {})
        target_fields = fields_by_collection.get(str(target), {})
        if source_key[0] not in expected:
            errors.append(f"relation source collection not allowlisted: {source_key[0]}")
        if target not in expected:
            errors.append(f"relation target collection not allowlisted: {target}")
        if source_key[1] not in source_fields:
            errors.append(f"relation source field not found: {source_key[0]}.{source_key[1]}")
        elif source_fields[source_key[1]].get("type") not in {"uuid", "string"}:
            errors.append(f"relation field is not a UUID-compatible value: {source_key[0]}.{source_key[1]}")
        if "id" not in target_fields:
            errors.append(f"relation target has no id field: {target}")
        elif target_fields["id"].get("type") not in {"uuid", "string"}:
            errors.append(f"relation target id is not UUID-compatible: {target}.id")
        existing_alias = target_fields.get(alias_key[1])
        if existing_alias:
            alias_meta = existing_alias.get("meta") or {}
            alias_special = alias_meta.get("special") or []
            if isinstance(alias_special, str):
                alias_special = alias_special.split(",")
            if (
                existing_alias.get("type") != "alias"
                or existing_alias.get("schema") is not None
                or "o2m" not in alias_special
            ):
                errors.append(f"reverse alias conflicts with physical field: {alias_key}")

    preset_collections: set[str] = set()
    for preset in presets:
        name = preset.get("collection")
        if name not in expected:
            errors.append(f"preset collection not allowlisted: {name}")
        if name in preset_collections:
            errors.append(f"duplicate global preset for {name}")
        preset_collections.add(str(name))
        for field in preset.get("fields", []):
            if field not in fields_by_collection.get(str(name), {}):
                errors.append(f"preset field not found: {name}.{field}")

    if errors:
        raise DirectusApiError("Metadata preflight failed; no changes were made:\n- " + "\n- ".join(errors))

    relation_rows = client.request("GET", "/relations?limit=-1")
    if not isinstance(relation_rows, list):
        raise DirectusApiError("Directus relations endpoint did not return a list")
    relation_map = {
        (row.get("collection"), row.get("field")): row
        for row in relation_rows
        if row.get("collection") and row.get("field")
    }
    for item in relations:
        existing = relation_map.get((item["collection"], item["field"]))
        if existing and existing.get("schema") is not None:
            raise DirectusApiError(
                "Expected metadata-only relation but found a physical FK schema for "
                f"{item['collection']}.{item['field']}; refusing to modify it"
            )

    preset_rows = client.request("GET", "/presets?limit=-1&fields=id,collection,bookmark,user,role")
    if not isinstance(preset_rows, list):
        raise DirectusApiError("Directus presets endpoint did not return a list")
    for preset in presets:
        name = preset["collection"]
        matching = [
            row for row in preset_rows
            if row.get("collection") == name
            and row.get("bookmark") is None
            and row.get("user") is None
            and row.get("role") is None
        ]
        if len(matching) > 1:
            errors.append(f"multiple global default presets exist for {name}")
    if errors:
        raise DirectusApiError("Metadata preflight failed; no changes were made:\n- " + "\n- ".join(errors))

    return collection_map, fields_by_collection, relation_rows, preset_rows


def _same_subset(existing: dict[str, Any], expected: dict[str, Any]) -> bool:
    return all(existing.get(key) == value for key, value in expected.items())


def _write_directus_metadata(
    database_url: str,
    relations: list[dict[str, Any]],
    hidden_collections: list[str],
) -> tuple[int, int, int, int, int]:
    """Write only Directus metadata rows, avoiding the Relations API's FK DDL path.

    Directus 12.4.1's POST /relations attempts to add a PostgreSQL foreign key
    for an existing UUID column even when the request contains ``schema: null``.
    That behavior is incompatible with disposable read-only projections. The
    virtual relation contract is therefore written directly to Directus-owned
    ``directus_meta.directus_relations`` using an operator connection. Directus
    also needs explicit ``directus_fields`` alias rows for O2M navigation; a
    relation's ``one_field`` alone is not enough for permission-aware item
    expansion. Hidden technical tables are left database-only in Directus so
    the Core tier's 25-collection limit is respected. No academic schema/table
    is modified and this code issues no DDL.
    """
    engine = create_engine(database_url, pool_pre_ping=True)
    created = updated = removed = aliases_created = aliases_updated = 0
    try:
        with engine.begin() as connection:
            metadata_table = connection.execute(
                text("SELECT to_regclass('directus_meta.directus_relations')")
            ).scalar_one_or_none()
            if metadata_table is None:
                raise DirectusApiError(
                    "Directus metadata is not initialized; start Directus before applying virtual relations"
                )

            metadata_tables = {
                row[0]
                for row in connection.execute(
                    text(
                        "SELECT table_name FROM information_schema.tables "
                        "WHERE table_schema='directus_meta'"
                    )
                )
            }
            if not {"directus_collections", "directus_fields"} <= metadata_tables:
                raise DirectusApiError(
                    "Directus collection metadata tables are unavailable; refusing metadata cleanup"
                )

            field_columns = {
                row[0]
                for row in connection.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_schema='directus_meta' AND table_name='directus_fields'"
                    )
                )
            }
            required_field_columns = {
                "id", "collection", "field", "special", "interface", "readonly", "hidden"
            }
            if not required_field_columns <= field_columns:
                raise DirectusApiError(
                    "Directus 12.4.1 field metadata table has an unexpected shape; refusing to register aliases"
                )

            required_columns = {
                row[0]
                for row in connection.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_schema='directus_meta' AND table_name='directus_relations'"
                    )
                )
            }
            expected_columns = {
                "id",
                "many_collection",
                "many_field",
                "one_collection",
                "one_field",
                "one_collection_field",
                "one_allowed_collections",
                "junction_field",
                "sort_field",
                "one_deselect_action",
            }
            if not expected_columns <= required_columns:
                raise DirectusApiError(
                    "Directus 12.4.1 relation metadata table has an unexpected shape; refusing to write"
                )

            for relation in relations:
                parameters = {
                    "many_collection": relation["collection"],
                    "many_field": relation["field"],
                    "one_collection": relation["related_collection"],
                    "one_field": relation["one_field"],
                }
                matches = connection.execute(
                    text(
                        "SELECT id, one_collection, one_field, one_collection_field, "
                        "one_allowed_collections, junction_field, sort_field, one_deselect_action "
                        "FROM directus_meta.directus_relations "
                        "WHERE many_collection=:many_collection AND many_field=:many_field "
                        "ORDER BY id"
                    ),
                    parameters,
                ).mappings().all()
                if len(matches) > 1:
                    raise DirectusApiError(
                        "Duplicate Directus metadata relation rows found for "
                        f"{parameters['many_collection']}.{parameters['many_field']}"
                    )

                values = {
                    **parameters,
                    "one_collection_field": None,
                    "one_allowed_collections": None,
                    "junction_field": None,
                    "sort_field": None,
                    "one_deselect_action": "nullify",
                }
                if matches:
                    current = dict(matches[0])
                    expected = {key: value for key, value in values.items() if key not in parameters}
                    expected.update(
                        one_collection=parameters["one_collection"],
                        one_field=parameters["one_field"],
                    )
                    if _same_subset(current, expected):
                        continue
                    connection.execute(
                        text(
                            "UPDATE directus_meta.directus_relations SET "
                            "one_collection=:one_collection, one_field=:one_field, "
                            "one_collection_field=:one_collection_field, "
                            "one_allowed_collections=:one_allowed_collections, "
                            "junction_field=:junction_field, sort_field=:sort_field, "
                            "one_deselect_action=:one_deselect_action WHERE id=:id"
                        ),
                        {**values, "id": current["id"]},
                    )
                    updated += 1
                else:
                    connection.execute(
                        text(
                            "INSERT INTO directus_meta.directus_relations "
                            "(many_collection, many_field, one_collection, one_field, "
                            "one_collection_field, one_allowed_collections, junction_field, "
                            "sort_field, one_deselect_action) VALUES "
                            "(:many_collection, :many_field, :one_collection, :one_field, "
                            ":one_collection_field, :one_allowed_collections, :junction_field, "
                            ":sort_field, :one_deselect_action)"
                        ),
                        values,
                    )
                    created += 1

            # A Directus relation's one_field is a virtual reverse relation.
            # Registering it only in directus_relations is insufficient for
            # GET /items nested expansion because Directus also resolves field
            # permissions from directus_fields. Register aliases as `o2m`
            # metadata (never as columns), and mark the UI field read-only.
            for collection, field in _reverse_aliases(relations):
                existing = connection.execute(
                    text(
                        "SELECT id, special, interface, readonly, hidden "
                        "FROM directus_meta.directus_fields "
                        "WHERE collection=:collection AND field=:field ORDER BY id"
                    ),
                    {"collection": collection, "field": field},
                ).mappings().all()
                if len(existing) > 1:
                    raise DirectusApiError(
                        f"Duplicate Directus field metadata found for {collection}.{field}"
                    )
                if existing:
                    current = dict(existing[0])
                    expected_alias = {
                        "special": "o2m",
                        "interface": "list-o2m",
                        "readonly": True,
                        "hidden": False,
                    }
                    if _same_subset(current, expected_alias):
                        continue
                    connection.execute(
                        text(
                            "UPDATE directus_meta.directus_fields SET special=:special, "
                            "interface=:interface, readonly=:readonly, hidden=:hidden "
                            "WHERE id=:id"
                        ),
                        {**expected_alias, "id": current["id"]},
                    )
                    aliases_updated += 1
                else:
                    connection.execute(
                        text(
                            "INSERT INTO directus_meta.directus_fields "
                            "(collection, field, special, interface, readonly, hidden) "
                            "VALUES (:collection, :field, 'o2m', 'list-o2m', true, false)"
                        ),
                        {"collection": collection, "field": field},
                    )
                    aliases_created += 1

            # These rows are Directus presentation metadata, not academic data.
            # The underlying allowlisted read-only SQL projections stay intact.
            for collection in hidden_collections:
                deleted_fields = connection.execute(
                    text(
                        "DELETE FROM directus_meta.directus_fields "
                        "WHERE collection=:collection AND special IS DISTINCT FROM 'o2m'"
                    ),
                    {"collection": collection},
                )
                deleted_collection = connection.execute(
                    text("DELETE FROM directus_meta.directus_collections WHERE collection=:collection"),
                    {"collection": collection},
                )
                if deleted_fields.rowcount or deleted_collection.rowcount:
                    removed += 1
    except SQLAlchemyError as exc:
        detail = getattr(exc, "orig", exc)
        safe_detail = str(detail).splitlines()[0][:240]
        raise DirectusApiError(
            "Could not apply Directus-owned metadata; no academic schema was targeted "
            f"({type(exc).__name__}: {safe_detail})"
        ) from exc
    finally:
        engine.dispose()
    return created, updated, removed, aliases_created, aliases_updated


def apply_metadata(
    client: DirectusClient,
    collections_config: dict[str, Any],
    relations_config: dict[str, Any],
    dry_run: bool,
    database_url: str | None = None,
    mode: str = "core",
) -> None:
    if not dry_run:
        _validate_metadata_target(database_url)
    collection_map, _fields_by_collection, _relation_rows, preset_rows = preflight(
        client, collections_config, relations_config
    )
    if mode not in {"core", "licensed"}:
        raise DirectusApiError("Metadata mode must be 'core' or 'licensed'")
    if mode == "licensed" and not os.environ.get("DIRECTUS_LICENSE_KEY"):
        raise DirectusApiError(
            "licensed metadata mode requires DIRECTUS_LICENSE_KEY; use core mode for the 25-collection tier"
        )
    action = "would" if dry_run else "will"
    visible_collections = [
        item for item in collections_config["collections"] if not item.get("hidden", False)
    ]
    metadata_collections = (
        collections_config["collections"] if mode == "licensed" else visible_collections
    )
    visible_groups = {item.get("group") for item in visible_collections}
    metadata_folders = [
        folder
        for folder in collections_config["folders"]
        if mode == "licensed"
        or (not folder.get("hidden", False) and folder["collection"] in visible_groups)
    ]
    unregistered_collections = []
    if mode == "core":
        unregistered_collections = [
            item["collection"]
            for item in collections_config["collections"]
            if item.get("hidden", False)
        ]
    print(f"Preflight passed. {action} apply Directus presentation and virtual-relation metadata only.")

    for folder in metadata_folders:
        name = folder["collection"]
        meta = _folder_metadata(folder)
        if name not in collection_map:
            print(f"{action} create navigation folder {name}")
            if not dry_run:
                client.request(
                    "POST",
                    "/collections",
                    {"collection": name, "schema": None, "fields": [], "meta": meta},
                )
        else:
            current_meta = collection_map[name].get("meta") or {}
            if not _same_subset(current_meta, meta):
                print(f"{action} update folder metadata {name}")
                if not dry_run:
                    client.request("PATCH", f"/collections/{quote(name, safe='')}", {"meta": meta})

    for index, item in enumerate(metadata_collections, start=1):
        name = item["collection"]
        meta = _collection_metadata(
            item,
            core_mode=mode == "core",
            core_sort=index,
        )
        current_meta = collection_map[name].get("meta") or {}
        if not _same_subset(current_meta, meta):
            print(f"{action} update collection metadata {name}")
            if not dry_run:
                client.request("PATCH", f"/collections/{quote(name, safe='')}", {"meta": meta})

    if dry_run:
        print(
            f"would register {len(relations_config['relations'])} virtual relations; "
            f"keep {len(visible_collections)} data collections and {len(metadata_folders)} folders configured, "
            f"leave {len(unregistered_collections)} technical data collections database-only"
        )
    else:
        created, updated, removed, aliases_created, aliases_updated = _write_directus_metadata(
            database_url or "", relations_config["relations"], unregistered_collections
        )
        print(
            f"Directus metadata: {created} virtual relations created, {updated} updated, "
            f"{aliases_created} reverse aliases created, {aliases_updated} updated, "
            f"{removed} hidden collection registrations removed"
        )
        if created or updated or aliases_created or aliases_updated:
            print("Restart Directus to reload the virtual relation and reverse-alias schema cache.")

    for item in collections_config["presets"]:
        payload = _preset_payload(item)
        matching = [
            row for row in preset_rows
            if row.get("collection") == item["collection"]
            and row.get("bookmark") is None
            and row.get("user") is None
            and row.get("role") is None
        ]
        if matching:
            preset_id = matching[0]["id"]
            current = client.request("GET", f"/presets/{quote(str(preset_id), safe='')}")
            if _same_subset(current, payload):
                continue
            print(f"{action} default tabular preset for {item['collection']}")
            if not dry_run:
                client.request("PATCH", f"/presets/{quote(str(preset_id), safe='')}", payload)
        else:
            print(f"{action} global default tabular preset for {item['collection']}")
            if not dry_run:
                client.request("POST", "/presets", payload)

    # Apply field presentation last so newly-created O2M aliases also inherit
    # the UI-level read-only state. The PostgreSQL grants remain authoritative.
    refreshed_fields: dict[str, dict[str, Any]] = {}
    for item in metadata_collections:
        name = item["collection"]
        rows = client.request("GET", f"/fields/{quote(name, safe='')}")
        refreshed_fields[name] = {
            row.get("field"): row for row in rows if isinstance(row, dict) and row.get("field")
        }
    for item in metadata_collections:
        name = item["collection"]
        field_map = refreshed_fields[name]
        sort_order = {field: index for index, field in enumerate(item.get("list_fields", []), start=1)}
        for field_name, field_row in field_map.items():
            meta_patch: dict[str, Any] = {"readonly": True}
            if field_name in INTERNAL_FIELDS:
                meta_patch["hidden"] = True
            if field_name in sort_order:
                meta_patch["sort"] = sort_order[field_name]
                meta_patch["width"] = "half" if field_name.endswith("_id") else "full"
            current_meta = field_row.get("meta") or {}
            if not _same_subset(current_meta, meta_patch):
                print(f"{action} field metadata {name}.{field_name}")
                if not dry_run:
                    client.request(
                        "PATCH",
                        f"/fields/{quote(name, safe='')}/{quote(field_name, safe='')}",
                        {"meta": meta_patch},
                    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base-url",
        default=os.environ.get("DIRECTUS_URL", "http://127.0.0.1:8055"),
        help="Directus base URL (defaults to DIRECTUS_URL or localhost)",
    )
    parser.add_argument("--collections", type=Path, default=COLLECTIONS_PATH)
    parser.add_argument("--relations", type=Path, default=RELATIONS_PATH)
    parser.add_argument(
        "--mode",
        choices=("core", "licensed"),
        default=os.environ.get("DIRECTUS_METADATA_MODE", "core"),
        help="core registers up to 25 domain collections; licensed enables the complete grouped catalog",
    )
    parser.add_argument("--dry-run", action="store_true", help="Authenticate and preflight without applying metadata")
    args = parser.parse_args()

    email = os.environ.get("DIRECTUS_ADMIN_EMAIL")
    password = os.environ.get("DIRECTUS_ADMIN_PASSWORD")
    if not email or not password:
        print("Set DIRECTUS_ADMIN_EMAIL and DIRECTUS_ADMIN_PASSWORD in the environment.", file=sys.stderr)
        return 2

    try:
        collections_config = _read_json(args.collections)
        relations_config = _read_json(args.relations)
        if collections_config.get("directus_version") != "12.4.1":
            raise DirectusApiError("Metadata manifest is pinned to an unsupported Directus version")
        if relations_config.get("directus_version") != "12.4.1":
            raise DirectusApiError("Relation manifest is pinned to an unsupported Directus version")
        if collections_config.get("metadata_only") is not True:
            raise DirectusApiError("Refusing to apply a manifest that is not marked metadata_only")
        if relations_config.get("physical_schema_changes") is not False:
            raise DirectusApiError("Refusing relations manifest that allows physical schema changes")
        token = _login(args.base_url, email, password)
        client = DirectusClient(args.base_url, token)
        apply_metadata(
            client,
            collections_config,
            relations_config,
            args.dry_run,
            database_url=os.environ.get("ACADEMIC_DATA_DATABASE_URL"),
            mode=args.mode,
        )
    except DirectusApiError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print("Directus viewer metadata is up to date." if not args.dry_run else "Dry-run completed; no metadata was changed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
