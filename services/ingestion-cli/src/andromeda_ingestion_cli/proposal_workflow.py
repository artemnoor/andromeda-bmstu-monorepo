"""Compose parser review records with the durable proposal application service."""

from __future__ import annotations

import csv
import hashlib
import json
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import NAMESPACE_URL, UUID, uuid5

from andromeda_parser.bundle import CANDIDATE_FILE, CANDIDATE_MANIFEST
from andromeda_release_bundles import BundleReader


def _json_object(raw: bytes, *, label: str) -> dict[str, Any]:
    try:
        value = json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"{label} is not valid JSON") from error
    if not isinstance(value, dict):
        raise TypeError(f"{label} must contain a JSON object")
    return value


def _jsonl_objects(raw: bytes, *, label: str) -> list[dict[str, Any]]:
    try:
        values = [json.loads(line) for line in raw.decode("utf-8-sig").splitlines() if line.strip()]
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"{label} is not valid JSON Lines") from error
    if not all(isinstance(value, dict) for value in values):
        raise ValueError(f"{label} contains a non-object record")
    return values


def _bundle_json(bundle_path: Path, relative_path: str) -> dict[str, Any]:
    with BundleReader(bundle_path) as reader:
        return _json_object(reader.read_bytes(relative_path), label=relative_path)


def _bundle_jsonl(bundle_path: Path, relative_path: str) -> list[dict[str, Any]]:
    with BundleReader(bundle_path) as reader:
        return _jsonl_objects(reader.read_bytes(relative_path), label=relative_path)


def _candidate_rows(bundle_path: Path) -> list[dict[str, Any]]:
    return _bundle_jsonl(bundle_path, CANDIDATE_FILE)


def _proposal_reference(proposal: Any) -> dict[str, Any]:
    revision = proposal.revision
    if revision is None or revision.source_candidate_key is None:
        raise ValueError("ingestion proposal has no candidate-linked revision")
    return {
        "proposal_id": str(proposal.proposal_id),
        "expected_version": proposal.version,
        "status": proposal.status.value,
        "source_candidate_key": revision.source_candidate_key,
        "target_dataset": revision.target_dataset,
        "target_key": revision.target_key,
        "payload_sha256": revision.payload_sha256,
        "expected_base_release_id": (
            str(revision.expected_release_id) if revision.expected_release_id else None
        ),
        "expected_base_source_bundle_sha256": revision.expected_release_sha256,
        "review_event_id": proposal.review_event_id,
        "evidence": [
            {
                "source_document_sha256": item.source_document_sha256,
                "source_artifact_key": item.source_artifact_key,
                "locator": item.locator,
                "source_url": item.source_url,
                "captured_at": item.captured_at.isoformat() if item.captured_at else None,
            }
            for item in proposal.evidence
        ],
    }


def _candidate_payload(candidate: dict[str, Any]) -> dict[str, Any]:
    try:
        payload = json.loads(candidate["payload_json"])
    except (KeyError, json.JSONDecodeError) as error:
        raise ValueError("candidate payload is malformed") from error
    if not isinstance(payload, dict):
        raise TypeError("candidate payload must be an object")
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    actual_hash = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
    if candidate.get("payload_sha256") != actual_hash:
        raise ValueError("candidate payload changed after staging")
    return payload


