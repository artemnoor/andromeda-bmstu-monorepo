from __future__ import annotations

import hashlib
import json
from pathlib import Path
from uuid import uuid4

import pytest
from andromeda_api.application.importer.errors import BundleImportError
from andromeda_api.application.importer.mapping import MappingResult
from andromeda_api.application.publication import _validate_proposal_bundle_binding
from andromeda_db.repositories.proposals import canonical_target_tables
from andromeda_ontology.proposals import (
    ProposalPublicationCommand,
    ProposalStatus,
    proposal_publication_request_sha256,
)
from andromeda_release_bundles import BundleReader


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _event(
    *,
    candidate_key: str,
    target_dataset: str,
    target_key: str,
    payload: dict[str, object],
) -> dict[str, object]:
    payload_json = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    event_core = {
        "candidate_key": candidate_key,
        "decision": "accept_typed_fact",
        "reviewed_at": "2026-10-08T12:00:00+00:00",
        "reviewed_by": "reviewer",
        "target_dataset": target_dataset,
        "target_external_key": target_key,
        "source_identity": candidate_key,
        "source_artifact_key": None,
        "source_sha256": None,
        "source_value_json": payload_json,
        "candidate_payload_sha256": _sha256(payload_json),
    }
    canonical_core = json.dumps(
        event_core,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return {"event_id": _sha256(canonical_core), **event_core}


def _fixture(tmp_path: Path) -> tuple[MappingResult, ProposalPublicationCommand, dict[str, object]]:
    university = _event(
        candidate_key="candidate:university",
        target_dataset="universities.jsonl",
        target_key="university:bmstu",
        payload={"external_key": "candidate:university", "code": "bmstu", "name": "BMSTU"},
    )
    direction_payload: dict[str, object] = {
        "external_key": "candidate:direction",
        "university_key": {"$candidate_ref": "candidate:university"},
        "code": "01.03.02",
        "name": "Applied Mathematics",
        "description": "Approved description",
    }
    direction = _event(
        candidate_key="candidate:direction",
        target_dataset="directions.jsonl",
        target_key="direction:01.03.02",
        payload=direction_payload,
    )
    events = [university, direction]
    (tmp_path / "data").mkdir()
    (tmp_path / "review_decisions.jsonl").write_text(
        "".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in events),
        encoding="utf-8",
    )
    (tmp_path / "ingestion_candidate_manifest.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "accepted_typed_candidate_keys": ["candidate:direction", "candidate:university"],
                "accepted_typed_review_event_ids": sorted(
                    [str(university["event_id"]), str(direction["event_id"])]
                ),
            },
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    (tmp_path / "data" / "directions.jsonl").write_text(
        json.dumps(
            {
                "external_key": "direction:01.03.02",
                "university_key": "university:bmstu",
                "code": "01.03.02",
                "name": "Applied Mathematics",
                "description": "Approved description",
            },
            separators=(",", ":"),
        )
        + "\n",
        encoding="utf-8",
    )
    (tmp_path / "data" / "universities.jsonl").write_text(
        json.dumps(
            {"external_key": "university:bmstu", "code": "bmstu", "name": "BMSTU"},
            separators=(",", ":"),
        )
        + "\n",
        encoding="utf-8",
    )

    proposal_id = uuid4()
    actor = "proposal-publisher"
    idempotency_key = "proposal-publish:direction-one"
    review_event_id = str(direction["event_id"])
    payload_sha256 = str(direction["candidate_payload_sha256"])
    command = ProposalPublicationCommand(
        proposal_id=proposal_id,
        expected_version=3,
        expected_status=ProposalStatus.APPROVED,
        expected_base_release_id=None,
        expected_base_source_bundle_sha256=None,
        source_candidate_key="candidate:direction",
        review_event_id=review_event_id,
        target_dataset="directions.jsonl",
        target_key="direction:01.03.02",
        payload_sha256=payload_sha256,
        actor=actor,
        idempotency_key=idempotency_key,
        request_hash=proposal_publication_request_sha256(
            proposal_id=proposal_id,
            expected_version=3,
            expected_base_release_id=None,
            expected_base_source_bundle_sha256=None,
            source_candidate_key="candidate:direction",
            review_event_id=review_event_id,
            target_dataset="directions.jsonl",
            target_key="direction:01.03.02",
            payload_sha256=payload_sha256,
            actor=actor,
            idempotency_key=idempotency_key,
        ),
    )
    with BundleReader(tmp_path) as reader:
        digest = reader.input_digest
    mapping = MappingResult(
        release_id=uuid4(),
        release_key="test-release",
        input_digest=digest,
        validator_report={},
        report={"mapper_version": "test-mapper"},
        table_rows={
            "directions": [{"external_key": "direction:01.03.02"}],
            "universities": [{"external_key": "university:bmstu"}],
        },
        ids_by_table={},
        raw_file_hashes={},
        bundle_input_path=str(tmp_path),
    )
    return mapping, command, direction


def _refresh_digest(mapping: MappingResult, bundle_path: Path) -> None:
    with BundleReader(bundle_path) as reader:
        mapping.input_digest = reader.input_digest


def test_proposal_binding_accepts_exact_materialized_candidate_with_resolved_reference(
    tmp_path: Path,
) -> None:
    mapping, command, _direction = _fixture(tmp_path)

    _validate_proposal_bundle_binding(mapping, (command,))


def test_proposal_binding_rejects_review_event_content_tampering(tmp_path: Path) -> None:
    mapping, command, _direction = _fixture(tmp_path)
    path = tmp_path / "review_decisions.jsonl"
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    rows[1]["reviewed_by"] = "attacker"
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in rows),
        encoding="utf-8",
    )
    _refresh_digest(mapping, tmp_path)

    with pytest.raises(BundleImportError, match="event ID does not match"):
        _validate_proposal_bundle_binding(mapping, (command,))


def test_proposal_binding_rejects_stale_existing_target_row(tmp_path: Path) -> None:
    mapping, command, _direction = _fixture(tmp_path)
    path = tmp_path / "data" / "directions.jsonl"
    row = json.loads(path.read_text(encoding="utf-8"))
    row["name"] = "Previous approved name"
    path.write_text(json.dumps(row, separators=(",", ":")) + "\n", encoding="utf-8")
    _refresh_digest(mapping, tmp_path)

    with pytest.raises(BundleImportError, match="exact approved payload"):
        _validate_proposal_bundle_binding(mapping, (command,))


def test_reviewed_dataset_mapping_names_physical_canonical_tables() -> None:
    assert canonical_target_tables("exams.jsonl") == ("admission_exams",)
    assert canonical_target_tables("tuition.jsonl") == ("tuition_assertions",)
    assert canonical_target_tables("relationships.jsonl") == ("source_relationships",)
    assert canonical_target_tables("admission_exam_requirements.jsonl") == (
        "admission_requirement_sets",
        "admission_requirement_nodes",
    )
