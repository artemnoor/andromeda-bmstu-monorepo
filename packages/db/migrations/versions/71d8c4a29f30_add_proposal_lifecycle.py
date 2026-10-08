"""Add PostgreSQL-backed proposal lifecycle and publication idempotency.

Revision ID: 71d8c4a29f30
Revises: f4b19a7c2d61
Create Date: 2026-10-08
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "71d8c4a29f30"
down_revision: str | None = "f4b19a7c2d61"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("import_batches", sa.Column("publication_idempotency_key", sa.String(256)))
    op.add_column("import_batches", sa.Column("publication_request_hash", sa.String(64)))
    op.create_check_constraint(
        "ck_import_batches_valid_publication_idempotency",
        "import_batches",
        "(publication_idempotency_key IS NULL AND publication_request_hash IS NULL) OR "
        "(publication_idempotency_key IS NOT NULL AND publication_request_hash ~ "
        "'^[0-9a-f]{64}$')",
    )
    op.create_index(
        "uq_import_batches_publication_idempotency_key",
        "import_batches",
        ["publication_idempotency_key"],
        unique=True,
    )

    op.create_table(
        "proposals",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("version", sa.BigInteger(), nullable=False),
        sa.Column("current_revision", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("author", sa.String(256), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("published_release_id", sa.Uuid(as_uuid=True)),
        sa.Column("review_event_id", sa.String(64)),
        sa.CheckConstraint("version > 0", name="ck_proposals_positive_version"),
        sa.CheckConstraint("current_revision > 0", name="ck_proposals_positive_current_revision"),
        sa.CheckConstraint(
            "status IN ('DRAFT', 'VALIDATED', 'NEEDS_REVIEW', 'APPROVED', "
            "'REJECTED', 'CONFLICTING', 'PUBLISHED')",
            name="ck_proposals_valid_status",
        ),
        sa.CheckConstraint(
            "(status = 'PUBLISHED' AND published_release_id IS NOT NULL) OR "
            "(status <> 'PUBLISHED' AND published_release_id IS NULL)",
            name="ck_proposals_published_release_link_consistent",
        ),
        sa.CheckConstraint("length(trim(author)) > 0", name="ck_proposals_author_present"),
        sa.CheckConstraint(
            "review_event_id IS NULL OR review_event_id ~ '^[0-9a-f]{64}$'",
            name="ck_proposals_valid_review_event_id",
        ),
        sa.CheckConstraint(
            "(status IN ('APPROVED', 'PUBLISHED') AND review_event_id IS NOT NULL) OR "
            "(status NOT IN ('APPROVED', 'PUBLISHED') AND review_event_id IS NULL)",
            name="ck_proposals_approved_review_event_link_consistent",
        ),
        sa.ForeignKeyConstraint(
            ["published_release_id"],
            ["data_releases.id"],
            ondelete="RESTRICT",
            name="fk_proposals_published_release_id_data_releases",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_proposals"),
    )
    op.create_index("ix_proposals_status_updated_at", "proposals", ["status", "updated_at"])

    op.create_table(
        "proposal_revisions",
        sa.Column("proposal_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("revision", sa.BigInteger(), nullable=False),
        sa.Column("change_type", sa.String(80), nullable=False),
        sa.Column("target_dataset", sa.String(128), nullable=False),
        sa.Column("target_key", sa.String(512), nullable=False),
        sa.Column("source_candidate_key", sa.String(512)),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("payload_sha256", sa.String(64), nullable=False),
        sa.Column("expected_release_id", sa.Uuid(as_uuid=True)),
        sa.Column("expected_release_sha256", sa.String(64)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("revision > 0", name="ck_proposal_revisions_positive_revision"),
        sa.CheckConstraint(
            "length(trim(change_type)) > 0", name="ck_proposal_revisions_change_type_present"
        ),
        sa.CheckConstraint(
            "length(trim(target_dataset)) > 0",
            name="ck_proposal_revisions_target_dataset_present",
        ),
        sa.CheckConstraint(
            "length(trim(target_key)) > 0", name="ck_proposal_revisions_target_key_present"
        ),
        sa.CheckConstraint(
            "payload_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_proposal_revisions_valid_payload_sha256",
        ),
        sa.CheckConstraint(
            "expected_release_sha256 IS NULL OR "
            "expected_release_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_proposal_revisions_valid_expected_release_sha256",
        ),
        sa.ForeignKeyConstraint(
            ["proposal_id"], ["proposals.id"], ondelete="RESTRICT", name="fk_proposal_revisions_proposal"
        ),
        sa.ForeignKeyConstraint(
            ["expected_release_id"],
            ["data_releases.id"],
            ondelete="RESTRICT",
            name="fk_proposal_revisions_expected_release",
        ),
        sa.PrimaryKeyConstraint("proposal_id", "revision", name="pk_proposal_revisions"),
    )
    op.create_foreign_key(
        "fk_proposals_current_revision",
        "proposals",
        "proposal_revisions",
        ["id", "current_revision"],
        ["proposal_id", "revision"],
        deferrable=True,
        initially="DEFERRED",
    )

    op.create_table(
        "proposal_evidence_refs",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("proposal_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("revision", sa.BigInteger(), nullable=False),
        sa.Column("source_document_sha256", sa.String(64), nullable=False),
        sa.Column("source_artifact_key", sa.String(512), nullable=False),
        sa.Column("locator", sa.String(1024), nullable=False),
        sa.Column("source_url", sa.Text()),
        sa.Column("captured_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "source_document_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_proposal_evidence_refs_valid_source_document_sha256",
        ),
        sa.CheckConstraint(
            "length(trim(source_artifact_key)) > 0",
            name="ck_proposal_evidence_refs_artifact_key_present",
        ),
        sa.CheckConstraint(
            "length(trim(locator)) > 0", name="ck_proposal_evidence_refs_locator_present"
        ),
        sa.ForeignKeyConstraint(
            ["proposal_id", "revision"],
            ["proposal_revisions.proposal_id", "proposal_revisions.revision"],
            ondelete="RESTRICT",
            name="fk_proposal_evidence_refs_revision",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_proposal_evidence_refs"),
    )
    op.create_index(
        "ix_proposal_evidence_refs_artifact_key",
        "proposal_evidence_refs",
        ["source_artifact_key"],
    )

    op.create_table(
        "proposal_events",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("proposal_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("aggregate_version", sa.BigInteger(), nullable=False),
        sa.Column("current_revision", sa.BigInteger(), nullable=False),
        sa.Column("previous_status", sa.String(24)),
        sa.Column("next_status", sa.String(24), nullable=False),
        sa.Column("event_type", sa.String(24), nullable=False),
        sa.Column("actor", sa.String(256), nullable=False),
        sa.Column("reason", sa.Text()),
        sa.Column("review_event_id", sa.String(64)),
        sa.Column("idempotency_key", sa.String(256), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("resulting_release_id", sa.Uuid(as_uuid=True)),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "aggregate_version > 0", name="ck_proposal_events_positive_aggregate_version"
        ),
        sa.CheckConstraint(
            "current_revision > 0", name="ck_proposal_events_positive_current_revision"
        ),
        sa.CheckConstraint(
            "previous_status IS NULL OR previous_status IN "
            "('DRAFT', 'VALIDATED', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'CONFLICTING', 'PUBLISHED')",
            name="ck_proposal_events_valid_previous_status",
        ),
        sa.CheckConstraint(
            "next_status IN ('DRAFT', 'VALIDATED', 'NEEDS_REVIEW', 'APPROVED', "
            "'REJECTED', 'CONFLICTING', 'PUBLISHED')",
            name="ck_proposal_events_valid_next_status",
        ),
        sa.CheckConstraint(
            "event_type IN ('CREATED', 'VALIDATED', 'NEEDS_REVIEW', 'APPROVED', "
            "'REJECTED', 'CONFLICTING', 'REBASED', 'PUBLISHED')",
            name="ck_proposal_events_valid_event_type",
        ),
        sa.CheckConstraint("length(trim(actor)) > 0", name="ck_proposal_events_actor_present"),
        sa.CheckConstraint(
            "length(trim(idempotency_key)) > 0",
            name="ck_proposal_events_idempotency_key_present",
        ),
        sa.CheckConstraint(
            "request_hash ~ '^[0-9a-f]{64}$'", name="ck_proposal_events_valid_request_hash"
        ),
        sa.CheckConstraint(
            "review_event_id IS NULL OR review_event_id ~ '^[0-9a-f]{64}$'",
            name="ck_proposal_events_valid_review_event_id",
        ),
        sa.CheckConstraint(
            "event_type NOT IN ('APPROVED', 'PUBLISHED') OR review_event_id IS NOT NULL",
            name="ck_proposal_events_decision_review_event_present",
        ),
        sa.CheckConstraint(
            "event_type <> 'REJECTED' OR length(trim(reason)) > 0",
            name="ck_proposal_events_rejection_reason_present",
        ),
        sa.CheckConstraint(
            "(next_status = 'PUBLISHED' AND resulting_release_id IS NOT NULL) OR "
            "(next_status <> 'PUBLISHED' AND resulting_release_id IS NULL)",
            name="ck_proposal_events_published_release_link_consistent",
        ),
        sa.ForeignKeyConstraint(
            ["proposal_id"], ["proposals.id"], ondelete="RESTRICT", name="fk_proposal_events_proposal"
        ),
        sa.ForeignKeyConstraint(
            ["proposal_id", "current_revision"],
            ["proposal_revisions.proposal_id", "proposal_revisions.revision"],
            name="fk_proposal_events_revision",
        ),
        sa.ForeignKeyConstraint(
            ["resulting_release_id"],
            ["data_releases.id"],
            ondelete="RESTRICT",
            name="fk_proposal_events_resulting_release",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_proposal_events"),
        sa.UniqueConstraint(
            "proposal_id", "aggregate_version", name="uq_proposal_events_proposal_version"
        ),
        sa.UniqueConstraint(
            "proposal_id", "idempotency_key", name="uq_proposal_events_proposal_idempotency"
        ),
    )
    op.create_index(
        "ix_proposal_events_proposal_occurred",
        "proposal_events",
        ["proposal_id", "occurred_at"],
    )

    op.execute(
        """
        CREATE FUNCTION academic_data_reject_proposal_history_mutation()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            RAISE EXCEPTION 'Proposal revisions, evidence, and events are append-only'
                USING ERRCODE = '23514', CONSTRAINT = 'ck_proposal_history_immutable';
        END
        $$
        """
    )
    for table_name in ("proposal_revisions", "proposal_evidence_refs", "proposal_events"):
        op.execute(
            f"CREATE TRIGGER trg_{table_name}_append_only "
            f"BEFORE UPDATE OR DELETE ON {table_name} "
            "FOR EACH ROW EXECUTE FUNCTION academic_data_reject_proposal_history_mutation()"
        )

    # Public API may write only proposal workflow records through its injected internal use cases.
    # Directus and the API's read-only role retain no proposal-table privileges.
    op.execute("GRANT USAGE ON SCHEMA public TO andromeda_api_runtime")
    op.execute(
        "REVOKE ALL ON TABLE proposals, proposal_revisions, proposal_evidence_refs, proposal_events "
        "FROM PUBLIC, andromeda_api_readonly, andromeda_api_runtime, andromeda_directus_readonly, "
        "andromeda_directus_runtime"
    )
    op.execute("GRANT SELECT, INSERT, UPDATE ON TABLE proposals TO andromeda_api_runtime")
    op.execute(
        "GRANT SELECT, INSERT ON TABLE proposal_revisions, proposal_evidence_refs, proposal_events "
        "TO andromeda_api_runtime"
    )


def downgrade() -> None:
    bind = op.get_bind()
    proposal_count = bind.execute(sa.text("SELECT count(*) FROM proposals")).scalar_one()
    event_count = bind.execute(sa.text("SELECT count(*) FROM proposal_events")).scalar_one()
    if proposal_count or event_count:
        raise RuntimeError("Refusing to delete proposal revisions or audit history; migrate forward")

    op.execute(
        "REVOKE ALL ON TABLE proposals, proposal_revisions, proposal_evidence_refs, proposal_events "
        "FROM andromeda_api_runtime, andromeda_api_readonly, andromeda_directus_readonly, "
        "andromeda_directus_runtime"
    )
    for table_name in ("proposal_events", "proposal_evidence_refs", "proposal_revisions"):
        op.execute(f"DROP TRIGGER trg_{table_name}_append_only ON {table_name}")
    op.execute("DROP FUNCTION academic_data_reject_proposal_history_mutation()")
    op.drop_index("ix_proposal_events_proposal_occurred", table_name="proposal_events")
    op.drop_table("proposal_events")
    op.drop_index("ix_proposal_evidence_refs_artifact_key", table_name="proposal_evidence_refs")
    op.drop_table("proposal_evidence_refs")
    op.drop_constraint("fk_proposals_current_revision", "proposals", type_="foreignkey")
    op.drop_table("proposal_revisions")
    op.drop_index("ix_proposals_status_updated_at", table_name="proposals")
    op.drop_table("proposals")
    op.drop_index(
        "uq_import_batches_publication_idempotency_key", table_name="import_batches"
    )
    op.drop_constraint(
        "ck_import_batches_valid_publication_idempotency", "import_batches", type_="check"
    )
    op.drop_column("import_batches", "publication_request_hash")
    op.drop_column("import_batches", "publication_idempotency_key")
