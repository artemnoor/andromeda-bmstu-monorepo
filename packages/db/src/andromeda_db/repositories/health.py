"""Safe database and active-release facts used by readiness and preflight checks."""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection


def load_readiness_facts(connection: Connection) -> dict[str, Any]:
    """Read server, schema, and release facts without exposing database contents."""

    database_name, version_number = connection.execute(
        text("SELECT current_database(), current_setting('server_version_num')::integer")
    ).one()
    version_table = connection.execute(
        text("SELECT to_regclass('academic_data_alembic_version')::text")
    ).scalar_one_or_none()
    schema_revision = None
    release_tables: tuple[str | None, str | None] = (None, None)
    release = None
    if version_table is not None:
        schema_revision = connection.execute(
            text("SELECT version_num FROM academic_data_alembic_version LIMIT 1")
        ).scalar_one_or_none()
        release_tables = connection.execute(
            text(
                "SELECT to_regclass('active_data_release')::text, "
                "to_regclass('data_releases')::text"
            )
        ).one()
        if all(release_tables):
            release = (
                connection.execute(
                    text(
                        "SELECT r.release_key, r.source_bundle_sha256, r.status, "
                        "r.reconciliation_status FROM active_data_release AS a "
                        "JOIN data_releases AS r ON r.id = a.release_id "
                        "WHERE a.slot_key = 'active'"
                    )
                )
                .mappings()
                .first()
            )
    return {
        "database_name": database_name,
        "server_version_number": int(str(version_number)),
        "schema_revision": schema_revision,
        "version_table_exists": version_table is not None,
        "release_tables_exist": all(release_tables),
        "active_release": dict(release) if release is not None else None,
    }
