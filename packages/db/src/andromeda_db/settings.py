"""Fail-closed database target configuration and identity policy."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field

from sqlalchemy.engine import URL, make_url

SERVICE_DATABASE_NAME = "academic_data_2026"
FORBIDDEN_DATABASE_NAMES = frozenset(
    {
        "andromeda_dev",
        "andromeda_staging",
        "andromeda_prod",
        "bmstu_archive_2026",
    }
)
ALLOWED_ENVIRONMENTS = frozenset({"development", "test", "staging", "production"})


class SettingsError(ValueError):
    """Raised when database configuration is missing or unsafe."""


@dataclass(frozen=True, slots=True)
class DatabaseSettings:
    """Database-only connection and environment identity settings."""

    database_url: str = field(repr=False)
    environment: str
    database_name: str
    database_host: str | None

    @property
    def parsed_database_url(self) -> URL:
        return make_url(self.database_url)


def load_database_settings(environ: Mapping[str, str] | None = None) -> DatabaseSettings:
    """Read the dedicated academic data DSN without falling back to core DB variables."""
    source = os.environ if environ is None else environ
    raw_url = source.get("ACADEMIC_DATA_DATABASE_URL", "").strip()
    if not raw_url:
        raise SettingsError("ACADEMIC_DATA_DATABASE_URL is required")

    environment = source.get("ACADEMIC_DATA_ENV", "development").strip().lower()
    if environment not in ALLOWED_ENVIRONMENTS:
        raise SettingsError("ACADEMIC_DATA_ENV must be development, test, staging, or production")

    try:
        parsed_url = make_url(raw_url)
    except Exception as error:
        raise SettingsError("ACADEMIC_DATA_DATABASE_URL is not a valid SQLAlchemy URL") from error

    database_name = parsed_url.database or ""
    if not database_name:
        raise SettingsError("ACADEMIC_DATA_DATABASE_URL must name a database")
    validate_database_target(parsed_url, database_name, environment)

    return DatabaseSettings(
        database_url=raw_url,
        environment=environment,
        database_name=database_name,
        database_host=parsed_url.host,
    )


def validate_database_target(url: URL, database_name: str, environment: str) -> None:
    """Reject core/archive targets and enforce local test/development target rules."""
    normalized_name = database_name.casefold()
    if normalized_name in FORBIDDEN_DATABASE_NAMES or normalized_name.startswith("andromeda_"):
        raise SettingsError(
            "The academic data service cannot use an Andromeda core or archive database"
        )

    if environment in {"staging", "production"} and database_name != SERVICE_DATABASE_NAME:
        raise SettingsError(
            f"{environment} must use the dedicated {SERVICE_DATABASE_NAME} database"
        )

    if (
        environment == "test"
        and url.drivername in {"postgresql", "postgresql+psycopg"}
        and (database_name != "academic_data_test" or url.host not in {"localhost", "127.0.0.1"})
    ):
        raise SettingsError(
            "PostgreSQL tests may target only localhost database academic_data_test"
        )

    if (
        environment == "development"
        and url.drivername in {"postgresql", "postgresql+psycopg"}
        and (not database_name.endswith("_dev") or url.host not in {"localhost", "127.0.0.1"})
    ):
        raise SettingsError(
            "Development PostgreSQL must be a localhost database with a _dev suffix"
        )

    if url.drivername.startswith("sqlite"):
        if environment != "test":
            raise SettingsError("SQLite is permitted only for explicit service unit tests")
        return

    if url.drivername not in {"postgresql", "postgresql+psycopg"}:
        raise SettingsError("The service requires PostgreSQL with the psycopg driver")
