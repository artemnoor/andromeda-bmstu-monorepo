"""Internal proposal lifecycle use cases; deliberately not registered as HTTP routes."""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import replace
from datetime import UTC, datetime
from getpass import getuser
from typing import Any
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

from andromeda_db.connection import create_service_engine
from andromeda_db.repositories.proposals import SQLAlchemyProposalRepository
from andromeda_ontology.ports import ProposalAuthorization, ProposalRepository
from andromeda_ontology.proposals import (
    InvalidProposalIdentityError,
    InvalidProposalTransitionError,
    MissingProposalEvidenceError,
    Proposal,
    ProposalDomainError,
    ProposalEvent,
    ProposalEventType,
    ProposalEvidenceReference,
    ProposalIdempotencyConflict,
    ProposalNotFoundError,
    ProposalPermissionDeniedError,
    ProposalPublicationCommand,
    ProposalRevision,
    ProposalStatus,
    StaleProposalError,
    canonical_payload,
    ensure_proposal_transition,
    payload_sha256,
    proposal_publication_request_sha256,
    request_sha256,
    require_idempotency_key,
    require_nonblank,
    require_sha256,
)

from andromeda_api.application.settings import Settings, load_settings


class ProposalValidationError(ProposalDomainError):
    """A proposal payload fails one or more application validation rules."""

    code = "proposal_validation_error"

    def __init__(self, errors: Sequence[str]) -> None:
        self.errors = tuple(errors)
        super().__init__("proposal validation failed: " + "; ".join(self.errors))


class DenyProposalAuthorization:
    """Safe default: no proposal command is privileged without an explicit policy."""

    def is_authorized(self, actor: str, action: str, proposal: Proposal | None) -> bool:
        return False


class AllowProposalAuthorization:
    """Explicit policy for trusted internal composition roots and isolated tests."""

    def is_authorized(self, actor: str, action: str, proposal: Proposal | None) -> bool:
        return True


class TrustedInternalCLIProposalAuthorization:
    """Local operator policy for the CLI composition root; never registered with HTTP."""

    def is_authorized(self, actor: str, action: str, proposal: Proposal | None) -> bool:
        return actor.strip() == getuser() and action in {
            "create",
            "validated",
            "needs_review",
            "approved",
            "rejected",
            "conflicting",
            "rebase",
            "publish",
        }


