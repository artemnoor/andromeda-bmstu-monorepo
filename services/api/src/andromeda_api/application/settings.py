"""Runtime settings for the academic data application and its API."""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from dataclasses import dataclass

from andromeda_db.settings import (
    ALLOWED_ENVIRONMENTS,
    FORBIDDEN_DATABASE_NAMES,
    SERVICE_DATABASE_NAME,
    DatabaseSettings,
    SettingsError,
    load_database_settings,
    validate_database_target,
)


@dataclass(frozen=True, slots=True)
class Settings(DatabaseSettings):
    """Database identity plus application-level logging, API, and pool settings."""

    log_level: str = "INFO"
    root_path: str = ""
    db_pool_size: int = 2
    db_max_overflow: int = 1
    db_pool_timeout_seconds: int = 3
    db_connect_timeout_seconds: int = 3
    db_statement_timeout_ms: int = 5000
    request_timeout_seconds: int = 15


def load_settings(environ: Mapping[str, str] | None = None) -> Settings:
    """Load service settings while keeping database safety policy in andromeda-db."""
    source = os.environ if environ is None else environ
    database = load_database_settings(source)

    configured_level = source.get("LOG_LEVEL", "INFO").strip().upper()
    if configured_level not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
        raise SettingsError("LOG_LEVEL must be DEBUG, INFO, WARNING, ERROR, or CRITICAL")

    root_path = source.get("ACADEMIC_DATA_ROOT_PATH", "").strip().rstrip("/")
    if root_path and (
        not root_path.startswith("/")
        or "//" in root_path
        or ".." in root_path.split("/")
        or not re.fullmatch(r"/[A-Za-z0-9._/-]+", root_path)
    ):
        raise SettingsError("ACADEMIC_DATA_ROOT_PATH must be an absolute URL path prefix")

    return Settings(
        database_url=database.database_url,
        environment=database.environment,
        database_name=database.database_name,
        database_host=database.database_host,
        log_level=configured_level,
        root_path=root_path,
        db_pool_size=_bounded_integer(source, "ACADEMIC_DATA_DB_POOL_SIZE", 2, 1, 5),
        db_max_overflow=_bounded_integer(source, "ACADEMIC_DATA_DB_MAX_OVERFLOW", 1, 0, 5),
        db_pool_timeout_seconds=_bounded_integer(
            source, "ACADEMIC_DATA_DB_POOL_TIMEOUT_SECONDS", 3, 1, 15
        ),
        db_connect_timeout_seconds=_bounded_integer(
            source, "ACADEMIC_DATA_DB_CONNECT_TIMEOUT_SECONDS", 3, 1, 10
        ),
        db_statement_timeout_ms=_bounded_integer(
            source, "ACADEMIC_DATA_DB_STATEMENT_TIMEOUT_MS", 5000, 500, 30000
        ),
        request_timeout_seconds=_bounded_integer(
            source, "ACADEMIC_DATA_REQUEST_TIMEOUT_SECONDS", 15, 1, 60
        ),
    )


def _bounded_integer(
    source: Mapping[str, str], key: str, default: int, minimum: int, maximum: int
) -> int:
    raw_value = source.get(key, str(default)).strip()
    try:
        value = int(raw_value)
    except ValueError as error:
        raise SettingsError(f"{key} must be an integer between {minimum} and {maximum}") from error
    if not minimum <= value <= maximum:
        raise SettingsError(f"{key} must be an integer between {minimum} and {maximum}")
    return value


__all__ = [
    "ALLOWED_ENVIRONMENTS",
    "FORBIDDEN_DATABASE_NAMES",
    "SERVICE_DATABASE_NAME",
    "Settings",
    "SettingsError",
    "load_settings",
    "validate_database_target",
]
