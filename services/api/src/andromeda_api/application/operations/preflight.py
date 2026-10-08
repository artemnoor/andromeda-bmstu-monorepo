"""Read-only preflight for target identity, schema, active release, and disk."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from andromeda_db.connection import (
    create_service_engine,
    verify_server_identity,
)
from andromeda_db.repositories.health import load_readiness_facts
from sqlalchemy.exc import SQLAlchemyError

from andromeda_api.application.settings import (
    SERVICE_DATABASE_NAME,
    SettingsError,
    load_settings,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--disk-path",
        type=Path,
        required=True,
        help="Mounted path of the PostgreSQL data volume",
    )
    parser.add_argument(
        "--minimum-free-gib",
        type=float,
        default=1.0,
        help="Refuse preflight below this free-disk threshold",
    )
    arguments = parser.parse_args()
    if arguments.minimum_free_gib <= 0:
        parser.error("--minimum-free-gib must be greater than zero")

    try:
        settings = load_settings()
        if settings.environment not in {"staging", "production"}:
            raise SettingsError("Preflight requires ACADEMIC_DATA_ENV=staging or production")
        if settings.database_name != SERVICE_DATABASE_NAME:
            raise SettingsError(f"Target must be exactly {SERVICE_DATABASE_NAME}")
        if not arguments.disk_path.is_dir():
            raise SettingsError("The PostgreSQL disk path is unavailable")
        disk = shutil.disk_usage(arguments.disk_path)
        minimum_bytes = int(arguments.minimum_free_gib * (1024**3))
        engine = create_service_engine(
            settings,
            pool_size=1,
            max_overflow=0,
            pool_timeout=settings.db_pool_timeout_seconds,
            connect_args={"connect_timeout": settings.db_connect_timeout_seconds},
        )
        try:
            with engine.connect() as connection:
                identity = verify_server_identity(connection, settings)
                health = load_readiness_facts(connection)
                schema_revision = health["schema_revision"]
                row = health["active_release"]
                active_release = (
                    {
                        "release_key": row["release_key"],
                        "bundle_digest_prefix": row["source_bundle_sha256"][:12],
                        "status": row["status"],
                        "reconciliation_status": row["reconciliation_status"],
                    }
                    if row is not None
                    else None
                )
        finally:
            engine.dispose()
    except (SettingsError, SQLAlchemyError, OSError) as error:
        print(
            json.dumps(
                {"preflight": "failed", "reason": type(error).__name__},
                ensure_ascii=False,
                sort_keys=True,
            )
        )
        return 2

    report = {
        "preflight": "passed" if disk.free >= minimum_bytes else "insufficient_disk",
        "target_host": identity["database_host"],
        "expected_database": SERVICE_DATABASE_NAME,
        "actual_database": identity["database_name"],
        "postgres_major": identity["server_major"],
        "forbidden_database_guard": "passed",
        "disk_path": str(arguments.disk_path),
        "disk_free_bytes": disk.free,
        "minimum_free_bytes": minimum_bytes,
        "schema_revision": schema_revision,
        "active_release": active_release,
    }
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    return 0 if report["preflight"] == "passed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
