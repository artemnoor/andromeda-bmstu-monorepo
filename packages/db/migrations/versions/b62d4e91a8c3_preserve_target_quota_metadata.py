"""Preserve targeted quota organization and campus metadata.

Revision ID: b62d4e91a8c3
Revises: 7c2a16df09b4
Create Date: 2026-10-09
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b62d4e91a8c3"
down_revision: str | None = "7c2a16df09b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("competition_pools", sa.Column("target_organization", sa.Text()))
    op.add_column(
        "competition_pools", sa.Column("target_organization_inn", sa.String(length=32))
    )
    op.add_column(
        "competition_pools", sa.Column("target_organization_kpp", sa.String(length=32))
    )
    op.add_column(
        "competition_pools", sa.Column("target_organization_ogrn", sa.String(length=32))
    )
    op.add_column("competition_pools", sa.Column("target_region", sa.Text()))
    op.add_column("competition_pools", sa.Column("campus_label_in_document", sa.Text()))


def downgrade() -> None:
    op.drop_column("competition_pools", "campus_label_in_document")
    op.drop_column("competition_pools", "target_region")
    op.drop_column("competition_pools", "target_organization_ogrn")
    op.drop_column("competition_pools", "target_organization_kpp")
    op.drop_column("competition_pools", "target_organization_inn")
    op.drop_column("competition_pools", "target_organization")