def _source_evidence(candidate: dict[str, Any], payload: dict[str, Any], artifacts: dict[str, dict[str, Any]]) -> Any:
    from andromeda_ontology.proposals import ProposalEvidenceReference

    artifact_key = payload.get("source_artifact_key") or candidate.get("source_artifact_key")
    if not isinstance(artifact_key, str) or artifact_key not in artifacts:
        raise ValueError("candidate does not reference an exact staged source artifact")
    artifact = artifacts[artifact_key]
    document_hash = payload.get("source_sha256") or artifact.get("sha256")
    if document_hash != artifact.get("sha256"):
        raise ValueError("candidate source hash does not match the staged artifact manifest")
    locator_value = payload.get("source_locator")
    if locator_value is None:
        locator_value = candidate.get("source_identity") or candidate.get("external_key")
    locator = (
        locator_value
        if isinstance(locator_value, str)
        else json.dumps(locator_value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    )
    source_url = payload.get("source_url") or artifact.get("requested_url")
    captured_value = payload.get("source_retrieved_at") or artifact.get("captured_at")
    captured_at = None
    if isinstance(captured_value, str) and captured_value:
        try:
            captured_at = datetime.fromisoformat(captured_value.replace("Z", "+00:00"))
        except ValueError:
            captured_at = None
    return ProposalEvidenceReference(
        source_document_sha256=str(document_hash),
        source_artifact_key=artifact_key,
        locator=locator,
        source_url=source_url if isinstance(source_url, str) else None,
        captured_at=captured_at,
    )


def _artifact_index(bundle_path: Path) -> dict[str, dict[str, Any]]:
    rows = _bundle_jsonl(bundle_path, "source_artifacts.jsonl")
    return {
        str(row["source_key"]): row
        for row in rows
        if isinstance(row.get("source_key"), str)
    }


def _service_context() -> Any:
    from andromeda_api.application.proposals import (
        TrustedInternalCLIProposalAuthorization,
        proposal_service_context,
    )

    return proposal_service_context(
        authorization=TrustedInternalCLIProposalAuthorization(),
    )


def register_candidate_bundle(bundle_path: Path, *, actor: str) -> list[dict[str, Any]]:
    """Create and validate deterministic proposals for exact typed candidates."""

    manifest = _bundle_json(bundle_path, CANDIDATE_MANIFEST)
    base_id_value = manifest.get("base_release_id")
    base_digest = manifest.get("base_source_bundle_sha256")
    if base_id_value is None and base_digest is None:
        # The guarded first-release bootstrap has no active-release base to bind.
        return []
    if not isinstance(base_id_value, str) or not isinstance(base_digest, str):
        raise TypeError("candidate bundle has an incomplete expected active-release identity")
    base_id = UUID(base_id_value)
    artifacts = _artifact_index(bundle_path)
    rows = _candidate_rows(bundle_path)
    references: list[dict[str, Any]] = []
    from andromeda_ontology.proposals import ProposalStatus

    with _service_context() as service:
        for candidate in rows:
            if candidate.get("candidate_type") != "typed_record":
                continue
            candidate_key = candidate.get("external_key")
            target_dataset = candidate.get("target_dataset")
            target_key = candidate.get("suggested_target")
            if not all(isinstance(value, str) and value for value in (candidate_key, target_dataset, target_key)):
                raise ValueError("typed candidate has an incomplete exact identity")
            payload = _candidate_payload(candidate)
            evidence = _source_evidence(candidate, payload, artifacts)
            create_key = f"ingestion-stage-create:{candidate_key}"
            proposal = service.create_proposal(
                change_type=("RETIRE" if payload.get("retire_existing_record") is True else "UPSERT"),
                target_dataset=target_dataset,
                target_key=target_key,
                source_candidate_key=candidate_key,
                payload=payload,
                author=actor,
                expected_active_release_id=base_id,
                expected_active_release_sha256=base_digest,
                evidence=(evidence,),
                idempotency_key=create_key,
                proposal_id=uuid5(NAMESPACE_URL, f"andromeda-proposal:{create_key}"),
            )
            if proposal.status is ProposalStatus.DRAFT:
                proposal = service.validate_proposal(
                    proposal.proposal_id,
                    expected_version=proposal.version,
                    actor=actor,
                    idempotency_key=f"ingestion-stage-validate:{candidate_key}",
                )
            references.append(_proposal_reference(proposal))
    return references


def _submitted_decisions(decisions_path: Path, *, actor: str) -> list[dict[str, str]]:
    with decisions_path.open("r", encoding="utf-8-sig", newline="") as stream:
        rows = list(csv.DictReader(stream))
    decisions: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in rows:
        candidate_key = (row.get("external_key") or "").strip()
        decision = (row.get("decision") or "").strip()
        if not decision:
            continue
        if not candidate_key or candidate_key in seen:
            raise ValueError("review CSV contains a missing or duplicate candidate key")
        seen.add(candidate_key)
        reviewed_at_raw = (row.get("reviewed_at") or "").strip()
        if decision:
            try:
                reviewed_at = datetime.fromisoformat(reviewed_at_raw.replace("Z", "+00:00"))
            except ValueError as error:
                raise ValueError("reviewed_at must be an ISO timestamp") from error
            if reviewed_at.tzinfo is None:
                raise ValueError("reviewed_at must include a timezone")
            reviewed_at_raw = reviewed_at.isoformat()
        decisions.append(
            {
                "candidate_key": candidate_key,
                "decision": decision,
                "reviewed_at": reviewed_at_raw,
                "reviewed_by": (row.get("reviewed_by") or actor).strip(),
                "target_external_key": (row.get("target_external_key") or "").strip() or None,
            }
        )
    return decisions


def _review_events(
    candidate_path: Path,
    decisions_path: Path,
    reviewed_path: Path,
    *,
    actor: str,
) -> dict[str, dict[str, Any]]:
    candidates = {row.get("external_key"): row for row in _candidate_rows(candidate_path)}
    decisions = _submitted_decisions(decisions_path, actor=actor)
    history = _bundle_jsonl(reviewed_path, "review_decisions.jsonl")
    events: dict[str, dict[str, Any]] = {}
    for decision in decisions:
        candidate_key = decision["candidate_key"]
        candidate = candidates.get(candidate_key)
        if candidate is None:
            raise ValueError("review CSV references a candidate absent from the staged bundle")
        candidate_hash = candidate.get("payload_sha256")
        matches = [
            event
            for event in history
            if event.get("candidate_key") == candidate_key
            and event.get("decision") == decision["decision"]
            and event.get("reviewed_at") == decision["reviewed_at"]
            and event.get("reviewed_by") == decision["reviewed_by"]
            and event.get("target_external_key") == decision["target_external_key"]
            and event.get("candidate_payload_sha256") == candidate_hash
        ]
        if len(matches) != 1:
            raise ValueError("reviewed bundle does not contain one exact event for each submitted decision")
        events[candidate_key] = matches[0]
    return events


def _proposal_for(service: Any, reference: dict[str, Any]) -> Any:
    proposal = service.repository.get(UUID(str(reference["proposal_id"])))
    if proposal is None:
        raise ValueError("proposal reference does not exist in durable storage")
    return proposal


def _validate_if_draft(service: Any, proposal: Any, *, actor: str, suffix: str) -> Any:
    from andromeda_ontology.proposals import ProposalStatus

    if proposal.status is ProposalStatus.DRAFT:
        return service.validate_proposal(
            proposal.proposal_id,
            expected_version=proposal.version,
            actor=actor,
            idempotency_key=f"ingestion-validate:{proposal.proposal_id}:{suffix}",
        )
    return proposal


def _create_for_review(
    service: Any,
    *,
    candidate: dict[str, Any],
    payload: dict[str, Any],
    evidence: Any,
    target_key: str,
    base_id: UUID,
    base_digest: str,
    event_id: str,
    actor: str,
) -> Any:
    candidate_key = str(candidate["external_key"])
    create_key = f"ingestion-review-create:{candidate_key}:{event_id}:{target_key}"
    return service.create_proposal(
        change_type=("RETIRE" if payload.get("retire_existing_record") is True else "UPSERT"),
        target_dataset=str(candidate["target_dataset"]),
        target_key=target_key,
        source_candidate_key=candidate_key,
        payload=payload,
        author=actor,
        expected_active_release_id=base_id,
        expected_active_release_sha256=base_digest,
        evidence=(evidence,),
        idempotency_key=create_key,
        proposal_id=uuid5(NAMESPACE_URL, f"andromeda-proposal:{create_key}"),
    )


def _decide_proposal(
    service: Any,
    proposal: Any,
    *,
    candidate: dict[str, Any],
    payload: dict[str, Any],
    evidence: Any,
    event: dict[str, Any],
    base_id: UUID,
    base_digest: str,
) -> Any:
    from andromeda_ontology.proposals import ProposalStatus

    event_id = str(event["event_id"])
    actor = str(event["reviewed_by"])
    decision = event["decision"]
    if decision == "reject":
        target_key = (
            proposal.revision.target_key
            if proposal.revision is not None
            else candidate.get("suggested_target")
        )
        if proposal.status is ProposalStatus.APPROVED:
            proposal = service.mark_conflicting(
                proposal.proposal_id,
                expected_version=proposal.version,
                actor=actor,
                reason="a newer exact-key review decision superseded this approval",
                idempotency_key=f"ingestion-review-conflict:{proposal.proposal_id}:{event_id}",
            )
        if proposal.status in {
            ProposalStatus.APPROVED,
            ProposalStatus.CONFLICTING,
            ProposalStatus.REJECTED,
        }:
            if not isinstance(target_key, str) or not target_key:
                raise ValueError("rejected typed candidate has no stable target identity")
            proposal = _create_for_review(
                service,
                candidate=candidate,
                payload=payload,
                evidence=evidence,
                target_key=target_key,
                base_id=base_id,
                base_digest=base_digest,
                event_id=event_id,
                actor=actor,
            )
            proposal = _validate_if_draft(
                service,
                proposal,
                actor=actor,
                suffix=f"{event_id}:{proposal.current_revision}",
            )
        return service.reject_proposal(
            proposal.proposal_id,
            expected_version=proposal.version,
            reviewer=actor,
            reason="Rejected by the exact-key BMSTU review event",
            idempotency_key=f"ingestion-review-reject:{proposal.proposal_id}:{event_id}",
            review_event_id=event_id,
        )

    if decision != "accept_typed_fact":
        return proposal
    target_key = event.get("target_external_key")
    target_dataset = event.get("target_dataset")
    if not isinstance(target_key, str) or not target_key or target_dataset != candidate.get("target_dataset"):
        raise ValueError("approved review event does not contain the candidate's exact typed target")
    if proposal.status is ProposalStatus.PUBLISHED:
        if proposal.review_event_id == event_id:
            return proposal
        raise ValueError("a published proposal cannot be changed by a later review decision")
    if proposal.status is ProposalStatus.REJECTED:
        proposal = _create_for_review(
            service,
            candidate=candidate,
            payload=payload,
            evidence=evidence,
            target_key=target_key,
            base_id=base_id,
            base_digest=base_digest,
            event_id=event_id,
            actor=actor,
        )
    elif proposal.status is ProposalStatus.APPROVED and proposal.review_event_id == event_id:
        return proposal
    elif (
        proposal.status is ProposalStatus.CONFLICTING
        or proposal.status in {ProposalStatus.DRAFT, ProposalStatus.VALIDATED, ProposalStatus.NEEDS_REVIEW}
        or proposal.status is ProposalStatus.APPROVED
    ):
        if (
            proposal.status is not ProposalStatus.CONFLICTING
            and (
                proposal.revision is None
                or proposal.revision.target_key != target_key
                or proposal.review_event_id != event_id
            )
        ):
            proposal = service.mark_conflicting(
                proposal.proposal_id,
                expected_version=proposal.version,
                actor=actor,
                reason="a new exact-key review decision requires a new proposal revision",
                idempotency_key=f"ingestion-review-conflict:{proposal.proposal_id}:{event_id}",
            )
        if proposal.status is ProposalStatus.CONFLICTING:
            proposal = service.rebase_conflicting_proposal(
                proposal.proposal_id,
                expected_version=proposal.version,
                actor=actor,
                change_type=("RETIRE" if payload.get("retire_existing_record") is True else "UPSERT"),
                target_dataset=str(candidate["target_dataset"]),
                target_key=target_key,
                source_candidate_key=str(candidate["external_key"]),
                payload=payload,
                expected_active_release_id=base_id,
                expected_active_release_sha256=base_digest,
                evidence=(evidence,),
                reason="Exact-key review selected the current proposal revision",
                idempotency_key=f"ingestion-review-rebase:{proposal.proposal_id}:{event_id}",
            )
    proposal = _validate_if_draft(
        service,
        proposal,
        actor=actor,
        suffix=f"{event_id}:{proposal.current_revision}",
    )
    if proposal.status in {ProposalStatus.VALIDATED, ProposalStatus.NEEDS_REVIEW}:
        proposal = service.approve_proposal(
            proposal.proposal_id,
            expected_version=proposal.version,
            reviewer=actor,
            reason="Accepted by the exact-key BMSTU review event",
            review_event_id=event_id,
            idempotency_key=f"ingestion-review-approve:{proposal.proposal_id}:{event_id}",
        )
    return proposal


def review_candidate_bundle(
    candidate_path: Path,
    decisions_path: Path,
    reviewed_path: Path,
    *,
    actor: str,
) -> list[dict[str, Any]]:
    """Persist exact-key review decisions and return their bundle-bound proposal references."""

    candidate_manifest = _bundle_json(candidate_path, CANDIDATE_MANIFEST)
    references = candidate_manifest.get("proposal_references", [])
    if not isinstance(references, list) or not all(isinstance(row, dict) for row in references):
        raise ValueError("candidate proposal references are malformed")
    reviewed_manifest = _bundle_json(reviewed_path, CANDIDATE_MANIFEST)
    base_id_value = reviewed_manifest.get("base_release_id")
    base_digest = reviewed_manifest.get("base_source_bundle_sha256")
    if not isinstance(base_id_value, str) or not isinstance(base_digest, str):
        raise TypeError("reviewed candidate has no active-release base for proposal decisions")
    base_id = UUID(base_id_value)
    rows = {row.get("external_key"): row for row in _candidate_rows(candidate_path)}
    artifacts = _artifact_index(candidate_path)
    events = _review_events(candidate_path, decisions_path, reviewed_path, actor=actor)
    proposal_ids = {str(reference["proposal_id"]) for reference in references}

    with _service_context() as service:
        for candidate_key, event in events.items():
            candidate = rows.get(candidate_key)
            if candidate is None or candidate.get("candidate_type") != "typed_record":
                continue
            matching_refs = [
                reference
                for reference in references
                if reference.get("source_candidate_key") == candidate_key
            ]
            if not matching_refs:
                raise ValueError("typed review decision has no durable staged proposal")
            payload = _candidate_payload(candidate)
            evidence = _source_evidence(candidate, payload, artifacts)
            current_proposals = [_proposal_for(service, reference) for reference in matching_refs]
            matching_event = next(
                (proposal for proposal in current_proposals if proposal.review_event_id == event.get("event_id")),
                None,
            )
            target_key = event.get("target_external_key")
            matching_target = next(
                (
                    proposal
                    for proposal in current_proposals
                    if proposal.revision is not None and proposal.revision.target_key == target_key
                    and proposal.status.value not in {"REJECTED", "PUBLISHED"}
                ),
                None,
            )
            proposal = matching_event or matching_target or max(
                current_proposals,
                key=lambda item: (item.version, str(item.proposal_id)),
            )
            updated = _decide_proposal(
                service,
                proposal,
                candidate=candidate,
                payload=payload,
                evidence=evidence,
                event=event,
                base_id=base_id,
                base_digest=base_digest,
            )
            proposal_ids.add(str(updated.proposal_id))

        result = []
        for proposal_id in sorted(proposal_ids):
            proposal = service.repository.get(UUID(proposal_id))
            if proposal is not None:
                result.append(_proposal_reference(proposal))
    return result


def apply_candidate_diff(bundle_path: Path, report: dict[str, Any], *, actor: str) -> None:
    """Persist exact-key diff classifications without moving parser logic into the API."""

    from andromeda_api.application.proposals import ProposalStatus

    manifest = _bundle_json(bundle_path, CANDIDATE_MANIFEST)
    references = manifest.get("proposal_references", [])
    if not isinstance(references, list) or not all(isinstance(row, dict) for row in references):
        raise ValueError("candidate bundle proposal references are malformed")
    reference_by_candidate: dict[str, list[dict[str, Any]]] = {}
    for reference in references:
        candidate_key = reference.get("source_candidate_key")
        if isinstance(candidate_key, str):
            reference_by_candidate.setdefault(candidate_key, []).append(reference)

    stable_report = json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    diff_digest = hashlib.sha256(stable_report.encode("utf-8")).hexdigest()
    records = report.get("records", [])
    if not isinstance(records, list):
        raise TypeError("candidate diff report records are malformed")

    with _service_context() as service:
        for record in records:
            candidate_key = record.get("candidate_key")
            if not isinstance(candidate_key, str):
                continue
            classification = record.get("classification")
            if classification in {"conflicting", "ambiguous"}:
                target_status = ProposalStatus.CONFLICTING
                reason = str(record.get("reason") or "candidate identity conflicts with the exact-key release")
            elif classification == "changed" and record.get("bulk_eligible") is True:
                # Safe grouped rows remain validated until the exact-key decision is recorded.
                continue
            elif classification in {"changed", "new"}:
                target_status = ProposalStatus.NEEDS_REVIEW
                reason = str(record.get("reason") or "candidate requires individual exact-key review")
            else:
                continue

            for reference in reference_by_candidate.get(candidate_key, []):
                proposal_id = UUID(str(reference["proposal_id"]))
                proposal = service.repository.get(proposal_id)
                if proposal is None:
                    raise ValueError("candidate proposal reference does not exist in durable storage")
                key = f"ingestion-diff:{diff_digest}:{proposal_id}"
                replayed = any(
                    event.idempotency_key == key for event in service.repository.events_for(proposal_id)
                )
                if replayed or proposal.status is target_status:
                    continue
                if proposal.status in {ProposalStatus.PUBLISHED, ProposalStatus.REJECTED}:
                    continue
                if (
                    target_status is ProposalStatus.NEEDS_REVIEW
                    and proposal.status is ProposalStatus.CONFLICTING
                ):
                    # A conflict requires an explicit rebase before review can resume.
                    continue
                if target_status is ProposalStatus.NEEDS_REVIEW and proposal.status is ProposalStatus.APPROVED:
                    # An approved proposal whose exact-key classification changed is stale.
                    target_status_for_transition = ProposalStatus.CONFLICTING
                else:
                    target_status_for_transition = target_status
                if target_status_for_transition is ProposalStatus.CONFLICTING:
                    service.mark_conflicting(
                        proposal_id,
                        expected_version=proposal.version,
                        actor=actor,
                        reason=reason,
                        idempotency_key=key,
                    )
                else:
                    service.mark_needs_review(
                        proposal_id,
                        expected_version=proposal.version,
                        actor=actor,
                        reason=reason,
                        idempotency_key=key,
                    )


def publication_commands(bundle_path: Path, *, actor: str) -> tuple[list[Any], str, UUID | None]:
    """Prepare approved commands from immutable refs; the release service performs final CAS."""

    from andromeda_api.application.proposals import ProposalStatus
    from andromeda_ontology.proposals import request_sha256

    manifest = _bundle_json(bundle_path, CANDIDATE_MANIFEST)
    references = manifest.get("proposal_references", [])
    if not isinstance(references, list) or not all(isinstance(row, dict) for row in references):
        raise ValueError("reviewed bundle proposal references are malformed")
    base_id_value = manifest.get("base_release_id")
    expected_base_id = UUID(base_id_value) if isinstance(base_id_value, str) else None
    base_digest = manifest.get("base_source_bundle_sha256")
    if (expected_base_id is None) != (base_digest is None):
        raise ValueError("reviewed bundle has an incomplete active-release base identity")
    bootstrap_without_active_base = expected_base_id is None
    accepted_keys_raw = manifest.get("accepted_typed_candidate_keys", [])
    event_ids_raw = manifest.get("accepted_typed_review_event_ids", [])
    if (
        not isinstance(accepted_keys_raw, list)
        or not all(isinstance(key, str) for key in accepted_keys_raw)
        or not isinstance(event_ids_raw, list)
        or not all(isinstance(event_id, str) for event_id in event_ids_raw)
        or len(accepted_keys_raw) != len(set(accepted_keys_raw))
        or len(event_ids_raw) != len(set(event_ids_raw))
    ):
        raise ValueError("reviewed bundle accepted candidate references are malformed")
    accepted_candidate_keys = set(accepted_keys_raw)
    history = _bundle_jsonl(bundle_path, "review_decisions.jsonl")
    events_by_id = {str(event.get("event_id")): event for event in history}
    approved_events = {event_id: events_by_id.get(event_id) for event_id in event_ids_raw}
    if any(
        event is None
        or event.get("decision") != "accept_typed_fact"
        or event.get("candidate_key") not in accepted_candidate_keys
        for event in approved_events.values()
    ):
        raise ValueError("reviewed bundle does not retain each exact accepted review event")
    if {event.get("candidate_key") for event in approved_events.values() if event is not None} != accepted_candidate_keys:
        raise ValueError("accepted candidate identities do not match their review events")
    approved_events = {key: event for key, event in approved_events.items() if event is not None}
    approved_references = [
        reference for reference in references if reference.get("status") == ProposalStatus.APPROVED.value
    ]
    for reference in approved_references:
        event = approved_events.get(str(reference.get("review_event_id")))
        if event is None or (
            event.get("candidate_key") != reference.get("source_candidate_key")
            or event.get("target_dataset") != reference.get("target_dataset")
            or event.get("target_external_key") != reference.get("target_key")
            or event.get("candidate_payload_sha256") != reference.get("payload_sha256")
        ):
            raise ValueError("approved proposal reference is not bound to an exact accepted review event")
    for candidate_key in accepted_candidate_keys:
        current_accepts = [event for event in approved_events.values() if event.get("candidate_key") == candidate_key]
        if current_accepts and not bootstrap_without_active_base and not any(
            reference.get("source_candidate_key") == candidate_key
            and reference.get("review_event_id") in {event.get("event_id") for event in current_accepts}
            for reference in approved_references
        ):
            raise ValueError("accepted typed candidate has no matching approved durable proposal")

    with BundleReader(bundle_path) as reader:
        publication_key = f"ingestion-commit:{reader.input_digest}"
    if not approved_references:
        return [], publication_key, expected_base_id
    prepared: list[Any] = []
    with _service_context() as service:
        for reference in sorted(approved_references, key=lambda row: str(row.get("proposal_id", ""))):
            proposal_id = UUID(str(reference["proposal_id"]))
            expected_version = int(reference["expected_version"])
            proposal_key = "proposal-publish:" + request_sha256(
                {"key": publication_key, "proposal_id": str(proposal_id)}
            )
            command = service.publication_command(
                proposal_id,
                expected_version=expected_version,
                actor=actor,
                idempotency_key=proposal_key,
            )
            if (
                command.expected_status is not ProposalStatus.APPROVED
                or command.expected_version != expected_version
                or command.source_candidate_key != reference.get("source_candidate_key")
                or command.review_event_id != reference.get("review_event_id")
                or command.target_dataset != reference.get("target_dataset")
                or command.target_key != reference.get("target_key")
                or command.payload_sha256 != reference.get("payload_sha256")
                or command.expected_base_release_id != expected_base_id
                or command.expected_base_source_bundle_sha256 != base_digest
            ):
                raise ValueError("durable proposal no longer matches its immutable bundle reference")
            prepared.append(command)
    return prepared, publication_key, expected_base_id