class ProposalApplicationService:
    """Internal proposal use cases with injected persistence and authorization ports."""

    def __init__(
        self,
        repository: ProposalRepository,
        *,
        authorization: ProposalAuthorization | None = None,
        validator: Callable[[Mapping[str, Any]], Sequence[str]] | None = None,
    ) -> None:
        self.repository = repository
        self.authorization = authorization or DenyProposalAuthorization()
        self.validator = validator or (lambda _payload: ())

    def create_proposal(
        self,
        *,
        change_type: str,
        target_dataset: str,
        target_key: str,
        source_candidate_key: str | None = None,
        payload: Mapping[str, Any],
        author: str,
        expected_active_release_id: UUID | None,
        expected_active_release_sha256: str | None,
        evidence: Sequence[ProposalEvidenceReference],
        idempotency_key: str,
        request_hash: str | None = None,
        proposal_id: UUID | None = None,
    ) -> Proposal:
        normalized_author = require_nonblank(author, field="author")
        key = require_idempotency_key(idempotency_key)
        if expected_active_release_id is None and expected_active_release_sha256 is not None:
            raise InvalidProposalIdentityError("release digest requires an expected active release ID")
        if expected_active_release_id is not None and expected_active_release_sha256 is None:
            raise InvalidProposalIdentityError("expected active release ID requires its SHA-256 digest")
        normalized_base_hash = (
            require_sha256(expected_active_release_sha256, field="expected_active_release_sha256")
            if expected_active_release_sha256 is not None
            else None
        )
        normalized_payload = canonical_payload(payload)
        normalized_evidence = tuple(evidence)
        identifier = proposal_id or uuid5(NAMESPACE_URL, f"andromeda-proposal:{key}")
        self._authorize(normalized_author, "create", None)

        created_at = datetime.now(UTC)
        revision = ProposalRevision(
            proposal_id=identifier,
            revision=1,
            change_type=change_type,
            target_dataset=target_dataset,
            target_key=target_key,
            source_candidate_key=source_candidate_key,
            payload=normalized_payload,
            payload_sha256=payload_sha256(normalized_payload),
            expected_release_id=expected_active_release_id,
            expected_release_sha256=normalized_base_hash,
            created_at=created_at,
        )
        computed_hash = request_sha256(
            {
                "operation": "create",
                "proposal_id": str(identifier),
                "change_type": revision.change_type,
                "target_dataset": revision.target_dataset,
                "target_key": revision.target_key,
                "source_candidate_key": revision.source_candidate_key,
                "payload_sha256": revision.payload_sha256,
                "expected_release_id": (
                    str(expected_active_release_id) if expected_active_release_id else None
                ),
                "expected_release_sha256": normalized_base_hash,
                "evidence": [self._evidence_payload(item) for item in normalized_evidence],
                "author": normalized_author,
            }
        )
        normalized_hash = self._request_hash(computed_hash, request_hash)
        replay = self.repository.replay(
            identifier, idempotency_key=key, request_hash=normalized_hash
        )
        if replay is not None:
            return replay

        proposal = Proposal(
            proposal_id=identifier,
            version=1,
            current_revision=1,
            status=ProposalStatus.DRAFT,
            author=normalized_author,
            created_at=created_at,
            updated_at=created_at,
            revision=revision,
            evidence=normalized_evidence,
        )
        event = ProposalEvent(
            event_id=uuid4(),
            proposal_id=identifier,
            aggregate_version=1,
            current_revision=1,
            previous_status=None,
            next_status=ProposalStatus.DRAFT,
            event_type=ProposalEventType.CREATED,
            actor=normalized_author,
            reason=None,
            review_event_id=None,
            idempotency_key=key,
            request_hash=normalized_hash,
            resulting_release_id=None,
            occurred_at=created_at,
        )
        return self.repository.create(proposal, revision, normalized_evidence, event)

    def validate_proposal(
        self,
        proposal_id: UUID,
        *,
        expected_version: int,
        actor: str,
        idempotency_key: str,
        request_hash: str | None = None,
    ) -> Proposal:
        return self._transition(
            proposal_id,
            expected_version=expected_version,
            actor=actor,
            target=ProposalStatus.VALIDATED,
            event_type=ProposalEventType.VALIDATED,
            reason=None,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
            check_evidence=True,
            run_validator=True,
        )

    def mark_needs_review(
        self,
        proposal_id: UUID,
        *,
        expected_version: int,
        actor: str,
        reason: str,
        idempotency_key: str,
        request_hash: str | None = None,
    ) -> Proposal:
        return self._transition(
            proposal_id,
            expected_version=expected_version,
            actor=actor,
            target=ProposalStatus.NEEDS_REVIEW,
            event_type=ProposalEventType.NEEDS_REVIEW,
            reason=reason,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
        )

    def mark_conflicting(
        self,
        proposal_id: UUID,
        *,
        expected_version: int,
        actor: str,
        reason: str,
        idempotency_key: str,
        request_hash: str | None = None,
    ) -> Proposal:
        """Record a stale publication base after the failed release transaction rolls back."""

        return self._transition(
            proposal_id,
            expected_version=expected_version,
            actor=actor,
            target=ProposalStatus.CONFLICTING,
            event_type=ProposalEventType.CONFLICTING,
            reason=reason,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
        )

    def mark_proposals_conflicting(
        self,
        proposals: Iterable[tuple[UUID, int, str]],
        *,
        actor: str,
        idempotency_key_prefix: str,
    ) -> tuple[Proposal, ...]:
        """CAS approved proposals to CONFLICTING after a stale-base publication rollback."""

        return tuple(
            self.mark_conflicting(
                proposal_id,
                expected_version=version,
                actor=actor,
                reason=reason,
                idempotency_key=f"{idempotency_key_prefix}:{proposal_id}",
            )
            for proposal_id, version, reason in proposals
        )

    def approve_proposal(
        self,
        proposal_id: UUID,
        *,
        expected_version: int,
        reviewer: str,
        reason: str,
        review_event_id: str,
        idempotency_key: str,
        request_hash: str | None = None,
    ) -> Proposal:
        return self._transition(
            proposal_id,
            expected_version=expected_version,
            actor=reviewer,
            target=ProposalStatus.APPROVED,
            event_type=ProposalEventType.APPROVED,
            reason=reason,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
            check_evidence=True,
            review_event_id=review_event_id,
        )

    def reject_proposal(
        self,
        proposal_id: UUID,
        *,
        expected_version: int,
        reviewer: str,
        reason: str,
        review_event_id: str | None = None,
        idempotency_key: str,
        request_hash: str | None = None,
    ) -> Proposal:
        return self._transition(
            proposal_id,
            expected_version=expected_version,
            actor=reviewer,
            target=ProposalStatus.REJECTED,
            event_type=ProposalEventType.REJECTED,
            reason=reason,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
            review_event_id=review_event_id,
        )

    def rebase_conflicting_proposal(
        self,
        proposal_id: UUID,
        *,
        expected_version: int,
        actor: str,
        change_type: str,
        target_dataset: str,
        target_key: str,
        source_candidate_key: str | None = None,
        payload: Mapping[str, Any],
        expected_active_release_id: UUID | None,
        expected_active_release_sha256: str | None,
        evidence: Sequence[ProposalEvidenceReference],
        reason: str,
        idempotency_key: str,
        request_hash: str | None = None,
    ) -> Proposal:
        key = require_idempotency_key(idempotency_key)
        normalized_actor = require_nonblank(actor, field="actor")
        normalized_reason = require_nonblank(reason, field="reason")
        evidence_rows = tuple(evidence)
        if not evidence_rows:
            raise MissingProposalEvidenceError("a rebased proposal requires source evidence")
        payload_value = canonical_payload(payload)
        if expected_active_release_id is None and expected_active_release_sha256 is not None:
            raise InvalidProposalIdentityError("release digest requires an expected active release ID")
        if expected_active_release_id is not None and expected_active_release_sha256 is None:
            raise InvalidProposalIdentityError("expected active release ID requires its SHA-256 digest")
        base_hash = (
            require_sha256(expected_active_release_sha256, field="expected_active_release_sha256")
            if expected_active_release_sha256
            else None
        )
        computed_hash = request_sha256(
            {
                "operation": "rebase",
                "proposal_id": str(proposal_id),
                "expected_version": expected_version,
                "actor": normalized_actor,
                "reason": normalized_reason,
                "change_type": change_type,
                "target_dataset": target_dataset,
                "target_key": target_key,
                "payload_sha256": payload_sha256(payload_value),
                "source_candidate_key": source_candidate_key,
                "expected_release_id": str(expected_active_release_id)
                if expected_active_release_id
                else None,
                "expected_release_sha256": base_hash,
                "evidence": [self._evidence_payload(item) for item in evidence_rows],
            }
        )
        normalized_hash = self._request_hash(computed_hash, request_hash)
        replay = self.repository.replay(proposal_id, idempotency_key=key, request_hash=normalized_hash)
        if replay is not None:
            self._authorize(normalized_actor, "rebase", replay)
            return replay
        current = self._current(proposal_id, expected_version)
        self._authorize(normalized_actor, "rebase", current)
        ensure_proposal_transition(current.status, ProposalStatus.DRAFT, has_new_revision=True)
        now = datetime.now(UTC)
        new_revision = ProposalRevision(
            proposal_id=proposal_id,
            revision=current.current_revision + 1,
            change_type=change_type,
            target_dataset=target_dataset,
            target_key=target_key,
            source_candidate_key=source_candidate_key,
            payload=payload_value,
            payload_sha256=payload_sha256(payload_value),
            expected_release_id=expected_active_release_id,
            expected_release_sha256=base_hash,
            created_at=now,
        )
        updated = replace(
            current,
            version=current.version + 1,
            current_revision=new_revision.revision,
            status=ProposalStatus.DRAFT,
            updated_at=now,
            published_release_id=None,
            revision=new_revision,
            evidence=evidence_rows,
            rejection_reason=None,
            review_event_id=None,
        )
        event = self._event(
            current,
            updated,
            actor=normalized_actor,
            reason=normalized_reason,
            event_type=ProposalEventType.REBASED,
            idempotency_key=key,
            request_hash=normalized_hash,
            review_event_id=None,
            occurred_at=now,
        )
        return self.repository.rebase(
            updated,
            new_revision,
            evidence_rows,
            event,
            expected_version=expected_version,
        )

    def publication_command(
        self,
        proposal_id: UUID,
        *,
        expected_version: int,
        actor: str,
        idempotency_key: str,
        request_hash: str | None = None,
    ) -> ProposalPublicationCommand:
        key = require_idempotency_key(idempotency_key)
        normalized_actor = require_nonblank(actor, field="actor")
        current = self.repository.get(proposal_id)
        if current is None:
            raise ProposalNotFoundError(f"proposal {proposal_id} does not exist")
        prior_event = next(
            (event for event in self.repository.events_for(proposal_id) if event.idempotency_key == key),
            None,
        )
        retry_event = None
        if prior_event is not None:
            if (
                prior_event.event_type is not ProposalEventType.PUBLISHED
                or current.status is not ProposalStatus.PUBLISHED
                or prior_event.aggregate_version != expected_version + 1
                or current.version != expected_version + 1
            ):
                raise ProposalIdempotencyConflict(
                    "proposal idempotency key was already used for a different command"
                )
            retry_event = prior_event
            if retry_event.actor != normalized_actor:
                raise ProposalIdempotencyConflict(
                    "published proposal key was already used by a different actor"
                )
        elif current.version != expected_version:
            raise StaleProposalError(
                f"proposal version changed: expected {expected_version}, found {current.version}"
            )
        self._authorize(normalized_actor, "publish", current)
        if current.status is not ProposalStatus.APPROVED and retry_event is None:
            raise InvalidProposalTransitionError("only APPROVED proposals can join publication")
        if current.revision is None:
            raise InvalidProposalIdentityError("proposal has no immutable content revision")
        self._require_evidence(current)
        if current.revision.source_candidate_key is None:
            raise InvalidProposalIdentityError("proposal is not linked to a reviewed ingestion candidate")
        if current.review_event_id is None:
            raise InvalidProposalIdentityError("approved proposal has no exact review event reference")
        computed_hash = proposal_publication_request_sha256(
            proposal_id=proposal_id,
            expected_version=expected_version,
            expected_base_release_id=current.revision.expected_release_id,
            expected_base_source_bundle_sha256=current.revision.expected_release_sha256,
            source_candidate_key=current.revision.source_candidate_key,
            review_event_id=current.review_event_id,
            target_dataset=current.revision.target_dataset,
            target_key=current.revision.target_key,
            payload_sha256=current.revision.payload_sha256,
            actor=normalized_actor,
            idempotency_key=key,
        )
        normalized_hash = self._request_hash(computed_hash, request_hash)
        if retry_event is not None and retry_event.request_hash != normalized_hash:
            raise ProposalIdempotencyConflict(
                "published proposal key was already used with a different request"
            )
        return ProposalPublicationCommand(
            proposal_id=proposal_id,
            expected_version=expected_version,
            expected_status=ProposalStatus.APPROVED,
            expected_base_release_id=current.revision.expected_release_id,
            expected_base_source_bundle_sha256=current.revision.expected_release_sha256,
            source_candidate_key=current.revision.source_candidate_key,
            review_event_id=current.review_event_id,
            target_dataset=current.revision.target_dataset,
            target_key=current.revision.target_key,
            payload_sha256=current.revision.payload_sha256,
            actor=normalized_actor,
            idempotency_key=key,
            request_hash=normalized_hash,
        )

    def publish_proposal(self, proposal_id: UUID, **kwargs: Any) -> ProposalPublicationCommand:
        """Compatibility name that prepares publication; only the release transaction publishes."""

        return self.publication_command(proposal_id, **kwargs)

    def _transition(
        self,
        proposal_id: UUID,
        *,
        expected_version: int,
        actor: str,
        target: ProposalStatus,
        event_type: ProposalEventType,
        reason: str | None,
        idempotency_key: str,
        request_hash: str | None,
        check_evidence: bool = False,
        run_validator: bool = False,
        review_event_id: str | None = None,
    ) -> Proposal:
        normalized_actor = require_nonblank(actor, field="actor")
        key = require_idempotency_key(idempotency_key)
        normalized_reason = require_nonblank(reason, field="reason") if reason is not None else None
        computed_hash = request_sha256(
            {
                "operation": event_type.value.lower(),
                "proposal_id": str(proposal_id),
                "expected_version": expected_version,
                "actor": normalized_actor,
                "reason": normalized_reason,
                "review_event_id": review_event_id,
            }
        )
        normalized_hash = self._request_hash(computed_hash, request_hash)
        replay = self.repository.replay(
            proposal_id, idempotency_key=key, request_hash=normalized_hash
        )
        if replay is not None:
            self._authorize(normalized_actor, event_type.value.lower(), replay)
            return replay
        try:
            current = self._current(proposal_id, expected_version)
        except StaleProposalError:
            # A concurrent retry with the same idempotency key may have committed
            # between the first replay lookup and this version check. Resolve that
            # committed result before reporting a stale write to the caller.
            replay = self.repository.replay(
                proposal_id, idempotency_key=key, request_hash=normalized_hash
            )
            if replay is None:
                raise
            self._authorize(normalized_actor, event_type.value.lower(), replay)
            return replay
        self._authorize(normalized_actor, event_type.value.lower(), current)
        ensure_proposal_transition(current.status, target)
        if target is ProposalStatus.APPROVED and current.status not in {
            ProposalStatus.VALIDATED,
            ProposalStatus.NEEDS_REVIEW,
        }:
            raise InvalidProposalTransitionError("only VALIDATED or NEEDS_REVIEW proposals can be approved")
        if check_evidence:
            self._require_evidence(current)
        if run_validator and current.revision is not None:
            errors = tuple(self.validator(current.revision.payload))
            if errors:
                raise ProposalValidationError(errors)
        if target is ProposalStatus.REJECTED and normalized_reason is None:
            raise InvalidProposalIdentityError("rejection requires a nonblank reason")
        if target is ProposalStatus.APPROVED and normalized_reason is None:
            raise InvalidProposalIdentityError("approval requires a nonblank decision reason")
        now = datetime.now(UTC)
        updated = replace(
            current,
            version=current.version + 1,
            status=target,
            updated_at=now,
            rejection_reason=normalized_reason if target is ProposalStatus.REJECTED else None,
            review_event_id=review_event_id if target is ProposalStatus.APPROVED else None,
        )
        self._event(
            current,
            updated,
            actor=normalized_actor,
            reason=normalized_reason,
            event_type=event_type,
            idempotency_key=key,
            request_hash=normalized_hash,
            review_event_id=review_event_id,
            occurred_at=now,
        )
        return self.repository.transition(
            proposal_id,
            expected_version=expected_version,
            expected_status=current.status,
            next_status=target,
            actor=normalized_actor,
            reason=normalized_reason,
            event_type=event_type.value,
            idempotency_key=key,
            request_hash=normalized_hash,
            review_event_id=review_event_id,
        )

    @staticmethod
    def _event(
        current: Proposal,
        updated: Proposal,
        *,
        actor: str,
        reason: str | None,
        event_type: ProposalEventType,
        idempotency_key: str,
        request_hash: str,
        review_event_id: str | None,
        occurred_at: datetime,
    ) -> ProposalEvent:
        return ProposalEvent(
            event_id=uuid4(),
            proposal_id=current.proposal_id,
            aggregate_version=updated.version,
            current_revision=updated.current_revision,
            previous_status=current.status,
            next_status=updated.status,
            event_type=event_type,
            actor=actor,
            reason=reason,
            review_event_id=review_event_id,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
            resulting_release_id=updated.published_release_id,
            occurred_at=occurred_at,
        )

    @staticmethod
    def _evidence_payload(item: ProposalEvidenceReference) -> dict[str, Any]:
        return {
            "source_document_sha256": item.source_document_sha256,
            "source_artifact_key": item.source_artifact_key,
            "locator": item.locator,
            "source_url": item.source_url,
            "captured_at": item.captured_at.isoformat() if item.captured_at else None,
        }

    @staticmethod
    def _request_hash(computed: str, supplied: str | None) -> str:
        if supplied is None:
            return computed
        normalized = require_sha256(supplied, field="request_hash")
        if normalized != computed:
            raise ProposalIdempotencyConflict(
                "request_hash does not match the normalized proposal command"
            )
        return normalized

    @staticmethod
    def _require_evidence(proposal: Proposal) -> None:
        if not proposal.evidence:
            raise MissingProposalEvidenceError("proposal cannot be validated or approved without evidence")
        if proposal.revision is None:
            raise InvalidProposalIdentityError("proposal has no content revision")
        if payload_sha256(proposal.revision.payload) != proposal.revision.payload_sha256:
            raise InvalidProposalIdentityError("proposal content no longer matches its revision hash")

    def _current(self, proposal_id: UUID, expected_version: int) -> Proposal:
        current = self.repository.get(proposal_id)
        if current is None:
            raise ProposalNotFoundError(f"proposal {proposal_id} does not exist")
        if current.version != expected_version:
            raise StaleProposalError(
                f"proposal version changed: expected {expected_version}, found {current.version}"
            )
        return current

    def _authorize(self, actor: str, action: str, proposal: Proposal | None) -> None:
        if not self.authorization.is_authorized(actor, action, proposal):
            raise ProposalPermissionDeniedError(
                f"actor is not authorized to {action} this proposal"
            )


@contextmanager
def proposal_service_context(
    settings: Settings | None = None,
    *,
    authorization: ProposalAuthorization | None = None,
    validator: Callable[[Mapping[str, Any]], Sequence[str]] | None = None,
):
    """Build the DB-backed use case for a trusted internal caller and always dispose its engine.

    The HTTP API has no proposal write routes. Local CLI commands use the explicit internal
    operator policy and the configured academic-data database credential.
    """

    selected_settings = settings or load_settings()
    engine = create_service_engine(selected_settings)
    try:
        repository = SQLAlchemyProposalRepository(engine)
        yield ProposalApplicationService(
            repository,
            authorization=authorization or DenyProposalAuthorization(),
            validator=validator,
        )
    finally:
        engine.dispose()
