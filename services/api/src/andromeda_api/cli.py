"""Explicit operator commands for service database checks and migrations."""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from collections.abc import Sequence
from pathlib import Path
from uuid import UUID

from andromeda_db.connection import (
    create_service_engine,
    verify_server_identity,
)
from andromeda_db.migration_runner import upgrade_to_head
from andromeda_db.repositories.migration_audit import record_migration_operation
from andromeda_db.revisions import current_schema_revision
from sqlalchemy.exc import SQLAlchemyError

from andromeda_api import __version__
from andromeda_api.application.importer.bundle import (
    BundleInputError,
    render_validation_report,
)
from andromeda_api.application.importer.cli import (
    add_bundle_commands,
    execute_bundle_import,
    execute_bundle_validation,
)
from andromeda_api.application.importer.mapping import BundleMappingError
from andromeda_api.application.importer.persistence import BundleImportError
from andromeda_api.application.observability.logging import configure_logging
from andromeda_api.application.operations.releases import (
    adopt_legacy_release_bundle,
    export_release_bundle,
    release_status,
    rollback_active_release,
)
from andromeda_api.application.settings import SettingsError, load_settings

logger = logging.getLogger("academic_data_service")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="academic-data")
    groups = parser.add_subparsers(dest="command_group", required=True)
    database = groups.add_parser("db", help="check or migrate the service database")
    actions = database.add_subparsers(dest="database_action", required=True)
    actions.add_parser("check", help="verify target database, PostgreSQL version and schema head")
    actions.add_parser("upgrade", help="apply this service's Alembic revisions to head")
    add_bundle_commands(groups)
    release = groups.add_parser("release", help="inspect and export immutable data releases")
    release_actions = release.add_subparsers(dest="release_action", required=True)
    release_actions.add_parser("show", help="show the active release identity and artifact status")
    export = release_actions.add_parser("export", help="export a verified release importer bundle")
    release_selector = export.add_mutually_exclusive_group(required=True)
    release_selector.add_argument("--active", action="store_true")
    release_selector.add_argument("--release-id", type=UUID)
    export.add_argument("--output", required=True, type=Path)
    adopt = release_actions.add_parser(
        "adopt-bundle", help="attach a legacy bundle after exact digest verification"
    )
    adopt.add_argument("--release-id", required=True, type=UUID)
    adopt.add_argument("--input", required=True, type=Path)
    rollback = release_actions.add_parser(
        "rollback", help="switch active pointer to a verified committed release"
    )
    rollback.add_argument("--to", required=True, type=UUID, dest="target_release_id")
    rollback.add_argument("--expected-active-release-id", required=True, type=UUID)
    rollback.add_argument("--reason", required=True)
    return parser


def run_database_check() -> dict[str, str | int | float | None]:
    settings = load_settings()
    started_at = time.perf_counter()
    engine = create_service_engine(settings)
    try:
        with engine.connect() as connection:
            identity = verify_server_identity(connection, settings)
        revision = current_schema_revision(engine)
        elapsed_ms = round((time.perf_counter() - started_at) * 1000, 2)
        result: dict[str, str | int | float | None] = {
            "service": "andromeda-academic-data",
            "service_version": __version__,
            "database_name": str(identity["database_name"]),
            "database_host": str(identity["database_host"]),
            "postgres_major": int(identity["server_major"]),
            "schema_revision": revision,
            "elapsed_ms": elapsed_ms,
        }
        logger.info(
            "database check completed",
            extra={
                "event": "database.check.completed",
                "database_host": identity["database_host"],
                "database_name": identity["database_name"],
                "migration_revision": revision,
                "elapsed_ms": elapsed_ms,
                "outcome": "connected",
            },
        )
        return result
    finally:
        engine.dispose()


