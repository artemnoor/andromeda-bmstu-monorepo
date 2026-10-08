"""Database engine creation and PostgreSQL 16 identity checks."""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import Connection

from andromeda_db.settings import DatabaseSettings, SettingsError

logger = logging.getLogger("andromeda_db.connection")


def create_service_engine(settings: DatabaseSettings, **engine_options: Any) -> Engine:
    """Create a service-only engine without logging or exposing its DSN."""
    logger.debug(
        "database engine creation started",
        extra={
            "event": "database.engine.create.started",
            "database_host": settings.database_host,
            "database_name": settings.database_name,
        },
    )
    options: dict[str, Any] = {"pool_pre_ping": True}
    options.update(engine_options)
    engine = create_engine(settings.database_url, **options)
    logger.debug(
        "database engine creation completed",
        extra={
            "event": "database.engine.create.completed",
            "database_host": settings.database_host,
            "database_name": settings.database_name,
        },
    )
    return engine


def verify_server_identity(
    connection: Connection, settings: DatabaseSettings
) -> dict[str, str | int]:
    """Verify the connected database and PG major version before migrations/writes."""
    logger.debug(
        "database server identity check started",
        extra={
            "event": "database.identity_check.started",
            "database_name": settings.database_name,
            "database_host": settings.database_host,
        },
    )
    if connection.dialect.name != "postgresql":
        if settings.environment == "test" and connection.dialect.name == "sqlite":
            logger.debug(
                "database server identity check completed",
                extra={
                    "event": "database.identity_check.completed",
                    "database_name": settings.database_name,
                    "database_host": settings.database_host,
                    "postgres_major": 0,
                    "outcome": "test_sqlite",
                },
            )
            return {
                "database_name": settings.database_name,
                "database_host": settings.database_host or "<local>",
                "server_major": 0,
            }
        raise SettingsError("The academic data database must be PostgreSQL")

    actual_database, version_number = connection.execute(
        text("SELECT current_database(), current_setting('server_version_num')::integer")
    ).one()
    if actual_database != settings.database_name:
        raise SettingsError("Connected database name does not match ACADEMIC_DATA_DATABASE_URL")
    server_major = int(str(version_number)) // 10000
    if server_major != 16:
        raise SettingsError("The academic data service requires PostgreSQL 16")
    logger.debug(
        "database server identity check completed",
        extra={
            "event": "database.identity_check.completed",
            "database_name": settings.database_name,
            "database_host": settings.database_host,
            "postgres_major": server_major,
            "outcome": "verified",
        },
    )
    return {
        "database_name": str(actual_database),
        "database_host": settings.database_host or "<local>",
        "server_major": server_major,
    }
