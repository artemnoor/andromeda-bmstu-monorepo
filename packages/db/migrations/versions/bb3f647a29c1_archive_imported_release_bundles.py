"""Retain a lossless bundle artifact for every newly published release.

Revision ID: bb3f647a29c1
Revises: de41afbb52c8
Create Date: 2026-10-07
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "bb3f647a29c1"
down_revision: str | None = "de41afbb52c8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "data_release_bundle_artifacts",
        sa.Column(
            "release_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("data_releases.id", ondelete="RESTRICT"),
            primary_key=True,
        ),
        sa.Column("archive_format", sa.String(length=32), nullable=False),
        sa.Column("archive_bytes", sa.LargeBinary(), nullable=False),
        sa.Column("archive_sha256", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "archive_format IN ('source_zip_v1', 'directory_zip_v1')",
            name=op.f("ck_data_release_bundle_artifacts_valid_archive_format"),
        ),
        sa.CheckConstraint(
            "archive_sha256 ~ '^[0-9a-f]{64}$'",
            name=op.f("ck_data_release_bundle_artifacts_valid_archive_sha256"),
        ),
        sa.CheckConstraint(
            "octet_length(archive_bytes) > 0",
            name=op.f("ck_data_release_bundle_artifacts_nonempty_archive"),
        ),
    )
    op.execute(
        """
        CREATE FUNCTION academic_data_reject_release_bundle_mutation()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            RAISE EXCEPTION 'Published release bundle artifacts are append-only'
                USING ERRCODE = '23514',
                      CONSTRAINT = 'ck_data_release_bundle_artifacts_immutable';
        END
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_data_release_bundle_artifacts_append_only
        BEFORE UPDATE OR DELETE ON data_release_bundle_artifacts
        FOR EACH ROW EXECUTE FUNCTION academic_data_reject_release_bundle_mutation()
        """
    )


def downgrade() -> None:
    connection = op.get_bind()
    count = connection.execute(
        sa.text("SELECT count(*) FROM data_release_bundle_artifacts")
    ).scalar_one()
    if count:
        raise RuntimeError("Refusing to drop archived bundles for published releases")
    op.execute("DROP TRIGGER trg_data_release_bundle_artifacts_append_only ON data_release_bundle_artifacts")
    op.execute("DROP FUNCTION academic_data_reject_release_bundle_mutation()")
    op.drop_table("data_release_bundle_artifacts")
