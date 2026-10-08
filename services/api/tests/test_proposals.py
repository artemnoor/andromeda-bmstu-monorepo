from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
from hashlib import sha256
from uuid import UUID

import pytest
from andromeda_api.application.proposals import (
    AllowProposalAuthorization,
    ProposalApplicationService,
    ProposalValidationError,
    TrustedInternalCLIProposalAuthorization,
)
from andromeda_ontology.proposals import (
    InvalidProposalTransitionError,
    MissingProposalEvidenceError,
    Proposal,
    ProposalEvent,
    ProposalEventType,
    ProposalEvidenceReference,
    ProposalIdempotencyConflict,
    ProposalRevision,
    ProposalStatus,
    StaleProposalError,
)


class _ProposalRepository:
    """Small CAS fake for application-service tests; PostgreSQL behavior is integration-tested."""

    def __init__(self) -> None:
        self.records: dict[UUID, Proposal] = {}
        self.events: dict[tuple[UUID, str], ProposalEvent] = {}
        self.revisions: dict[UUID, list[ProposalRevision]] = {}

    def create(
        self,
        proposal: Proposal,
        revision: ProposalRevision,
        evidence: tuple[ProposalEvidenceReference, ...],
        event: ProposalEvent,
    ) -> Proposal:
        self.records[proposal.proposal_id] = proposal
        self.events[(proposal.proposal_id, event.idempotency_key)] = event
        self.revisions[proposal.proposal_id] = [revision]
        return proposal

    def get(self, proposal_id: UUID) -> Proposal | None:
        return self.records.get(proposal_id)

    def events_for(self, proposal_id: UUID) -> tuple[ProposalEvent, ...]:
        return tuple(
            event for (record_id, _key), event in self.events.items() if record_id == proposal_id
        )

    def replay(self, proposal_id: UUID, *, idempotency_key: str, request_hash: str) -> Proposal | None:
        event = self.events.get((proposal_id, idempotency_key))
        if event is None:
            return None
        if event.request_hash != request_hash:
            raise ProposalIdempotencyConflict("key reused with another request")
        current = self.records[proposal_id]
        return replace(
            current,
            version=event.aggregate_version,
            current_revision=event.current_revision,
            status=event.next_status,
            updated_at=event.occurred_at,
            rejection_reason=event.reason if event.next_status is ProposalStatus.REJECTED else None,
            published_release_id=event.resulting_release_id,
            review_event_id=(
                event.review_event_id
                if event.next_status in {ProposalStatus.APPROVED, ProposalStatus.PUBLISHED}
                else None
            ),
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
        replay = self.replay(
            proposal_id, idempotency_key=idempotency_key, request_hash=request_hash
        )
        if replay is not None:
            return replay
        current = self.records[proposal_id]
        if current.version != expected_version or current.status is not expected_status:
            raise StaleProposalError("proposal compare-and-swap failed")
        now = datetime.now(UTC)
        updated = replace(
            current,
            version=expected_version + 1,
            status=next_status,
            updated_at=now,
            rejection_reason=reason if next_status is ProposalStatus.REJECTED else None,
            review_event_id=review_event_id if next_status is ProposalStatus.APPROVED else None,
        )
        self.records[proposal_id] = updated
        self.events[(proposal_id, idempotency_key)] = ProposalEvent(
            event_id=UUID(int=len(self.events) + 1),
            proposal_id=proposal_id,
            aggregate_version=updated.version,
            current_revision=updated.current_revision,
            previous_status=current.status,
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
        return updated

    def rebase(
        self,
        proposal: Proposal,
        revision: ProposalRevision,
        evidence: tuple[ProposalEvidenceReference, ...],
        event: ProposalEvent,
        *,
        expected_version: int,
    ) -> Proposal:
        current = self.records[proposal.proposal_id]
        if current.version != expected_version or current.status is not ProposalStatus.CONFLICTING:
            raise StaleProposalError("proposal compare-and-swap failed")
        self.records[proposal.proposal_id] = proposal
        self.revisions[proposal.proposal_id].append(revision)
        self.events[(proposal.proposal_id, event.idempotency_key)] = event
        return proposal


def _service(
    repository: _ProposalRepository | None = None,
    *,
    validator=None,
) -> tuple[ProposalApplicationService, _ProposalRepository]:
    storage = repository or _ProposalRepository()
    return (
        ProposalApplicationService(
            storage,
            authorization=AllowProposalAuthorization(),
            validator=validator,
        ),
        storage,
    )


def _evidence() -> tuple[ProposalEvidenceReference, ...]:
    return (
        ProposalEvidenceReference(
            source_document_sha256=sha256(b"official source").hexdigest(),
            source_artifact_key="source_artifact:sha256:official",
            locator="page 3, table 2",
            source_url="https://example.test/source.pdf",
            captured_at=datetime(2026, 10, 8, tzinfo=UTC),
        ),
    )


def _create(service: ProposalApplicationService, *, key: str = "create:one") -> Proposal:
    return service.create_proposal(
        change_type="upsert",
        target_dataset="educational_programs.jsonl",
        target_key="program:bmstu:01.03.02",
        source_candidate_key="bmstu_fact_candidate:abc",
        payload={"external_key": "program:bmstu:01.03.02", "name": "Software Engineering"},
        author="ingestion-operator",
        expected_active_release_id=None,
        expected_active_release_sha256=None,
        evidence=_evidence(),
        idempotency_key=key,
    )


def test_proposal_review_lifecycle_keeps_publish_inside_canonical_release_transaction() -> None:
    service, repository = _service()
    created = _create(service)
    validated = service.validate_proposal(
        created.proposal_id,
        expected_version=1,
        actor="ingestion-operator",
        idempotency_key="validate:one",
    )
    review_event_id = sha256(b"review event").hexdigest()
    approved = service.approve_proposal(
        created.proposal_id,
        expected_version=2,
        reviewer="reviewer",
        reason="Matches the exact source row.",
        review_event_id=review_event_id,
        idempotency_key="approve:one",
    )
    command = service.publication_command(
        created.proposal_id,
        expected_version=3,
        actor="publisher",
        idempotency_key="publish:one:proposal",
    )

    assert [created.status, validated.status, approved.status] == [
        ProposalStatus.DRAFT,
        ProposalStatus.VALIDATED,
        ProposalStatus.APPROVED,
    ]
    assert command.proposal_id == created.proposal_id
    assert command.expected_version == 3
    assert command.source_candidate_key == "bmstu_fact_candidate:abc"
    assert command.review_event_id == review_event_id
    assert command.target_key == "program:bmstu:01.03.02"
    assert command.payload_sha256 == approved.revision.payload_sha256
    assert repository.get(created.proposal_id).status is ProposalStatus.APPROVED
    assert repository.events[(created.proposal_id, "approve:one")].review_event_id == review_event_id
    with pytest.raises(ProposalIdempotencyConflict, match="does not match"):
        replace(command, request_hash=sha256(b"bundle-wide request hash").hexdigest())


def test_exact_command_retry_returns_original_outcome_and_key_reuse_conflicts() -> None:
    service, repository = _service()
    created = _create(service)
    first = service.validate_proposal(
        created.proposal_id,
        expected_version=1,
        actor="reviewer",
        idempotency_key="validate:one",
    )
    replay = service.validate_proposal(
        created.proposal_id,
        expected_version=1,
        actor="reviewer",
        idempotency_key="validate:one",
    )

    assert replay.version == first.version == 2
    assert len(repository.events) == 2
    with pytest.raises(ProposalIdempotencyConflict):
        service._transition(  # exercise durable command-key mismatch at the repository boundary
            created.proposal_id,
            expected_version=1,
            actor="reviewer",
            target=ProposalStatus.VALIDATED,
            event_type=ProposalEventType.VALIDATED,
            reason="different request",
            idempotency_key="validate:one",
            request_hash=None,
        )


def test_concurrent_exact_retry_replays_after_preflight_version_race(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, repository = _service()
    created = _create(service)
    first = service.validate_proposal(
        created.proposal_id,
        expected_version=1,
        actor="reviewer",
        idempotency_key="validate:race",
    )
    original_replay = repository.replay
    calls = 0

    def miss_first_lookup(proposal_id, *, idempotency_key, request_hash):
        nonlocal calls
        calls += 1
        if calls == 1:
            return None
        return original_replay(
            proposal_id,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
        )

    monkeypatch.setattr(repository, "replay", miss_first_lookup)
    retry = service.validate_proposal(
        created.proposal_id,
        expected_version=1,
        actor="reviewer",
        idempotency_key="validate:race",
    )

    assert retry == first
    assert calls == 2


def test_stale_and_invalid_proposal_transitions_are_deterministic() -> None:
    service, _repository = _service()
    created = _create(service)
    validated = service.validate_proposal(
        created.proposal_id,
        expected_version=1,
        actor="reviewer",
        idempotency_key="validate:one",
    )
    with pytest.raises(StaleProposalError):
        service.approve_proposal(
            created.proposal_id,
            expected_version=1,
            reviewer="reviewer",
            reason="outdated",
            review_event_id=sha256(b"event").hexdigest(),
            idempotency_key="approve:stale",
        )
    with pytest.raises(InvalidProposalTransitionError):
        service.validate_proposal(
            created.proposal_id,
            expected_version=validated.version,
            actor="reviewer",
            idempotency_key="validate:twice",
        )


def test_missing_evidence_and_payload_validation_fail_without_mutating_state() -> None:
    service, repository = _service(validator=lambda _payload: ("invalid target",))
    created = _create(service)
    with pytest.raises(ProposalValidationError):
        service.validate_proposal(
            created.proposal_id,
            expected_version=1,
            actor="reviewer",
            idempotency_key="validate:invalid",
        )
    assert repository.get(created.proposal_id).status is ProposalStatus.DRAFT

    no_evidence = service.create_proposal(
        change_type="upsert",
        target_dataset="educational_programs.jsonl",
        target_key="program:bmstu:other",
        source_candidate_key="bmstu_fact_candidate:def",
        payload={"external_key": "program:bmstu:other"},
        author="operator",
        expected_active_release_id=None,
        expected_active_release_sha256=None,
        evidence=(),
        idempotency_key="create:no-evidence",
    )
    with pytest.raises(MissingProposalEvidenceError):
        service.validate_proposal(
            no_evidence.proposal_id,
            expected_version=1,
            actor="reviewer",
            idempotency_key="validate:no-evidence",
        )
    assert repository.get(no_evidence.proposal_id).status is ProposalStatus.DRAFT


def test_default_authorization_denies_review_writes() -> None:
    repository = _ProposalRepository()
    service = ProposalApplicationService(repository)
    with pytest.raises(Exception, match="not authorized"):
        _create(service)


def test_trusted_cli_policy_binds_actor_to_local_os_user(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "andromeda_api.application.proposals.getuser",
        lambda: "local-operator",
    )
    policy = TrustedInternalCLIProposalAuthorization()

    assert policy.is_authorized("local-operator", "approved", None)
    assert not policy.is_authorized("spoofed-operator", "approved", None)
    assert not policy.is_authorized("local-operator", "publish-via-http", None)


def test_rejection_retry_preserves_review_event_only_in_immutable_audit() -> None:
    service, repository = _service()
    created = _create(service)
    review_event_id = sha256(b"rejection review event").hexdigest()
    rejected = service.reject_proposal(
        created.proposal_id,
        expected_version=1,
        reviewer="reviewer",
        reason="Source row conflicts with the submitted fact.",
        review_event_id=review_event_id,
        idempotency_key="reject:one",
    )
    replay = service.reject_proposal(
        created.proposal_id,
        expected_version=1,
        reviewer="reviewer",
        reason="Source row conflicts with the submitted fact.",
        review_event_id=review_event_id,
        idempotency_key="reject:one",
    )

    assert rejected.status is replay.status is ProposalStatus.REJECTED
    assert replay.review_event_id is None
    assert repository.events[(created.proposal_id, "reject:one")].review_event_id == review_event_id
