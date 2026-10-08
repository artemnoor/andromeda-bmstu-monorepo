"""Framework-independent repository ports implemented by infrastructure."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol
from uuid import UUID

if TYPE_CHECKING:
    from andromeda_ontology.proposals import (
        Proposal,
        ProposalEvent,
        ProposalEvidenceReference,
        ProposalRevision,
        ProposalStatus,
    )


@dataclass(frozen=True, slots=True)
class PageRows:
    """One ordered page of internal repository rows."""

    items: list[dict[str, Any]]
    next_cursor: str | None
    total_count: int


class InvalidCursorError(ValueError):
    """A page cursor is not a valid encoded external key."""


class AcademicDataReadRepository(Protocol):
    """Stable-key reads scoped to the active academic data release."""

    @property
    def active_release_key(self) -> str: ...

    @property
    def active_release_id(self) -> UUID: ...

    def active_release(self) -> dict[str, Any]: ...

    def get(self, table_name: str, external_key: str) -> dict[str, Any] | None: ...

    def get_by_id(self, table_name: str, record_id: UUID) -> dict[str, Any] | None: ...

    def page(
        self,
        table_name: str,
        *,
        filters: dict[str, Any] | None = None,
        limit: int = 50,
        cursor: str | None = None,
    ) -> PageRows: ...

    def related(
        self,
        table_name: str,
        foreign_key: str,
        parent_id: UUID,
        *,
        filters: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]: ...

    def evidence_for(self, entity_table: str, entity_id: UUID) -> list[dict[str, Any]]: ...

    def manual_reviews_for(self, external_key: str) -> list[dict[str, Any]]: ...

    def subject_classifications_for(
        self,
        subject_type: str,
        subject_ids: list[UUID],
        taxonomy_key: str,
        taxonomy_version: str,
    ) -> dict[UUID, dict[str, Any]]: ...

    def subject_taxonomy(
        self, taxonomy_key: str, taxonomy_version: str
    ) -> dict[str, Any] | None: ...


class ProposalRepository(Protocol):
    """Persistence port with atomic version checks and append-only transition events."""

    def create(
        self,
        proposal: Proposal,
        revision: ProposalRevision,
        evidence: tuple[ProposalEvidenceReference, ...],
        event: ProposalEvent,
    ) -> Proposal: ...

    def get(self, proposal_id: UUID) -> Proposal | None: ...

    def events_for(self, proposal_id: UUID) -> tuple[ProposalEvent, ...]: ...

    def replay(
        self, proposal_id: UUID, *, idempotency_key: str, request_hash: str
    ) -> Proposal | None: ...

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
    ) -> Proposal: ...

    def rebase(
        self,
        proposal: Proposal,
        revision: ProposalRevision,
        evidence: tuple[ProposalEvidenceReference, ...],
        event: ProposalEvent,
        *,
        expected_version: int,
    ) -> Proposal: ...


class ProposalAuthorization(Protocol):
    """Authorization policy injected by a trusted internal composition root."""

    def is_authorized(
        self, actor: str, action: str, proposal: Proposal | None
    ) -> bool: ...


__all__ = [
    "AcademicDataReadRepository",
    "InvalidCursorError",
    "PageRows",
    "ProposalAuthorization",
    "ProposalRepository",
]
