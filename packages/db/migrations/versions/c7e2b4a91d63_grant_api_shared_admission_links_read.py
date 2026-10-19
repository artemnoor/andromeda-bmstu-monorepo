"""Grant the read-only API role access to evidenced shared admission links.

Revision ID: c7e2b4a91d63
Revises: b62d4e91a8c3
Create Date: 2026-10-19
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "c7e2b4a91d63"
down_revision: str | None = "b62d4e91a8c3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("GRANT SELECT ON TABLE public.source_relationships TO andromeda_api_readonly")


def downgrade() -> None:
    op.execute("REVOKE SELECT ON TABLE public.source_relationships FROM andromeda_api_readonly")
