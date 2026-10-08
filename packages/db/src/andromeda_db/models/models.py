"""Import and release lifecycle tables owned by this service."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Identity,
    Index,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from andromeda_db.models.base import Base


class ServiceMetadataModel(Base):
    __tablename__ = "service_metadata"

    metadata_key: Mapped[str] = mapped_column(String(128), primary_key=True)
    metadata_value: Mapped[str] = mapped_column(String(512), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class ImportBatchModel(Base):
    __tablename__ = "import_batches"
    __table_args__ = (
        CheckConstraint(
            "status IN ('validated', 'staging', 'committed', 'failed')",
            name="valid_status",
        ),
        CheckConstraint(
            "source_bundle_sha256 ~ '^[0-9a-f]{64}$'",
            name="valid_source_bundle_sha256",
        ),
        CheckConstraint(
            "(publication_idempotency_key IS NULL AND publication_request_hash IS NULL) OR "
            "(publication_idempotency_key IS NOT NULL AND publication_request_hash ~ "
            "'^[0-9a-f]{64}$')",
            name="valid_publication_idempotency",
        ),
        Index("ix_import_batches_status_started_at", "status", "started_at"),
        Index(
            "uq_import_batches_publication_idempotency_key",
            "publication_idempotency_key",
            unique=True,
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    source_bundle_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    mapper_version: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    validation_report: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    row_counts: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    failure_code: Mapped[str | None] = mapped_column(String(80))
    publication_idempotency_key: Mapped[str | None] = mapped_column(String(256))
    publication_request_hash: Mapped[str | None] = mapped_column(String(64))


class ProposalModel(Base):
    """Mutable proposal aggregate head; all content snapshots live in revisions."""

    __tablename__ = "proposals"
    __table_args__ = (
        CheckConstraint("version > 0", name="positive_version"),
        CheckConstraint("current_revision > 0", name="positive_current_revision"),
        CheckConstraint(
            "status IN ('DRAFT', 'VALIDATED', 'NEEDS_REVIEW', 'APPROVED', "
            "'REJECTED', 'CONFLICTING', 'PUBLISHED')",
            name="valid_status",
        ),
        CheckConstraint(
            "(status = 'PUBLISHED' AND published_release_id IS NOT NULL) OR "
            "(status <> 'PUBLISHED' AND published_release_id IS NULL)",
            name="published_release_link_consistent",
        ),
        CheckConstraint("length(trim(author)) > 0", name="author_present"),
        CheckConstraint(
            "review_event_id IS NULL OR review_event_id ~ '^[0-9a-f]{64}$'",
            name="valid_review_event_id",
        ),
        CheckConstraint(
            "(status IN ('APPROVED', 'PUBLISHED') AND review_event_id IS NOT NULL) OR "
            "(status NOT IN ('APPROVED', 'PUBLISHED') AND review_event_id IS NULL)",
            name="approved_review_event_link_consistent",
        ),
        ForeignKeyConstraint(
            ["id", "current_revision"],
            ["proposal_revisions.proposal_id", "proposal_revisions.revision"],
            name="fk_proposals_current_revision",
            deferrable=True,
            initially="DEFERRED",
        ),
        Index("ix_proposals_status_updated_at", "status", "updated_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    version: Mapped[int] = mapped_column(BigInteger, nullable=False)
    current_revision: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    author: Mapped[str] = mapped_column(String(256), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    published_release_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("data_releases.id", ondelete="RESTRICT")
    )
    review_event_id: Mapped[str | None] = mapped_column(String(64))


class ProposalRevisionModel(Base):
    """Immutable canonical payload and source-base snapshot for one proposal revision."""

    __tablename__ = "proposal_revisions"
    __table_args__ = (
        CheckConstraint("revision > 0", name="positive_revision"),
        CheckConstraint("length(trim(change_type)) > 0", name="change_type_present"),
        CheckConstraint("length(trim(target_dataset)) > 0", name="target_dataset_present"),
        CheckConstraint("length(trim(target_key)) > 0", name="target_key_present"),
        CheckConstraint("payload_sha256 ~ '^[0-9a-f]{64}$'", name="valid_payload_sha256"),
        CheckConstraint(
            "expected_release_sha256 IS NULL OR "
            "expected_release_sha256 ~ '^[0-9a-f]{64}$'",
            name="valid_expected_release_sha256",
        ),
    )

    proposal_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("proposals.id", ondelete="RESTRICT", name="fk_proposal_revisions_proposal"),
        primary_key=True,
    )
    revision: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    change_type: Mapped[str] = mapped_column(String(80), nullable=False)
    target_dataset: Mapped[str] = mapped_column(String(128), nullable=False)
    target_key: Mapped[str] = mapped_column(String(512), nullable=False)
    source_candidate_key: Mapped[str | None] = mapped_column(String(512))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    payload_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    expected_release_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("data_releases.id", ondelete="RESTRICT", name="fk_proposal_revisions_expected_release"),
    )
    expected_release_sha256: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class ProposalEvidenceReferenceModel(Base):
    """Immutable pointer to source evidence retained by the reviewed bundle."""

    __tablename__ = "proposal_evidence_refs"
    __table_args__ = (
        CheckConstraint(
            "source_document_sha256 ~ '^[0-9a-f]{64}$'", name="valid_source_document_sha256"
        ),
        CheckConstraint("length(trim(source_artifact_key)) > 0", name="artifact_key_present"),
        CheckConstraint("length(trim(locator)) > 0", name="locator_present"),
        ForeignKeyConstraint(
            ["proposal_id", "revision"],
            ["proposal_revisions.proposal_id", "proposal_revisions.revision"],
            ondelete="RESTRICT",
            name="fk_proposal_evidence_refs_revision",
        ),
        Index("ix_proposal_evidence_refs_artifact_key", "source_artifact_key"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    proposal_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    revision: Mapped[int] = mapped_column(BigInteger, nullable=False)
    source_document_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    source_artifact_key: Mapped[str] = mapped_column(String(512), nullable=False)
    locator: Mapped[str] = mapped_column(String(1024), nullable=False)
    source_url: Mapped[str | None] = mapped_column(Text)
    captured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ProposalEventModel(Base):
    """Append-only transition, review-decision, and publication audit log."""

    __tablename__ = "proposal_events"
    __table_args__ = (
        CheckConstraint("aggregate_version > 0", name="positive_aggregate_version"),
        CheckConstraint("current_revision > 0", name="positive_current_revision"),
        CheckConstraint(
            "previous_status IS NULL OR previous_status IN "
            "('DRAFT', 'VALIDATED', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'CONFLICTING', 'PUBLISHED')",
            name="valid_previous_status",
        ),
        CheckConstraint(
            "next_status IN ('DRAFT', 'VALIDATED', 'NEEDS_REVIEW', 'APPROVED', "
            "'REJECTED', 'CONFLICTING', 'PUBLISHED')",
            name="valid_next_status",
        ),
        CheckConstraint(
            "event_type IN ('CREATED', 'VALIDATED', 'NEEDS_REVIEW', 'APPROVED', "
            "'REJECTED', 'CONFLICTING', 'REBASED', 'PUBLISHED')",
            name="valid_event_type",
        ),
        CheckConstraint("length(trim(actor)) > 0", name="actor_present"),
        CheckConstraint("length(trim(idempotency_key)) > 0", name="idempotency_key_present"),
        CheckConstraint("request_hash ~ '^[0-9a-f]{64}$'", name="valid_request_hash"),
        CheckConstraint(
            "review_event_id IS NULL OR review_event_id ~ '^[0-9a-f]{64}$'",
            name="valid_review_event_id",
        ),
        CheckConstraint(
            "event_type NOT IN ('APPROVED', 'PUBLISHED') OR review_event_id IS NOT NULL",
            name="decision_review_event_present",
        ),
        CheckConstraint(
            "event_type <> 'REJECTED' OR length(trim(reason)) > 0",
            name="rejection_reason_present",
        ),
        CheckConstraint(
            "(next_status = 'PUBLISHED' AND resulting_release_id IS NOT NULL) OR "
            "(next_status <> 'PUBLISHED' AND resulting_release_id IS NULL)",
            name="published_release_link_consistent",
        ),
        ForeignKeyConstraint(
            ["proposal_id", "current_revision"],
            ["proposal_revisions.proposal_id", "proposal_revisions.revision"],
            name="fk_proposal_events_revision",
        ),
        UniqueConstraint(
            "proposal_id", "aggregate_version", name="uq_proposal_events_proposal_version"
        ),
        UniqueConstraint(
            "proposal_id", "idempotency_key", name="uq_proposal_events_proposal_idempotency"
        ),
        Index("ix_proposal_events_proposal_occurred", "proposal_id", "occurred_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    proposal_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("proposals.id", ondelete="RESTRICT", name="fk_proposal_events_proposal"),
        nullable=False,
    )
    aggregate_version: Mapped[int] = mapped_column(BigInteger, nullable=False)
    current_revision: Mapped[int] = mapped_column(BigInteger, nullable=False)
    previous_status: Mapped[str | None] = mapped_column(String(24))
    next_status: Mapped[str] = mapped_column(String(24), nullable=False)
    event_type: Mapped[str] = mapped_column(String(24), nullable=False)
    actor: Mapped[str] = mapped_column(String(256), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    review_event_id: Mapped[str | None] = mapped_column(String(64))
    idempotency_key: Mapped[str] = mapped_column(String(256), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    resulting_release_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("data_releases.id", ondelete="RESTRICT", name="fk_proposal_events_resulting_release"),
    )
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class DataReleaseModel(Base):
    __tablename__ = "data_releases"
    __table_args__ = (
        CheckConstraint(
            "status IN ('staging', 'committed', 'failed')",
            name="valid_status",
        ),
        CheckConstraint(
            "source_bundle_sha256 ~ '^[0-9a-f]{64}$'",
            name="valid_source_bundle_sha256",
        ),
        CheckConstraint(
            "reconciliation_status IS NULL OR "
            "reconciliation_status IN ('passed', 'passed_with_gaps')",
            name="valid_reconciliation_status",
        ),
        UniqueConstraint(
            "source_bundle_sha256",
            "mapper_version",
            name="uq_data_releases_bundle_mapper",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    release_key: Mapped[str] = mapped_column(String(320), nullable=False, unique=True)
    source_bundle_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    mapper_version: Mapped[str] = mapped_column(String(80), nullable=False)
    batch_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("import_batches.id", ondelete="RESTRICT"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    schema_revision: Mapped[str | None] = mapped_column(String(64))
    reconciliation_status: Mapped[str | None] = mapped_column(String(32))
    reconciliation_summary: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    committed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ActiveDataReleaseModel(Base):
    __tablename__ = "active_data_release"
    __table_args__ = (CheckConstraint("slot_key = 'active'", name="only_active_slot"),)

    slot_key: Mapped[str] = mapped_column(
        String(16), primary_key=True, server_default=text("'active'")
    )
    release_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("data_releases.id", ondelete="RESTRICT"),
        nullable=False,
        unique=True,
    )
    changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class DataReleaseBundleArtifactModel(Base):
    """Immutable importer bundle retained as the lossless release export source."""

    __tablename__ = "data_release_bundle_artifacts"
    __table_args__ = (
        CheckConstraint(
            "archive_format IN ('source_zip_v1', 'directory_zip_v1')",
            name="valid_archive_format",
        ),
        CheckConstraint(
            "archive_sha256 ~ '^[0-9a-f]{64}$'",
            name="valid_archive_sha256",
        ),
        CheckConstraint("octet_length(archive_bytes) > 0", name="nonempty_archive"),
    )

    release_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("data_releases.id", ondelete="RESTRICT"),
        primary_key=True,
    )
    archive_format: Mapped[str] = mapped_column(String(32), nullable=False)
    archive_bytes: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    archive_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class ReleaseActivationEventModel(Base):
    """Append-only publication and rollback history for the active pointer."""

    __tablename__ = "release_activation_events"
    __table_args__ = (
        CheckConstraint("operation IN ('publish', 'rollback')", name="valid_operation"),
        CheckConstraint("length(trim(actor)) > 0", name="actor_present"),
        CheckConstraint(
            "source_bundle_sha256 ~ '^[0-9a-f]{64}$'",
            name="valid_source_bundle_sha256",
        ),
        CheckConstraint(
            "operation <> 'rollback' OR length(trim(reason)) > 0",
            name="rollback_reason_present",
        ),
        Index("ix_release_activation_events_active_at", "active_release_id", "occurred_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    operation: Mapped[str] = mapped_column(String(16), nullable=False)
    previous_release_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("data_releases.id", ondelete="RESTRICT")
    )
    active_release_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("data_releases.id", ondelete="RESTRICT"), nullable=False
    )
    expected_active_release_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("data_releases.id", ondelete="RESTRICT")
    )
    source_bundle_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    actor: Mapped[str] = mapped_column(String(256), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class MigrationAuditModel(Base):
    __tablename__ = "migration_audit"
    __table_args__ = (
        CheckConstraint("operation IN ('upgrade')", name="valid_operation"),
        Index("ix_migration_audit_revision_applied_at", "migration_revision", "applied_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    migration_revision: Mapped[str] = mapped_column(String(64), nullable=False)
    operation: Mapped[str] = mapped_column(String(24), nullable=False)
    applied_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
