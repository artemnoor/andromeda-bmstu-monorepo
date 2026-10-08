"""Run the database package's preserved Alembic chain to its single head."""

from __future__ import annotations

from alembic import command

from andromeda_db.migration_config import build_alembic_config


def upgrade_to_head() -> None:
    """Apply all unapplied database revisions without changing their history."""
    command.upgrade(build_alembic_config(), "head")
