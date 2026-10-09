"""Grant the read-only API role access to subject taxonomy definitions.

Revision ID: 7c2a16df09b4
Revises: 71d8c4a29f30
Create Date: 2026-10-09
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "7c2a16df09b4"
down_revision: str | None = "71d8c4a29f30"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("GRANT SELECT ON TABLE public.subject_taxonomies TO andromeda_api_readonly")


def downgrade() -> None:
    op.execute("REVOKE SELECT ON TABLE public.subject_taxonomies FROM andromeda_api_readonly")