def run_database_upgrade() -> dict[str, str | int | float | None]:
    settings = load_settings()
    engine = create_service_engine(settings)
    started_at = time.perf_counter()
    try:
        with engine.connect() as connection:
            identity = verify_server_identity(connection, settings)
        logger.info(
            "database migration started",
            extra={
                "event": "database.migration.started",
                "database_host": identity["database_host"],
                "database_name": identity["database_name"],
                "outcome": "started",
            },
        )
        try:
            upgrade_to_head()
            revision = current_schema_revision(engine)
            if revision is None:
                raise RuntimeError("Alembic completed but the service revision table is empty")
            record_migration_operation(engine, revision=revision, operation="upgrade")
            elapsed_ms = round((time.perf_counter() - started_at) * 1000, 2)
            logger.info(
                "database migration completed",
                extra={
                    "event": "database.migration.completed",
                    "database_host": identity["database_host"],
                    "database_name": identity["database_name"],
                    "migration_revision": revision,
                    "elapsed_ms": elapsed_ms,
                    "outcome": "succeeded",
                },
            )
            return {
                "service": "andromeda-academic-data",
                "database_name": str(identity["database_name"]),
                "schema_revision": revision,
                "elapsed_ms": elapsed_ms,
            }
        except Exception as error:
            try:
                failure_revision = current_schema_revision(engine)
            except SQLAlchemyError:
                failure_revision = None
            logger.error(
                "database migration failed",
                extra={
                    "event": "database.migration.failed",
                    "database_host": identity["database_host"],
                    "database_name": identity["database_name"],
                    "migration_revision": failure_revision,
                    "exception_type": type(error).__name__,
                    "outcome": "failed",
                },
            )
            raise
    finally:
        engine.dispose()


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    arguments = parser.parse_args(argv)
    try:
        if arguments.command_group == "bundle" and arguments.bundle_action == "validate":
            configure_logging(os.getenv("LOG_LEVEL"))
            report, report_path = execute_bundle_validation(arguments.input, arguments.output)
            if report_path is None:
                sys.stdout.buffer.write(render_validation_report(report))
            else:
                print(
                    json.dumps(
                        {
                            "valid": report["valid"],
                            "input_digest": report["input"]["digest"],
                            "error_count": len(report["errors"]),
                            "warning_count": len(report["warnings"]),
                            "report_path": str(report_path),
                        },
                        ensure_ascii=False,
                        sort_keys=True,
                    )
                )
            return 0 if report["valid"] else 2
        if arguments.command_group == "bundle" and arguments.bundle_action == "import":
            configure_logging(os.getenv("LOG_LEVEL"))
            result = execute_bundle_import(
                arguments.input,
                commit=arguments.commit,
                output_path=arguments.output,
            )
            if arguments.output:
                mapping = result.get("mapping", {})
                print(
                    json.dumps(
                        {
                            "outcome": result["outcome"],
                            "input_digest": result["input_digest"],
                            "release_key": result["release_key"],
                            "database_connection_opened": result.get(
                                "database_connection_opened", True
                            ),
                            "row_counts": mapping.get("typed_row_counts", {}),
                            "report_path": result.get("report_path"),
                        },
                        ensure_ascii=False,
                        sort_keys=True,
                    )
                )
            else:
                print(json.dumps(result, ensure_ascii=False, sort_keys=True))
            return 0

        if arguments.command_group == "release":
            settings = load_settings()
            configure_logging(settings.log_level)
            engine = create_service_engine(settings)
            try:
                if arguments.release_action == "show":
                    result = release_status(engine, settings)
                elif arguments.release_action == "export":
                    result = export_release_bundle(
                        engine,
                        settings,
                        output_path=arguments.output,
                        release_id=arguments.release_id,
                    )
                elif arguments.release_action == "adopt-bundle":
                    result = adopt_legacy_release_bundle(
                        engine,
                        settings,
                        release_id=arguments.release_id,
                        input_path=arguments.input,
                    )
                elif arguments.release_action == "rollback":
                    result = rollback_active_release(
                        engine,
                        settings,
                        target_release_id=arguments.target_release_id,
                        expected_active_release_id=arguments.expected_active_release_id,
                        reason=arguments.reason,
                    )
                else:
                    parser.error("unsupported release command")
                    return 2
            finally:
                engine.dispose()
            print(json.dumps(result, ensure_ascii=False, sort_keys=True))
            return 0

        settings = load_settings()
        configure_logging(settings.log_level)
        if arguments.command_group == "db" and arguments.database_action == "check":
            result = run_database_check()
        elif arguments.command_group == "db" and arguments.database_action == "upgrade":
            result = run_database_upgrade()
        else:
            parser.error("unsupported command")
            return 2
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 0
    except SettingsError as error:
        configure_logging().error(
            "database configuration rejected",
            extra={"event": "database.configuration.rejected", "outcome": str(error)},
        )
        return 2
    except BundleInputError as error:
        configure_logging(os.getenv("LOG_LEVEL")).error(
            "bundle input rejected",
            extra={
                "event": "bundle.validation.input_rejected",
                "phase": "input",
                "outcome": str(error),
            },
        )
        return 2
    except BundleMappingError as error:
        configure_logging(os.getenv("LOG_LEVEL")).error(
            "bundle mapping rejected",
            extra={
                "event": "bundle.import.mapping_rejected",
                "phase": "mapping",
                "outcome": str(error),
            },
        )
        return 2
    except BundleImportError as error:
        configure_logging(os.getenv("LOG_LEVEL")).error(
            "bundle import failed",
            extra={
                "event": "bundle.import.failed",
                "phase": "import",
                "outcome": str(error),
            },
        )
        return 1
    except (SQLAlchemyError, RuntimeError) as error:
        configure_logging().error(
            "database command failed",
            extra={
                "event": "database.command.failed",
                "exception_type": type(error).__name__,
                "outcome": "failed",
            },
        )
        return 1
    except Exception as error:  # noqa: BLE001 - convert unexpected CLI failures into a logged exit code
        configure_logging().error(
            "database command failed",
            extra={
                "event": "database.command.failed",
                "exception_type": type(error).__name__,
                "outcome": "failed",
            },
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
