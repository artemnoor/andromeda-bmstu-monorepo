"""Alembic configuration and migration-file discovery for source and wheel installs."""

from __future__ import annotations

import logging
import sys
from pathlib import Path

from alembic.config import Config

logger = logging.getLogger("andromeda_db.migrations")


def resolve_migrations_path(source_migrations: Path, installed_migrations: Path) -> Path:
    """Choose source-tree migrations first and packaged data files as fallback."""
    for candidate in (source_migrations, installed_migrations):
        if candidate.is_dir():
            return candidate
    raise RuntimeError("The Andromeda database Alembic migrations are missing")


def build_alembic_config() -> Config:
    """Build Alembic config from a checkout or the non-editable wheel data files."""
    source_migrations = Path(__file__).resolve().parents[2] / "migrations"
    installed_migrations = Path(sys.prefix) / "share" / "andromeda-db" / "migrations"
    migrations_path = resolve_migrations_path(source_migrations, installed_migrations)
    logger.debug(
        "Alembic migration directory resolved",
        extra={
            "event": "database.migration.discovery.completed",
            "migration_path": str(migrations_path),
            "source_checkout": migrations_path == source_migrations,
        },
    )
    config = Config()
    config.set_main_option("script_location", str(migrations_path))
    config.set_main_option("version_path_separator", "os")
    return config
