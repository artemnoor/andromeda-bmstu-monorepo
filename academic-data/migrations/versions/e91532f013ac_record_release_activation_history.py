"""Record append-only publish and rollback events.

Revision ID: e91532f013ac
Revises: bb3f647a29c1
Create Date: 2026-10-07
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e91532f013ac"
down_revision: str | None = "bb3f647a29c1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "release_activation_events",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("operation", sa.String(length=16), nullable=False),
        sa.Column(
            "previous_release_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("data_releases.id", ondelete="RESTRICT"),
        ),
        sa.Column(
            "active_release_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("data_releases.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "expected_active_release_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("data_releases.id", ondelete="RESTRICT"),
        ),
        sa.Column("source_bundle_sha256", sa.String(length=64), nullable=False),
        sa.Column("actor", sa.String(length=256), nullable=False),
        sa.Column("reason", sa.Text()),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "operation IN ('publish', 'rollback')",
            name=op.f("ck_release_activation_events_valid_operation"),
        ),
        sa.CheckConstraint(
            "length(trim(actor)) > 0",
            name=op.f("ck_release_activation_events_actor_present"),
        ),
        sa.CheckConstraint(
            "source_bundle_sha256 ~ '^[0-9a-f]{64}$'",
            name=op.f("ck_release_activation_events_valid_source_bundle_sha256"),
        ),
        sa.CheckConstraint(
            "operation <> 'rollback' OR length(trim(reason)) > 0",
            name=op.f("ck_release_activation_events_rollback_reason_present"),
        ),
    )
    op.create_index(
        "ix_release_activation_events_active_at",
        "release_activation_events",
        ["active_release_id", "occurred_at"],
    )
    op.execute(
        """
        CREATE FUNCTION academic_data_reject_activation_event_mutation()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            RAISE EXCEPTION 'Release activation events are append-only'
                USING ERRCODE = '23514',
                      CONSTRAINT = 'ck_release_activation_events_immutable';
        END
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_release_activation_events_append_only
        BEFORE UPDATE OR DELETE ON release_activation_events
        FOR EACH ROW EXECUTE FUNCTION academic_data_reject_activation_event_mutation()
        """
    )


def downgrade() -> None:
    connection = op.get_bind()
    count = connection.execute(
        sa.text("SELECT count(*) FROM release_activation_events")
    ).scalar_one()
    if count:
        raise RuntimeError("Refusing to delete release activation history")
    op.execute("DROP TRIGGER trg_release_activation_events_append_only ON release_activation_events")
    op.execute("DROP FUNCTION academic_data_reject_activation_event_mutation()")
    op.drop_index(
        "ix_release_activation_events_active_at",
        table_name="release_activation_events",
    )
    op.drop_table("release_activation_events")
