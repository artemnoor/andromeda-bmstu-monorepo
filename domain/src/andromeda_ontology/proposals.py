"""Framework-independent proposal lifecycle values and invariants."""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID


class ProposalStatus(StrEnum):
    DRAFT = "DRAFT"
    VALIDATED = "VALIDATED"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    CONFLICTING = "CONFLICTING"
    PUBLISHED = "PUBLISHED"


class ProposalEventType(StrEnum):
    CREATED = "CREATED"
    VALIDATED = "VALIDATED"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    CONFLICTING = "CONFLICTING"
    REBASED = "REBASED"
    PUBLISHED = "PUBLISHED"


class ProposalDomainError(ValueError):
    """Base class for stable proposal invariant errors."""

    code = "proposal_domain_error"


class InvalidProposalTransitionError(ProposalDomainError):
    code = "invalid_proposal_transition"


class MissingProposalEvidenceError(ProposalDomainError):
    code = "missing_proposal_evidence"


class InvalidProposalIdentityError(ProposalDomainError):
    code = "invalid_proposal_identity"


class ProposalIdempotencyConflict(ProposalDomainError):
    code = "proposal_idempotency_conflict"


class StaleProposalError(ProposalDomainError):
    code = "stale_proposal"


class StaleProposalBaseError(ProposalDomainError):
    code = "stale_proposal_base"


class ProposalNotFoundError(ProposalDomainError):
    code = "proposal_not_found"


class ProposalPermissionDeniedError(ProposalDomainError):
    code = "proposal_permission_denied"


_ALLOWED_TRANSITIONS: dict[ProposalStatus, frozenset[ProposalStatus]] = {
    ProposalStatus.DRAFT: frozenset(
        {
            ProposalStatus.VALIDATED,
            ProposalStatus.NEEDS_REVIEW,
            ProposalStatus.CONFLICTING,
            ProposalStatus.REJECTED,
        }
    ),
    ProposalStatus.VALIDATED: frozenset(
        {
            ProposalStatus.NEEDS_REVIEW,
            ProposalStatus.APPROVED,
            ProposalStatus.CONFLICTING,
            ProposalStatus.REJECTED,
        }
    ),
    ProposalStatus.NEEDS_REVIEW: frozenset(
        {ProposalStatus.APPROVED, ProposalStatus.CONFLICTING, ProposalStatus.REJECTED}
    ),
    ProposalStatus.CONFLICTING: frozenset(),
    ProposalStatus.APPROVED: frozenset({ProposalStatus.CONFLICTING}),
    ProposalStatus.REJECTED: frozenset(),
    ProposalStatus.PUBLISHED: frozenset(),
}


def ensure_proposal_transition(
    current: ProposalStatus,
    target: ProposalStatus,
    *,
    has_new_revision: bool = False,
    publication_transaction: bool = False,
) -> None:
    """Reject transitions outside the explicit lifecycle policy."""

    if current is ProposalStatus.CONFLICTING and target is ProposalStatus.DRAFT and has_new_revision:
        return
    if current is ProposalStatus.APPROVED and target is ProposalStatus.PUBLISHED:
        if publication_transaction:
            return
        raise InvalidProposalTransitionError(
            "APPROVED proposals become PUBLISHED only inside the release publication transaction"
        )
    if target not in _ALLOWED_TRANSITIONS[current]:
        raise InvalidProposalTransitionError(
            f"proposal cannot transition from {current.value} to {target.value}"
        )


def require_nonblank(value: str, *, field: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise InvalidProposalIdentityError(f"{field} must not be blank")
    return normalized


def require_idempotency_key(value: str) -> str:
    normalized = require_nonblank(value, field="idempotency_key")
    if len(normalized) > 256:
        raise InvalidProposalIdentityError("idempotency_key must not exceed 256 characters")
    return normalized


def require_sha256(value: str, *, field: str) -> str:
    normalized = value.lower()
    if not re.fullmatch(r"[0-9a-f]{64}", normalized):
        raise InvalidProposalIdentityError(f"{field} must be a lowercase SHA-256 hex digest")
    return normalized


def canonical_json(value: Any) -> str:
    """Return the stable JSON representation used for payload and request hashes."""

    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            sort_keys=True,
            separators=(",", ":"),
        )
    except (TypeError, ValueError) as error:
        raise InvalidProposalIdentityError("proposal data must be finite JSON values") from error


def canonical_payload(value: Mapping[str, Any]) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise InvalidProposalIdentityError("proposal payload must be a mapping")
    return json.loads(canonical_json(dict(value)))


