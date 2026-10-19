"""Store admitted counts parsed from current official order lists.

Revision ID: a419d3e81b7c
Revises: c7e2b4a91d63
Create Date: 2026-10-19
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a419d3e81b7c"
down_revision: str | None = "c7e2b4a91d63"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("admission_statistics", sa.Column("admitted_count", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "ck_admission_statistics_nonnegative_admitted_count",
        "admission_statistics",
        "admitted_count IS NULL OR admitted_count >= 0",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_admission_statistics_nonnegative_admitted_count",
        "admission_statistics",
        type_="check",
    )
    op.drop_column("admission_statistics", "admitted_count")
