"""Internal proposal lifecycle use cases with optimistic version checks."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, replace
from typing import Any, Literal, Protocol
from uuid import UUID, uuid4


ProposalStatus = Literal["draft", "validated", "approved", "rejected", "published"]


@dataclass(frozen=True, slots=True)
class Proposal:
    proposal_id: UUID
    version: int
    status: ProposalStatus
    payload: Mapping[str, Any]
    validation_errors: tuple[str, ...] = ()
    rejection_reason: str | None = None


class ProposalRepository(Protocol):
    """Storage port; implementations must compare versions atomically."""

    def create(self, proposal: Proposal) -> Proposal: ...

    def get(self, proposal_id: UUID) -> Proposal | None: ...

    def compare_and_swap(self, proposal: Proposal, *, expected_version: int) -> Proposal: ...


class ProposalUseCaseError(RuntimeError):
    """Base error for deterministic proposal lifecycle failures."""


class ProposalNotFoundError(ProposalUseCaseError):
    pass


class StaleProposalError(ProposalUseCaseError):
    pass


class InvalidProposalTransitionError(ProposalUseCaseError):
    pass


class ProposalApplicationService:
    """Review state transitions that are ready for later persistence and authorization."""

    def __init__(
        self,
        repository: ProposalRepository,
        validator: Callable[[Mapping[str, Any]], tuple[str, ...]] | None = None,
    ) -> None:
        self.repository = repository
        self.validator = validator or (lambda payload: ())

    def create_proposal(self, payload: Mapping[str, Any]) -> Proposal:
        if not isinstance(payload, Mapping):
            raise TypeError("proposal payload must be a mapping")
        return self.repository.create(
            Proposal(
                proposal_id=uuid4(),
                version=1,
                status="draft",
                payload=dict(payload),
            )
        )

    def validate_proposal(self, proposal_id: UUID, *, expected_version: int) -> Proposal:
        current = self._current(proposal_id, expected_version)
        self._require_status(current, {"draft"})
        errors = tuple(self.validator(current.payload))
        updated = replace(
            current,
            version=current.version + 1,
            status="validated" if not errors else "draft",
            validation_errors=errors,
        )
        return self.repository.compare_and_swap(updated, expected_version=expected_version)

    def approve_proposal(self, proposal_id: UUID, *, expected_version: int) -> Proposal:
        current = self._current(proposal_id, expected_version)
        self._require_status(current, {"validated"})
        if current.validation_errors:
            raise InvalidProposalTransitionError("a proposal with validation errors cannot be approved")
        return self.repository.compare_and_swap(
            replace(current, version=current.version + 1, status="approved"),
            expected_version=expected_version,
        )

    def reject_proposal(
        self, proposal_id: UUID, *, expected_version: int, reason: str
    ) -> Proposal:
        normalized_reason = reason.strip()
        if not normalized_reason:
            raise ValueError("proposal rejection reason must not be empty")
        current = self._current(proposal_id, expected_version)
        self._require_status(current, {"draft", "validated"})
        return self.repository.compare_and_swap(
            replace(
                current,
                version=current.version + 1,
                status="rejected",
                rejection_reason=normalized_reason,
            ),
            expected_version=expected_version,
        )

    def publish_proposal(self, proposal_id: UUID, *, expected_version: int) -> Proposal:
        current = self._current(proposal_id, expected_version)
        self._require_status(current, {"approved"})
        return self.repository.compare_and_swap(
            replace(current, version=current.version + 1, status="published"),
            expected_version=expected_version,
        )

    def _current(self, proposal_id: UUID, expected_version: int) -> Proposal:
        current = self.repository.get(proposal_id)
        if current is None:
            raise ProposalNotFoundError(f"proposal {proposal_id} does not exist")
        if current.version != expected_version:
            raise StaleProposalError(
                f"proposal version changed: expected {expected_version}, found {current.version}"
            )
        return current

    @staticmethod
    def _require_status(proposal: Proposal, allowed: set[str]) -> None:
        if proposal.status not in allowed:
            allowed_text = ", ".join(sorted(allowed))
            raise InvalidProposalTransitionError(
                f"proposal in status {proposal.status!r} cannot transition; expected {allowed_text}"
            )