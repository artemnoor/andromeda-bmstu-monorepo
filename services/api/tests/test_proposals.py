from __future__ import annotations

from uuid import UUID

import pytest

from andromeda_api.application.proposals import (
    InvalidProposalTransitionError,
    Proposal,
    ProposalApplicationService,
    StaleProposalError,
)


class _ProposalRepository:
    def __init__(self) -> None:
        self.records: dict[UUID, Proposal] = {}

    def create(self, proposal: Proposal) -> Proposal:
        self.records[proposal.proposal_id] = proposal
        return proposal

    def get(self, proposal_id: UUID) -> Proposal | None:
        return self.records.get(proposal_id)

    def compare_and_swap(self, proposal: Proposal, *, expected_version: int) -> Proposal:
        current = self.records[proposal.proposal_id]
        if current.version != expected_version:
            raise StaleProposalError("repository version changed")
        self.records[proposal.proposal_id] = proposal
        return proposal


def test_proposal_lifecycle_uses_expected_version_for_each_transition() -> None:
    service = ProposalApplicationService(_ProposalRepository())
    created = service.create_proposal({"external_key": "program:bmstu:01.03.02"})
    validated = service.validate_proposal(created.proposal_id, expected_version=1)
    approved = service.approve_proposal(created.proposal_id, expected_version=2)
    published = service.publish_proposal(created.proposal_id, expected_version=3)

    assert [created.status, validated.status, approved.status, published.status] == [
        "draft", "validated", "approved", "published"
    ]
    assert [created.version, validated.version, approved.version, published.version] == [1, 2, 3, 4]


def test_stale_and_duplicate_proposal_transitions_fail_deterministically() -> None:
    service = ProposalApplicationService(_ProposalRepository())
    created = service.create_proposal({"external_key": "program:bmstu:01.03.02"})
    validated = service.validate_proposal(created.proposal_id, expected_version=1)

    with pytest.raises(StaleProposalError):
        service.approve_proposal(created.proposal_id, expected_version=1)
    with pytest.raises(InvalidProposalTransitionError):
        service.validate_proposal(created.proposal_id, expected_version=validated.version)


def test_validation_errors_block_approval_and_rejection_requires_a_reason() -> None:
    repository = _ProposalRepository()
    service = ProposalApplicationService(repository, validator=lambda payload: ("bad identity",))
    created = service.create_proposal({"external_key": "bad"})
    invalid = service.validate_proposal(created.proposal_id, expected_version=1)

    assert invalid.status == "draft"
    assert invalid.validation_errors == ("bad identity",)
    with pytest.raises(InvalidProposalTransitionError):
        service.approve_proposal(created.proposal_id, expected_version=2)
    with pytest.raises(ValueError, match="reason"):
        service.reject_proposal(created.proposal_id, expected_version=2, reason=" ")
    rejected = service.reject_proposal(
        created.proposal_id, expected_version=2, reason="source evidence is incomplete"
    )
    assert rejected.status == "rejected"
    assert rejected.rejection_reason == "source evidence is incomplete"