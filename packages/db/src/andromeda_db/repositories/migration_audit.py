"""Audit writes for service schema migration commands."""

from sqlalchemy import Engine, insert

from andromeda_db.models.models import MigrationAuditModel


def record_migration_operation(engine: Engine, *, revision: str, operation: str) -> None:
    """Record a completed schema migration operation."""

    with engine.begin() as connection:
        connection.execute(
            insert(MigrationAuditModel).values(
                migration_revision=revision,
                operation=operation,
            )
        )