def payload_sha256(value: Mapping[str, Any]) -> str:
    return hashlib.sha256(canonical_json(canonical_payload(value)).encode("utf-8")).hexdigest()


def request_sha256(value: Mapping[str, Any]) -> str:
    return hashlib.sha256(canonical_json(dict(value)).encode("utf-8")).hexdigest()


def proposal_publication_request_sha256(
    *,
    proposal_id: UUID,
    expected_version: int,
    expected_base_release_id: UUID | None,
    expected_base_source_bundle_sha256: str | None,
    source_candidate_key: str,
    review_event_id: str,
    target_dataset: str,
    target_key: str,
    payload_sha256: str,
    actor: str,
    idempotency_key: str,
) -> str:
    """Hash stable proposal command facts, excluding generated release IDs.

    Bundle publication identity and hashes belong to ``import_batches`` and must not replace
    this proposal-level request hash during transaction retries.
    """

    return request_sha256(
        {
            "operation": "publish_proposal",
            "proposal_id": str(proposal_id),
            "expected_version": expected_version,
            "expected_status": ProposalStatus.APPROVED.value,
            "expected_base_release_id": str(expected_base_release_id)
            if expected_base_release_id
            else None,
            "expected_base_source_bundle_sha256": expected_base_source_bundle_sha256,
            "source_candidate_key": source_candidate_key,
            "review_event_id": review_event_id,
            "target_dataset": target_dataset,
            "target_key": target_key,
            "payload_sha256": payload_sha256,
            "actor": actor,
            "idempotency_key": idempotency_key,
        }
    )


@dataclass(frozen=True, slots=True)
class ProposalEvidenceReference:
    source_document_sha256: str
    source_artifact_key: str
    locator: str
    source_url: str | None = None
    captured_at: datetime | None = None

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "source_document_sha256",
            require_sha256(self.source_document_sha256, field="source_document_sha256"),
        )
        object.__setattr__(
            self,
            "source_artifact_key",
            require_nonblank(self.source_artifact_key, field="source_artifact_key"),
        )
        object.__setattr__(self, "locator", require_nonblank(self.locator, field="locator"))


@dataclass(frozen=True, slots=True)
class ProposalRevision:
    proposal_id: UUID
    revision: int
    change_type: str
    target_dataset: str
    target_key: str
    source_candidate_key: str | None
    payload: Mapping[str, Any]
    payload_sha256: str
    expected_release_id: UUID | None
    expected_release_sha256: str | None
    created_at: datetime

    def __post_init__(self) -> None:
        if self.revision < 1:
            raise InvalidProposalIdentityError("proposal revision must be positive")
        for field in ("change_type", "target_dataset", "target_key"):
            object.__setattr__(self, field, require_nonblank(getattr(self, field), field=field))
        if self.source_candidate_key is not None:
            object.__setattr__(
                self,
                "source_candidate_key",
                require_nonblank(self.source_candidate_key, field="source_candidate_key"),
            )
        payload = canonical_payload(self.payload)
        object.__setattr__(self, "payload", payload)
        digest = payload_sha256(payload)
        if self.payload_sha256 and require_sha256(self.payload_sha256, field="payload_sha256") != digest:
            raise InvalidProposalIdentityError("payload_sha256 does not match the canonical payload")
        object.__setattr__(self, "payload_sha256", digest)
        if self.expected_release_sha256 is not None:
            object.__setattr__(
                self,
                "expected_release_sha256",
                require_sha256(self.expected_release_sha256, field="expected_release_sha256"),
            )


@dataclass(frozen=True, slots=True)
class Proposal:
    proposal_id: UUID
    version: int
    current_revision: int
    status: ProposalStatus
    author: str
    created_at: datetime
    updated_at: datetime
    published_release_id: UUID | None = None
    review_event_id: str | None = None
    revision: ProposalRevision | None = None
    evidence: tuple[ProposalEvidenceReference, ...] = ()
    rejection_reason: str | None = None

    def __post_init__(self) -> None:
        if self.version < 1 or self.current_revision < 1:
            raise InvalidProposalIdentityError("proposal version and current revision must be positive")
        object.__setattr__(self, "author", require_nonblank(self.author, field="author"))
        if self.revision is not None and (
            self.revision.proposal_id != self.proposal_id
            or self.revision.revision != self.current_revision
        ):
            raise InvalidProposalIdentityError("proposal aggregate and current revision do not match")
        if (self.status is ProposalStatus.PUBLISHED) != (self.published_release_id is not None):
            raise InvalidProposalIdentityError(
                "PUBLISHED proposals must reference a committed release, and other statuses must not"
            )
        if self.review_event_id is not None:
            object.__setattr__(
                self,
                "review_event_id",
                require_sha256(self.review_event_id, field="review_event_id"),
            )
        if (self.status in {ProposalStatus.APPROVED, ProposalStatus.PUBLISHED}) != (
            self.review_event_id is not None
        ):
            raise InvalidProposalIdentityError(
                "APPROVED and PUBLISHED proposals must retain their exact review event"
            )


