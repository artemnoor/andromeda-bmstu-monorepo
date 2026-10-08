"""PostgreSQL proposal persistence and connection-scoped publication participation."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from andromeda_ontology.proposals import (
    InvalidProposalTransitionError,
    Proposal,
    ProposalDomainError,
    ProposalEvent,
    ProposalEventType,
    ProposalEvidenceReference,
    ProposalIdempotencyConflict,
    ProposalNotFoundError,
    ProposalPublicationCommand,
    ProposalRevision,
    ProposalStatus,
    StaleProposalBaseError,
    StaleProposalError,
    proposal_publication_request_sha256,
)
from sqlalchemy import Engine, insert, select, update
from sqlalchemy.engine import Connection
from sqlalchemy.exc import IntegrityError

from andromeda_db.models.models import (
    ActiveDataReleaseModel,
    DataReleaseModel,
    ProposalEventModel,
    ProposalEvidenceReferenceModel,
    ProposalModel,
    ProposalRevisionModel,
)


class ProposalPersistenceConflict(ProposalDomainError):
    """A proposal write hit a durable uniqueness or integrity conflict."""

    code = "proposal_persistence_conflict"


# Reviewed ingestion filenames are not consistently named after one physical table.
# This map mirrors the canonical importer projections without coupling the DB package
# to the API's mapper. Multi-table source datasets are listed in canonical priority order.
_CANONICAL_TARGET_TABLES: dict[str, tuple[str, ...]] = {
    "admission_campaigns.jsonl": ("admission_campaigns",),
    "admission_document_pages.jsonl": ("admission_document_pages",),
    "admission_documents.jsonl": ("admission_documents",),
    "admission_exam_requirements.jsonl": (
        "admission_requirement_sets",
        "admission_requirement_nodes",
    ),
    "admission_exam_source_rows.jsonl": ("source_observations",),
    "admission_information_page_facts.jsonl": ("source_observations",),
    "admission_information_source_tables.jsonl": ("source_observations",),
    "admission_plan_source_rows.jsonl": ("source_observations",),
    "admission_result_sources.jsonl": ("admission_result_sources",),
    "admission_statistics.jsonl": ("admission_statistics",),
    "bmstu_rejected_candidates.jsonl": ("source_observations",),
    "campaign_dates.jsonl": ("campaign_calendar_events",),
    "competition_pools.jsonl": ("competition_pools",),
    "courses.jsonl": ("catalog_courses",),
    "curriculum_items.jsonl": ("curriculum_items",),
    "departments.jsonl": ("departments",),
    "directions.jsonl": ("directions",),
    "educational_programs.jsonl": ("educational_programs",),
    "exams.jsonl": ("admission_exams",),
    "funding_types.jsonl": ("funding_types",),
    "historical_admission_statistics.jsonl": ("historical_admission_statistics",),
    "individual_achievement_policies.jsonl": ("individual_achievement_policies",),
    "program_offerings.jsonl": ("program_offerings",),
    "quota_types.jsonl": ("quota_types",),
    "relationships.jsonl": ("source_relationships",),
    "study_plans.jsonl": ("study_plans",),
    "tuition.jsonl": ("tuition_assertions",),
    "tuition_source_tables.jsonl": ("source_observations",),
    "universities.jsonl": ("universities",),
}


def canonical_target_tables(dataset: str) -> tuple[str, ...]:
    """Resolve a reviewed source dataset to its physical canonical target tables."""

    try:
        return _CANONICAL_TARGET_TABLES[dataset]
    except KeyError as error:
        raise ProposalDomainError(
            f"proposal target dataset {dataset!r} has no canonical release mapping"
        ) from error


class SQLAlchemyProposalRepository:
    """Repository for proposal rows; each public operation owns one short transaction."""

    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def create(
        self,
        proposal: Proposal,
        revision: ProposalRevision,
        evidence: tuple[ProposalEvidenceReference, ...],
        event: ProposalEvent,
    ) -> Proposal:
        try:
            with self.engine.begin() as connection:
                replay = self._replay(
                    connection,
                    proposal.proposal_id,
                    idempotency_key=event.idempotency_key,
                    request_hash=event.request_hash,
                )
                if replay is not None:
                    return replay
                exists = connection.execute(
                    select(ProposalModel.id).where(ProposalModel.id == proposal.proposal_id)
                ).scalar_one_or_none()
                if exists is not None:
                    raise ProposalIdempotencyConflict(
                        "proposal ID already exists without a matching create command"
                    )
                connection.execute(insert(ProposalModel).values(**self._proposal_values(proposal)))
                self._insert_revision(connection, revision)
                self._insert_evidence(connection, proposal.proposal_id, revision.revision, evidence)
                self._insert_event(connection, event)
                return self._load_current(connection, proposal.proposal_id)
        except IntegrityError as error:
            replay = self.replay(
                proposal.proposal_id,
                idempotency_key=event.idempotency_key,
                request_hash=event.request_hash,
            )
            if replay is not None:
                return replay
            raise ProposalPersistenceConflict("proposal creation conflicted with stored data") from error

    def get(self, proposal_id: UUID) -> Proposal | None:
        with self.engine.connect() as connection:
            return self._load_current(connection, proposal_id, missing_ok=True)

    def replay(
        self,
        proposal_id: UUID,
        *,
        idempotency_key: str,
        request_hash: str,
    ) -> Proposal | None:
        with self.engine.connect() as connection:
            return self._replay(
                connection,
                proposal_id,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
            )

    def transition(
        self,
        proposal_id: UUID,
        *,
        expected_version: int,
        expected_status: ProposalStatus,
        next_status: ProposalStatus,
        actor: str,
        reason: str | None,
        event_type: str,
        idempotency_key: str,
        request_hash: str,
        review_event_id: str | None = None,
    ) -> Proposal:
        try:
            with self.engine.begin() as connection:
                replay = self._replay(
                    connection,
                    proposal_id,
                    idempotency_key=idempotency_key,
                    request_hash=request_hash,
                )
                if replay is not None:
                    return replay
                now = datetime.now(UTC)
                updated = connection.execute(
                    update(ProposalModel)
                    .where(
                        ProposalModel.id == proposal_id,
                        ProposalModel.version == expected_version,
                        ProposalModel.status == expected_status.value,
                    )
                    .values(
                        version=expected_version + 1,
                        status=next_status.value,
                        updated_at=now,
                        published_release_id=None,
                        review_event_id=review_event_id if next_status is ProposalStatus.APPROVED else None,
                    )
                    .returning(ProposalModel.id)
                ).scalar_one_or_none()
                if updated is None:
                    replay = self._replay(
                        connection,
                        proposal_id,
                        idempotency_key=idempotency_key,
                        request_hash=request_hash,
                    )
                    if replay is not None:
                        return replay
                    actual = connection.execute(
                        select(ProposalModel.version, ProposalModel.status).where(
                            ProposalModel.id == proposal_id
                        )
                    ).one_or_none()
                    if actual is None:
                        raise ProposalNotFoundError(f"proposal {proposal_id} does not exist")
                    raise StaleProposalError(
                        "proposal changed concurrently "
                        f"(expected version {expected_version}/{expected_status.value}, "
                        f"found {actual.version}/{actual.status})"
                    )
                current = self._load_current(connection, proposal_id)
                event = ProposalEvent(
                    event_id=uuid4(),
                    proposal_id=proposal_id,
                    aggregate_version=expected_version + 1,
                    current_revision=current.current_revision,
                    previous_status=expected_status,
                    next_status=next_status,
                    event_type=ProposalEventType(event_type),
                    actor=actor,
                    reason=reason,
                    review_event_id=review_event_id,
                    idempotency_key=idempotency_key,
                    request_hash=request_hash,
                    resulting_release_id=None,
                    occurred_at=now,
                )
                self._insert_event(connection, event)
                return self._load_current(connection, proposal_id)
        except IntegrityError as error:
            replay = self.replay(
                proposal_id,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
            )
            if replay is not None:
                return replay
            raise ProposalPersistenceConflict("proposal transition conflicted with stored data") from error

    def rebase(
        self,
        proposal: Proposal,
        revision: ProposalRevision,
        evidence: tuple[ProposalEvidenceReference, ...],
        event: ProposalEvent,
        *,
        expected_version: int,
    ) -> Proposal:
        try:
            with self.engine.begin() as connection:
                replay = self._replay(
                    connection,
                    proposal.proposal_id,
                    idempotency_key=event.idempotency_key,
                    request_hash=event.request_hash,
                )
                if replay is not None:
                    return replay
                row_id = connection.execute(
                    update(ProposalModel)
                    .where(
                        ProposalModel.id == proposal.proposal_id,
                        ProposalModel.version == expected_version,
                        ProposalModel.status == ProposalStatus.CONFLICTING.value,
                    )
                    .values(
                        version=expected_version + 1,
                        current_revision=revision.revision,
                        status=ProposalStatus.DRAFT.value,
                        updated_at=event.occurred_at,
                        published_release_id=None,
                    )
                    .returning(ProposalModel.id)
                ).scalar_one_or_none()
                if row_id is None:
                    replay = self._replay(
                        connection,
                        proposal.proposal_id,
                        idempotency_key=event.idempotency_key,
                        request_hash=event.request_hash,
                    )
                    if replay is not None:
                        return replay
                    self._raise_stale(connection, proposal.proposal_id, expected_version)
                self._insert_revision(connection, revision)
                self._insert_evidence(connection, proposal.proposal_id, revision.revision, evidence)
                self._insert_event(connection, event)
                return self._load_current(connection, proposal.proposal_id)
        except IntegrityError as error:
            replay = self.replay(
                proposal.proposal_id,
                idempotency_key=event.idempotency_key,
                request_hash=event.request_hash,
            )
            if replay is not None:
                return replay
            raise ProposalPersistenceConflict("proposal rebase conflicted with stored data") from error

    def events_for(self, proposal_id: UUID) -> tuple[ProposalEvent, ...]:
        with self.engine.connect() as connection:
            rows = connection.execute(
                select(ProposalEventModel.__table__)
                .where(ProposalEventModel.proposal_id == proposal_id)
                .order_by(ProposalEventModel.aggregate_version)
            ).mappings()
            return tuple(self._event_from_row(row) for row in rows)

    def revisions_for(self, proposal_id: UUID) -> tuple[ProposalRevision, ...]:
        with self.engine.connect() as connection:
            rows = connection.execute(
                select(ProposalRevisionModel.__table__)
                .where(ProposalRevisionModel.proposal_id == proposal_id)
                .order_by(ProposalRevisionModel.revision)
            ).mappings()
            return tuple(self._revision_from_row(row) for row in rows)

    def evidence_for(
        self, proposal_id: UUID, *, revision: int | None = None
    ) -> tuple[ProposalEvidenceReference, ...]:
        with self.engine.connect() as connection:
            statement = select(ProposalEvidenceReferenceModel.__table__).where(
                ProposalEvidenceReferenceModel.proposal_id == proposal_id
            )
            if revision is not None:
                statement = statement.where(ProposalEvidenceReferenceModel.revision == revision)
            statement = statement.order_by(ProposalEvidenceReferenceModel.id)
            return tuple(self._evidence_from_row(row) for row in connection.execute(statement).mappings())

    @staticmethod
    def _proposal_values(proposal: Proposal) -> dict[str, Any]:
        return _proposal_values(proposal)

    @staticmethod
    def _insert_revision(connection: Connection, revision: ProposalRevision) -> None:
        _insert_revision(connection, revision)

    @staticmethod
    def _insert_evidence(
        connection: Connection,
        proposal_id: UUID,
        revision: int,
        evidence: Sequence[ProposalEvidenceReference],
    ) -> None:
        _insert_evidence(connection, proposal_id, revision, evidence)

    @staticmethod
    def _insert_event(connection: Connection, event: ProposalEvent) -> None:
        _insert_event(connection, event)

    @staticmethod
    def _event_from_row(row: Any) -> ProposalEvent:
        return _event_from_row(row)

    @staticmethod
    def _revision_from_row(row: Any) -> ProposalRevision:
        return _revision_from_row(row)

    @staticmethod
    def _evidence_from_row(row: Any) -> ProposalEvidenceReference:
        return _evidence_from_row(row)

    def _load_current(
        self, connection: Connection, proposal_id: UUID, *, missing_ok: bool = False
    ) -> Proposal | None:
        return _load_current(self, connection, proposal_id, missing_ok=missing_ok)

    def _replay(
        self,
        connection: Connection,
        proposal_id: UUID,
        *,
        idempotency_key: str,
        request_hash: str,
    ) -> Proposal | None:
        return _replay(
            self,
            connection,
            proposal_id,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
        )

    @staticmethod
    def _raise_stale(connection: Connection, proposal_id: UUID, expected_version: int) -> None:
        _raise_stale(connection, proposal_id, expected_version)


def publish_proposals_in_transaction(
    connection: Connection,
    commands: Sequence[ProposalPublicationCommand],
    *,
    release_id: UUID,
    occurred_at: datetime,
) -> tuple[UUID, ...]:
    """Mark approved proposals published within the caller's locked release transaction.

    This function intentionally does not begin, commit, or roll back a transaction and never
    creates an engine. The canonical publisher calls it before changing the active pointer.
    """

    if not commands:
        return ()
    proposal_ids = [command.proposal_id for command in commands]
    if len(proposal_ids) != len(set(proposal_ids)):
        raise InvalidProposalTransitionError("a publication cannot contain a proposal more than once")

    release = connection.execute(
        select(DataReleaseModel.status).where(DataReleaseModel.id == release_id)
    ).scalar_one_or_none()
    if release != "committed":
        raise ProposalDomainError("proposal publication requires a committed canonical release")

    active = connection.execute(
        select(ActiveDataReleaseModel.release_id)
        .where(ActiveDataReleaseModel.slot_key == "active")
        .with_for_update()
    ).scalar_one_or_none()
    active_hash = None
    if active is not None:
        active_hash = connection.execute(
            select(DataReleaseModel.source_bundle_sha256).where(DataReleaseModel.id == active)
        ).scalar_one_or_none()

    for command in commands:
        expected_request_hash = proposal_publication_request_sha256(
            proposal_id=command.proposal_id,
            expected_version=command.expected_version,
            expected_base_release_id=command.expected_base_release_id,
            expected_base_source_bundle_sha256=command.expected_base_source_bundle_sha256,
            source_candidate_key=command.source_candidate_key,
            review_event_id=command.review_event_id,
            target_dataset=command.target_dataset,
            target_key=command.target_key,
            payload_sha256=command.payload_sha256,
            actor=command.actor,
            idempotency_key=command.idempotency_key,
        )
        if command.request_hash != expected_request_hash:
            raise ProposalIdempotencyConflict(
                "proposal publication request hash does not match its stable command payload"
            )
        prior_event = connection.execute(
            select(ProposalEventModel.__table__).where(
                ProposalEventModel.proposal_id == command.proposal_id,
                ProposalEventModel.idempotency_key == command.idempotency_key,
            )
        ).mappings().one_or_none()
        if prior_event is not None:
            if prior_event["request_hash"] != command.request_hash:
                raise ProposalIdempotencyConflict(
                    "proposal publication key was already used with a different request"
                )
            raise ProposalIdempotencyConflict(
                "proposal publication event already exists without its publication batch replay"
            )
        if (
            command.expected_base_release_id != active
            or command.expected_base_source_bundle_sha256 != active_hash
        ):
            raise StaleProposalBaseError(
                "proposal expected active release does not match the locked publication base"
            )
        current = connection.execute(
            select(
                ProposalModel.version,
                ProposalModel.current_revision,
                ProposalModel.status,
                ProposalModel.review_event_id,
            ).where(
                ProposalModel.id == command.proposal_id
            )
        ).one_or_none()
        if current is None:
            raise ProposalNotFoundError(f"proposal {command.proposal_id} does not exist")
        if current.version != command.expected_version or current.status != ProposalStatus.APPROVED.value:
            raise StaleProposalError(
                f"proposal {command.proposal_id} is no longer the expected approved version"
            )
        revision = connection.execute(
            select(
                ProposalRevisionModel.change_type,
                ProposalRevisionModel.expected_release_id,
                ProposalRevisionModel.expected_release_sha256,
                ProposalRevisionModel.source_candidate_key,
                ProposalRevisionModel.target_dataset,
                ProposalRevisionModel.target_key,
                ProposalRevisionModel.payload_sha256,
            ).where(
                ProposalRevisionModel.proposal_id == command.proposal_id,
                ProposalRevisionModel.revision == current.current_revision,
            )
        ).one_or_none()
        if revision is None or (
            revision.expected_release_id != command.expected_base_release_id
            or revision.expected_release_sha256 != command.expected_base_source_bundle_sha256
            or revision.source_candidate_key != command.source_candidate_key
            or revision.target_dataset != command.target_dataset
            or revision.target_key != command.target_key
            or revision.payload_sha256 != command.payload_sha256
            or current.review_event_id != command.review_event_id
        ):
            raise StaleProposalBaseError(
                f"proposal {command.proposal_id} base does not match its reviewed revision"
            )
        approved_event = connection.execute(
            select(ProposalEventModel.id).where(
                ProposalEventModel.proposal_id == command.proposal_id,
                ProposalEventModel.aggregate_version == command.expected_version,
                ProposalEventModel.next_status == ProposalStatus.APPROVED.value,
                ProposalEventModel.review_event_id == command.review_event_id,
            )
        ).scalar_one_or_none()
        if approved_event is None:
            raise StaleProposalError(
                f"proposal {command.proposal_id} has no durable matching approval event"
            )
        target_exists = False
        for target_table_name in canonical_target_tables(command.target_dataset):
            target_table = ProposalModel.metadata.tables.get(target_table_name)
            if (
                target_table is None
                or "release_id" not in target_table.c
                or "external_key" not in target_table.c
            ):
                raise ProposalDomainError(
                    f"proposal target table {target_table_name!r} is not a canonical release dataset"
                )
            if connection.execute(
                select(target_table.c.external_key)
                .where(
                    target_table.c.release_id == release_id,
                    target_table.c.external_key == command.target_key,
                )
                .limit(1)
            ).scalar_one_or_none() is not None:
                target_exists = True
                break
        if revision.change_type == "RETIRE":
            if target_exists:
                raise ProposalDomainError(
                    f"retired proposal target {command.target_dataset}/{command.target_key} "
                    "is still present in the new release"
                )
        elif not target_exists:
            raise ProposalDomainError(
                f"proposal target {command.target_dataset}/{command.target_key} "
                "is absent from the new release"
            )
        updated_id = connection.execute(
            update(ProposalModel)
            .where(
                ProposalModel.id == command.proposal_id,
                ProposalModel.version == command.expected_version,
                ProposalModel.status == ProposalStatus.APPROVED.value,
                ProposalModel.current_revision == current.current_revision,
                ProposalModel.review_event_id == command.review_event_id,
            )
            .values(
                version=command.expected_version + 1,
                status=ProposalStatus.PUBLISHED.value,
                updated_at=occurred_at,
                published_release_id=release_id,
            )
            .returning(ProposalModel.id)
        ).scalar_one_or_none()
        if updated_id is None:
            raise StaleProposalError(
                f"proposal {command.proposal_id} changed while publication was in progress"
            )
        event = ProposalEvent(
            event_id=uuid4(),
            proposal_id=command.proposal_id,
            aggregate_version=command.expected_version + 1,
            current_revision=current.current_revision,
            previous_status=ProposalStatus.APPROVED,
            next_status=ProposalStatus.PUBLISHED,
            event_type=ProposalEventType.PUBLISHED,
            actor=command.actor,
            reason=None,
            review_event_id=command.review_event_id,
            idempotency_key=command.idempotency_key,
            request_hash=command.request_hash,
            resulting_release_id=release_id,
            occurred_at=occurred_at,
        )
        _insert_event(connection, event)
    return tuple(proposal_ids)


def _proposal_values(proposal: Proposal) -> dict[str, Any]:
    return {
        "id": proposal.proposal_id,
        "version": proposal.version,
        "current_revision": proposal.current_revision,
        "status": proposal.status.value,
        "author": proposal.author,
        "created_at": proposal.created_at,
        "updated_at": proposal.updated_at,
        "published_release_id": proposal.published_release_id,
        "review_event_id": proposal.review_event_id,
    }


def _revision_values(revision: ProposalRevision) -> dict[str, Any]:
    return {
        "proposal_id": revision.proposal_id,
        "revision": revision.revision,
        "change_type": revision.change_type,
        "target_dataset": revision.target_dataset,
        "target_key": revision.target_key,
        "source_candidate_key": revision.source_candidate_key,
        "payload": dict(revision.payload),
        "payload_sha256": revision.payload_sha256,
        "expected_release_id": revision.expected_release_id,
        "expected_release_sha256": revision.expected_release_sha256,
        "created_at": revision.created_at,
    }


def _evidence_values(
    proposal_id: UUID, revision: int, evidence: Sequence[ProposalEvidenceReference]
) -> list[dict[str, Any]]:
    from uuid import uuid4

    return [
        {
            "id": uuid4(),
            "proposal_id": proposal_id,
            "revision": revision,
            "source_document_sha256": item.source_document_sha256,
            "source_artifact_key": item.source_artifact_key,
            "locator": item.locator,
            "source_url": item.source_url,
            "captured_at": item.captured_at,
        }
        for item in evidence
    ]


def _event_values(event: ProposalEvent) -> dict[str, Any]:
    return {
        "id": event.event_id,
        "proposal_id": event.proposal_id,
        "aggregate_version": event.aggregate_version,
        "current_revision": event.current_revision,
        "previous_status": event.previous_status.value if event.previous_status else None,
        "next_status": event.next_status.value,
        "event_type": event.event_type.value,
        "actor": event.actor,
        "reason": event.reason,
        "review_event_id": event.review_event_id,
        "idempotency_key": event.idempotency_key,
        "request_hash": event.request_hash,
        "resulting_release_id": event.resulting_release_id,
        "occurred_at": event.occurred_at,
    }


def _insert_revision(connection: Connection, revision: ProposalRevision) -> None:
    connection.execute(insert(ProposalRevisionModel).values(**_revision_values(revision)))


def _insert_evidence(
    connection: Connection,
    proposal_id: UUID,
    revision: int,
    evidence: Sequence[ProposalEvidenceReference],
) -> None:
    rows = _evidence_values(proposal_id, revision, evidence)
    if rows:
        connection.execute(insert(ProposalEvidenceReferenceModel), rows)


def _insert_event(connection: Connection, event: ProposalEvent) -> None:
    connection.execute(insert(ProposalEventModel).values(**_event_values(event)))


def _revision_from_row(row: Any) -> ProposalRevision:
    return ProposalRevision(
        proposal_id=row["proposal_id"],
        revision=row["revision"],
        change_type=row["change_type"],
        target_dataset=row["target_dataset"],
        target_key=row["target_key"],
        source_candidate_key=row["source_candidate_key"],
        payload=row["payload"],
        payload_sha256=row["payload_sha256"],
        expected_release_id=row["expected_release_id"],
        expected_release_sha256=row["expected_release_sha256"],
        created_at=row["created_at"],
    )


def _evidence_from_row(row: Any) -> ProposalEvidenceReference:
    return ProposalEvidenceReference(
        source_document_sha256=row["source_document_sha256"],
        source_artifact_key=row["source_artifact_key"],
        locator=row["locator"],
        source_url=row["source_url"],
        captured_at=row["captured_at"],
    )


def _event_from_row(row: Any) -> ProposalEvent:
    return ProposalEvent(
        event_id=row["id"],
        proposal_id=row["proposal_id"],
        aggregate_version=row["aggregate_version"],
        current_revision=row["current_revision"],
        previous_status=ProposalStatus(row["previous_status"]) if row["previous_status"] else None,
        next_status=ProposalStatus(row["next_status"]),
        event_type=ProposalEventType(row["event_type"]),
        actor=row["actor"],
        reason=row["reason"],
        review_event_id=row["review_event_id"],
        idempotency_key=row["idempotency_key"],
        request_hash=row["request_hash"],
        resulting_release_id=row["resulting_release_id"],
        occurred_at=row["occurred_at"],
    )


def _load_current(
    self: SQLAlchemyProposalRepository,
    connection: Connection,
    proposal_id: UUID,
    *,
    missing_ok: bool = False,
) -> Proposal | None:
    row = connection.execute(
        select(ProposalModel.__table__).where(ProposalModel.id == proposal_id)
    ).mappings().one_or_none()
    if row is None:
        if missing_ok:
            return None
        raise ProposalNotFoundError(f"proposal {proposal_id} does not exist")
    revision_row = connection.execute(
        select(ProposalRevisionModel.__table__).where(
            ProposalRevisionModel.proposal_id == proposal_id,
            ProposalRevisionModel.revision == row["current_revision"],
        )
    ).mappings().one()
    evidence_rows = connection.execute(
        select(ProposalEvidenceReferenceModel.__table__)
        .where(
            ProposalEvidenceReferenceModel.proposal_id == proposal_id,
            ProposalEvidenceReferenceModel.revision == row["current_revision"],
        )
        .order_by(ProposalEvidenceReferenceModel.id)
    ).mappings()
    rejection_reason = None
    if row["status"] == ProposalStatus.REJECTED.value:
        rejection_reason = connection.execute(
            select(ProposalEventModel.reason).where(
                ProposalEventModel.proposal_id == proposal_id,
                ProposalEventModel.aggregate_version == row["version"],
                ProposalEventModel.next_status == ProposalStatus.REJECTED.value,
            )
        ).scalar_one_or_none()
    return Proposal(
        proposal_id=row["id"],
        version=row["version"],
        current_revision=row["current_revision"],
        status=ProposalStatus(row["status"]),
        author=row["author"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        published_release_id=row["published_release_id"],
        review_event_id=row["review_event_id"],
        revision=_revision_from_row(revision_row),
        evidence=tuple(_evidence_from_row(item) for item in evidence_rows),
        rejection_reason=rejection_reason,
    )


def _replay(
    self: SQLAlchemyProposalRepository,
    connection: Connection,
    proposal_id: UUID,
    *,
    idempotency_key: str,
    request_hash: str,
) -> Proposal | None:
    event_row = connection.execute(
        select(ProposalEventModel.__table__).where(
            ProposalEventModel.proposal_id == proposal_id,
            ProposalEventModel.idempotency_key == idempotency_key,
        )
    ).mappings().one_or_none()
    if event_row is None:
        return None
    if event_row["request_hash"] != request_hash:
        raise ProposalIdempotencyConflict(
            "proposal idempotency key was already used with a different request hash"
        )
    aggregate_row = connection.execute(
        select(ProposalModel.__table__).where(ProposalModel.id == proposal_id)
    ).mappings().one()
    revision_row = connection.execute(
        select(ProposalRevisionModel.__table__).where(
            ProposalRevisionModel.proposal_id == proposal_id,
            ProposalRevisionModel.revision == event_row["current_revision"],
        )
    ).mappings().one()
    evidence_rows = connection.execute(
        select(ProposalEvidenceReferenceModel.__table__)
        .where(
            ProposalEvidenceReferenceModel.proposal_id == proposal_id,
            ProposalEvidenceReferenceModel.revision == event_row["current_revision"],
        )
        .order_by(ProposalEvidenceReferenceModel.id)
    ).mappings()
    status = ProposalStatus(event_row["next_status"])
    return Proposal(
        proposal_id=proposal_id,
        version=event_row["aggregate_version"],
        current_revision=event_row["current_revision"],
        status=status,
        author=aggregate_row["author"],
        created_at=aggregate_row["created_at"],
        updated_at=event_row["occurred_at"],
        published_release_id=event_row["resulting_release_id"],
        review_event_id=(
            event_row["review_event_id"]
            if status in {ProposalStatus.APPROVED, ProposalStatus.PUBLISHED}
            else None
        ),
        revision=_revision_from_row(revision_row),
        evidence=tuple(_evidence_from_row(item) for item in evidence_rows),
        rejection_reason=event_row["reason"] if status is ProposalStatus.REJECTED else None,
    )


def _raise_stale(connection: Connection, proposal_id: UUID, expected_version: int) -> None:
    actual = connection.execute(
        select(ProposalModel.version, ProposalModel.status).where(ProposalModel.id == proposal_id)
    ).one_or_none()
    if actual is None:
        raise ProposalNotFoundError(f"proposal {proposal_id} does not exist")
    raise StaleProposalError(
        f"proposal version changed: expected {expected_version}, found {actual.version}/{actual.status}"
    )