@dataclass(frozen=True, slots=True)
class ProposalEvent:
    event_id: UUID
    proposal_id: UUID
    aggregate_version: int
    current_revision: int
    previous_status: ProposalStatus | None
    next_status: ProposalStatus
    event_type: ProposalEventType
    actor: str
    reason: str | None
    review_event_id: str | None
    idempotency_key: str
    request_hash: str
    resulting_release_id: UUID | None
    occurred_at: datetime

    def __post_init__(self) -> None:
        if self.aggregate_version < 1 or self.current_revision < 1:
            raise InvalidProposalIdentityError("event aggregate_version and current_revision must be positive")
        object.__setattr__(self, "actor", require_nonblank(self.actor, field="actor"))
        object.__setattr__(
            self, "idempotency_key", require_idempotency_key(self.idempotency_key)
        )
        object.__setattr__(self, "request_hash", require_sha256(self.request_hash, field="request_hash"))
        if self.event_type is ProposalEventType.REJECTED and not (self.reason or "").strip():
            raise InvalidProposalIdentityError("rejection events require a nonblank reason")
        if self.review_event_id is not None:
            object.__setattr__(
                self,
                "review_event_id",
                require_sha256(self.review_event_id, field="review_event_id"),
            )
        if self.event_type in {ProposalEventType.APPROVED, ProposalEventType.PUBLISHED} and (
            self.review_event_id is None
        ):
            raise InvalidProposalIdentityError("decision and publication events require review_event_id")
        if (self.next_status is ProposalStatus.PUBLISHED) != (self.resulting_release_id is not None):
            raise InvalidProposalIdentityError("published events must reference their resulting release")


@dataclass(frozen=True, slots=True)
class ProposalPublicationCommand:
    """Typed input for the canonical release transaction's proposal participant."""

    proposal_id: UUID
    expected_version: int
    expected_status: ProposalStatus
    expected_base_release_id: UUID | None
    expected_base_source_bundle_sha256: str | None
    source_candidate_key: str
    review_event_id: str
    target_dataset: str
    target_key: str
    payload_sha256: str
    actor: str
    idempotency_key: str
    request_hash: str

    def __post_init__(self) -> None:
        if self.expected_version < 1:
            raise InvalidProposalIdentityError("expected_version must be positive")
        if self.expected_status is not ProposalStatus.APPROVED:
            raise InvalidProposalIdentityError("only APPROVED proposals can join publication")
        object.__setattr__(self, "actor", require_nonblank(self.actor, field="actor"))
        object.__setattr__(
            self,
            "source_candidate_key",
            require_nonblank(self.source_candidate_key, field="source_candidate_key"),
        )
        object.__setattr__(self, "review_event_id", require_sha256(self.review_event_id, field="review_event_id"))
        object.__setattr__(self, "target_dataset", require_nonblank(self.target_dataset, field="target_dataset"))
        object.__setattr__(self, "target_key", require_nonblank(self.target_key, field="target_key"))
        object.__setattr__(self, "payload_sha256", require_sha256(self.payload_sha256, field="payload_sha256"))
        object.__setattr__(
            self, "idempotency_key", require_idempotency_key(self.idempotency_key)
        )
        object.__setattr__(self, "request_hash", require_sha256(self.request_hash, field="request_hash"))
        if self.expected_base_source_bundle_sha256 is not None:
            object.__setattr__(
                self,
                "expected_base_source_bundle_sha256",
                require_sha256(
                    self.expected_base_source_bundle_sha256,
                    field="expected_base_source_bundle_sha256",
                ),
            )
        expected_request_hash = proposal_publication_request_sha256(
            proposal_id=self.proposal_id,
            expected_version=self.expected_version,
            expected_base_release_id=self.expected_base_release_id,
            expected_base_source_bundle_sha256=self.expected_base_source_bundle_sha256,
            source_candidate_key=self.source_candidate_key,
            review_event_id=self.review_event_id,
            target_dataset=self.target_dataset,
            target_key=self.target_key,
            payload_sha256=self.payload_sha256,
            actor=self.actor,
            idempotency_key=self.idempotency_key,
        )
        if self.request_hash != expected_request_hash:
            raise ProposalIdempotencyConflict(
                "publication request_hash does not match the normalized proposal command"
            )
