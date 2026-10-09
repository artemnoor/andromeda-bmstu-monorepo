from __future__ import annotations

import csv
import hashlib
import json
import os
import shutil
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from andromeda_api.application.importer.bundle import BundleReader
from andromeda_api.application.importer.errors import BundleImportError
from andromeda_api.application.importer.mapping import project_bundle
from andromeda_api.application.operations.releases import export_release_bundle
from andromeda_api.application.proposals import (
    AllowProposalAuthorization,
    ProposalApplicationService,
)
from andromeda_api.application.publication import (
    PublicationApplicationService,
    prepare_release_archive,
)
from andromeda_api.application.settings import Settings, load_settings
from andromeda_db.connection import verify_server_identity
from andromeda_db.repositories.proposals import (
    SQLAlchemyProposalRepository,
    publish_proposals_in_transaction,
)
from andromeda_db.repositories.release_publication import (
    ReleasePublicationError,
    publish_projection,
)
from andromeda_ontology.proposals import (
    InvalidProposalTransitionError,
    MissingProposalEvidenceError,
    ProposalDomainError,
    ProposalEvidenceReference,
    ProposalIdempotencyConflict,
    ProposalPermissionDeniedError,
    ProposalStatus,
    StaleProposalError,
    proposal_publication_request_sha256,
    request_sha256,
)
from andromeda_parser.bundle import build_candidate_bundle, materialize_reviewed_bundle
from andromeda_parser.ingest import capture_sources, parse_capture, write_parse_report
from sqlalchemy import Engine, create_engine, event, text
from sqlalchemy.exc import DBAPIError

pytestmark = pytest.mark.integration
PROJECT_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_DIR = PROJECT_ROOT / "tests" / "fixtures" / "bmstu" / "ingestion"
FIXTURE_STATISTIC_KEY = "admission_statistic:bmstu:2025:01.03.02:paid:direction"


class _SimulatedClientTimeout(TimeoutError):
    """Marks only the deliberately lost response, not a hung test future."""


def _isolated_postgres16() -> tuple[Engine, Settings]:
    """Open only the dedicated local PG16 test database; never fall back to another DSN."""

    if not os.environ.get("ACADEMIC_DATA_DATABASE_URL"):
        pytest.skip("set ACADEMIC_DATA_DATABASE_URL to the dedicated local PostgreSQL 16 test DB")
    settings = load_settings()
    if (
        settings.environment != "test"
        or settings.database_name != "academic_data_test"
        or settings.database_host not in {"localhost", "127.0.0.1"}
    ):
        pytest.fail("proposal integration tests may only use localhost academic_data_test in test mode")

    engine = create_engine(settings.database_url, pool_size=2, max_overflow=0)
    try:
        with engine.connect() as connection:
            identity = verify_server_identity(connection, settings)
            database_user = connection.execute(text("SELECT current_user")).scalar_one()
        if (
            identity["database_name"] != "academic_data_test"
            or identity["database_host"] not in {"localhost", "127.0.0.1"}
            or identity["server_major"] != 16
            or database_user != "andromeda_test"
        ):
            pytest.fail("proposal tests require the dedicated PostgreSQL 16 test database and owner role")
    except Exception:
        engine.dispose()
        raise
    return engine, settings


def _proposal_service(engine: Engine) -> ProposalApplicationService:
    return ProposalApplicationService(
        SQLAlchemyProposalRepository(engine),
        authorization=AllowProposalAuthorization(),
    )


def _evidence(seed: str = "proposal source") -> tuple[ProposalEvidenceReference, ...]:
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()
    return (
        ProposalEvidenceReference(
            source_document_sha256=digest,
            source_artifact_key=f"test-source:{seed}",
            locator="page=1;row=4",
            source_url="https://example.invalid/source",
        ),
    )


def _create_proposal(
    service: ProposalApplicationService,
    *,
    seed: str,
    evidence: tuple[ProposalEvidenceReference, ...] | None = None,
    expected_active_release_id: UUID | None = None,
    expected_active_release_sha256: str | None = None,
    target_dataset: str = "directions",
    target_key: str | None = None,
    payload: dict[str, object] | None = None,
    source_candidate_key: str | None = None,
):
    resolved_target_key = target_key or f"test:proposal:{seed}"
    return service.create_proposal(
        change_type="upsert",
        target_dataset=target_dataset,
        target_key=resolved_target_key,
        source_candidate_key=source_candidate_key,
        payload=payload or {"external_key": resolved_target_key, "name": f"Proposal {seed}"},
        author="test-author",
        expected_active_release_id=expected_active_release_id,
        expected_active_release_sha256=expected_active_release_sha256,
        evidence=_evidence(seed) if evidence is None else evidence,
        idempotency_key=f"create:{seed}:{uuid4()}",
    )


def _count(engine: Engine, table_name: str, proposal_id: UUID) -> int:
    with engine.connect() as connection:
        return connection.execute(
            text(f"SELECT count(*) FROM {table_name} WHERE proposal_id=:proposal_id"),
            {"proposal_id": proposal_id},
        ).scalar_one()


def test_proposal_lifecycle_persists_revisions_evidence_and_immutable_audit() -> None:
    engine, _ = _isolated_postgres16()
    try:
        service = _proposal_service(engine)
        repository = service.repository
        created = _create_proposal(service, seed=f"lifecycle-{uuid4()}")

        # A lost response after create is resolved from the event key without a duplicate aggregate.
        create_event = repository.events_for(created.proposal_id)[0]
        create_replay = service.create_proposal(
            change_type="upsert",
            target_dataset="directions",
            target_key=created.revision.target_key,
            source_candidate_key=created.revision.source_candidate_key,
            payload=created.revision.payload,
            author=created.author,
            expected_active_release_id=None,
            expected_active_release_sha256=None,
            evidence=created.evidence,
            idempotency_key=create_event.idempotency_key,
        )
        assert (create_replay.proposal_id, create_replay.version, create_replay.status) == (
            created.proposal_id,
            1,
            ProposalStatus.DRAFT,
        )
        assert _count(engine, "proposal_events", created.proposal_id) == 1
        assert _count(engine, "proposal_revisions", created.proposal_id) == 1
        assert _count(engine, "proposal_evidence_refs", created.proposal_id) == 1

        validated = service.validate_proposal(
            created.proposal_id,
            expected_version=1,
            actor="source-validator",
            idempotency_key=f"validate:{uuid4()}",
        )
        approved = service.approve_proposal(
            created.proposal_id,
            expected_version=2,
            reviewer="reviewer-1",
            reason="exact source evidence supports the proposed value",
            review_event_id=hashlib.sha256(b"review-event:lifecycle").hexdigest(),
            idempotency_key=f"approve:{uuid4()}",
        )
        assert [validated.version, approved.version] == [2, 3]
        assert [validated.status, approved.status] == [
            ProposalStatus.VALIDATED,
            ProposalStatus.APPROVED,
        ]

        events = repository.events_for(created.proposal_id)
        assert [event.aggregate_version for event in events] == [1, 2, 3]
        assert [event.next_status for event in events] == [
            ProposalStatus.DRAFT,
            ProposalStatus.VALIDATED,
            ProposalStatus.APPROVED,
        ]
        assert events[-1].actor == "reviewer-1"
        assert events[-1].reason == "exact source evidence supports the proposed value"
        revision = repository.revisions_for(created.proposal_id)[0]
        evidence = repository.evidence_for(created.proposal_id, revision=1)[0]
        assert revision.payload == created.revision.payload
        assert revision.payload_sha256 == created.revision.payload_sha256
        assert evidence.source_document_sha256 == created.evidence[0].source_document_sha256
        assert evidence.source_artifact_key == created.evidence[0].source_artifact_key
        assert evidence.locator == created.evidence[0].locator

        # Exact replay returns the state recorded by that event, even after a later transition.
        validate_event = events[1]
        validate_replay = service.validate_proposal(
            created.proposal_id,
            expected_version=1,
            actor=validate_event.actor,
            idempotency_key=validate_event.idempotency_key,
        )
        assert (validate_replay.version, validate_replay.status) == (
            2,
            ProposalStatus.VALIDATED,
        )
        with pytest.raises(ProposalIdempotencyConflict):
            service.validate_proposal(
                created.proposal_id,
                expected_version=1,
                actor="different-actor",
                idempotency_key=validate_event.idempotency_key,
            )

        with pytest.raises(InvalidProposalTransitionError):
            service.validate_proposal(
                created.proposal_id,
                expected_version=3,
                actor="source-validator",
                idempotency_key=f"invalid-transition:{uuid4()}",
            )
        assert _count(engine, "proposal_events", created.proposal_id) == 3

        with engine.connect() as connection:
            transaction = connection.begin()
            with pytest.raises(DBAPIError) as error:
                connection.execute(
                    text(
                        "UPDATE proposal_revisions SET payload=payload "
                        "WHERE proposal_id=:proposal_id AND revision=1"
                    ),
                    {"proposal_id": created.proposal_id},
                )
            assert getattr(error.value.orig, "sqlstate", None) == "23514"
            transaction.rollback()
    finally:
        engine.dispose()


def test_proposal_evidence_is_required_for_validation_and_rejection_is_durable() -> None:
    engine, _ = _isolated_postgres16()
    try:
        service = _proposal_service(engine)
        missing = _create_proposal(service, seed=f"no-evidence-{uuid4()}", evidence=())
        with pytest.raises(MissingProposalEvidenceError):
            service.validate_proposal(
                missing.proposal_id,
                expected_version=1,
                actor="validator",
                idempotency_key=f"validate-missing:{uuid4()}",
            )
        assert service.repository.get(missing.proposal_id).status is ProposalStatus.DRAFT
        assert _count(engine, "proposal_events", missing.proposal_id) == 1

        rejected = _create_proposal(service, seed=f"reject-{uuid4()}")
        result = service.reject_proposal(
            rejected.proposal_id,
            expected_version=1,
            reviewer="reviewer-2",
            reason="source document does not identify the target record",
            idempotency_key=f"reject:{uuid4()}",
        )
        assert result.status is ProposalStatus.REJECTED
        assert result.rejection_reason == "source document does not identify the target record"
        assert service.repository.events_for(rejected.proposal_id)[-1].reason == result.rejection_reason
        with pytest.raises(InvalidProposalTransitionError):
            service.approve_proposal(
                rejected.proposal_id,
                expected_version=2,
                reviewer="reviewer-2",
                reason="cannot approve rejected proposal",
                review_event_id=hashlib.sha256(b"review-event:rejected").hexdigest(),
                idempotency_key=f"approve-rejected:{uuid4()}",
            )
    finally:
        engine.dispose()


def test_concurrent_identical_validation_replays_one_durable_transition() -> None:
    engine, _ = _isolated_postgres16()
    try:
        service = _proposal_service(engine)
        created = _create_proposal(service, seed=f"same-validation:{uuid4()}")
        barrier = Barrier(2)
        idempotency_key = f"validate-once:{uuid4()}"

        def validate_once():
            barrier.wait(timeout=30)
            return _proposal_service(engine).validate_proposal(
                created.proposal_id,
                expected_version=created.version,
                actor="source-validator",
                idempotency_key=idempotency_key,
            )

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(validate_once), executor.submit(validate_once)]
            results = [future.result(timeout=60) for future in futures]

        assert {(result.version, result.status) for result in results} == {
            (created.version + 1, ProposalStatus.VALIDATED)
        }
        events = service.repository.events_for(created.proposal_id)
        assert len(events) == 2
        assert events[-1].idempotency_key == idempotency_key
        assert results[0] == results[1]
        assert events[-1].request_hash == request_sha256(
            {
                "operation": "validated",
                "proposal_id": str(created.proposal_id),
                "expected_version": created.version,
                "actor": "source-validator",
                "reason": None,
                "review_event_id": None,
            }
        )
    finally:
        engine.dispose()


def test_proposal_application_denies_writes_without_an_injected_authorization_policy() -> None:
    engine, _ = _isolated_postgres16()
    try:
        service = ProposalApplicationService(SQLAlchemyProposalRepository(engine))
        with pytest.raises(ProposalPermissionDeniedError):
            _create_proposal(service, seed=f"unauthorized-{uuid4()}")
    finally:
        engine.dispose()


@pytest.mark.parametrize("race_kind", ["approve_approve", "approve_reject"])
def test_competing_proposal_decisions_have_one_compare_and_swap_winner(race_kind: str) -> None:
    engine, _ = _isolated_postgres16()
    try:
        service = _proposal_service(engine)
        created = _create_proposal(service, seed=f"race-{race_kind}-{uuid4()}")
        validated = service.validate_proposal(
            created.proposal_id,
            expected_version=1,
            actor="validator",
            idempotency_key=f"validate:{uuid4()}",
        )
        barrier = Barrier(2)

        def approve():
            barrier.wait(timeout=30)
            return _capture_proposal_outcome(
                lambda: _proposal_service(engine).approve_proposal(
                    created.proposal_id,
                    expected_version=validated.version,
                    reviewer="reviewer-a",
                    reason="reviewed source evidence",
                    review_event_id=hashlib.sha256(b"review-event:race-a").hexdigest(),
                    idempotency_key=f"approve:{uuid4()}",
                )
            )

        def decide_reject():
            barrier.wait(timeout=30)
            if race_kind == "approve_approve":
                return _capture_proposal_outcome(
                    lambda: _proposal_service(engine).approve_proposal(
                        created.proposal_id,
                        expected_version=validated.version,
                        reviewer="reviewer-b",
                        reason="second review",
                        review_event_id=hashlib.sha256(b"review-event:race-b").hexdigest(),
                        idempotency_key=f"approve:{uuid4()}",
                    )
                )
            return _capture_proposal_outcome(
                lambda: _proposal_service(engine).reject_proposal(
                    created.proposal_id,
                    expected_version=validated.version,
                    reviewer="reviewer-b",
                    reason="conflicting source evidence",
                    idempotency_key=f"reject:{uuid4()}",
                )
            )

        with ThreadPoolExecutor(max_workers=2) as executor:
            outcomes = [
                executor.submit(approve),
                executor.submit(decide_reject),
            ]
            result_a, result_b = [future.result(timeout=60) for future in outcomes]
        results = (result_a, result_b)
        assert sum(result[0] == "ok" for result in results) == 1
        assert sum(result[0] == "error" and isinstance(result[1], StaleProposalError) for result in results) == 1
        current = service.repository.get(created.proposal_id)
        if race_kind == "approve_approve":
            assert current.status is ProposalStatus.APPROVED
        else:
            assert current.status in {ProposalStatus.APPROVED, ProposalStatus.REJECTED}
        assert current.version == 3
        assert len(service.repository.events_for(created.proposal_id)) == 3
    finally:
        engine.dispose()


def _capture_proposal_outcome(call):
    try:
        return "ok", call()
    except ProposalDomainError as error:
        return "error", error


def _active_release(engine: Engine) -> tuple[UUID, str]:
    with engine.connect() as connection:
        active = connection.execute(
            text(
                "SELECT release.id, release.source_bundle_sha256 "
                "FROM active_data_release active "
                "JOIN data_releases release ON release.id=active.release_id "
                "WHERE active.slot_key='active'"
            )
        ).one_or_none()
    if active is None:
        pytest.fail("proposal publication integration requires a committed active release")
    return active.id, active.source_bundle_sha256


def _ensure_active_release(engine: Engine, settings: Settings) -> None:
    with engine.connect() as connection:
        active_id = connection.execute(
            text("SELECT release_id FROM active_data_release WHERE slot_key='active'")
        ).scalar_one_or_none()
    if active_id is not None:
        return
    bootstrap = project_bundle(PROJECT_ROOT / "data" / "bmstu-2026")
    result = PublicationApplicationService(settings).publish_bundle(
        bootstrap, actor="proposal-integration-bootstrap"
    )
    assert result["outcome"] == "committed"


def _export_active_bundle(
    engine: Engine, settings: Settings, output: Path
) -> tuple[Path, UUID, str]:
    _ensure_active_release(engine, settings)
    active_id, source_hash = _active_release(engine)
    with engine.connect() as connection:
        archive_format = connection.execute(
            text(
                "SELECT archive_format FROM data_release_bundle_artifacts "
                "WHERE release_id=:release_id"
            ),
            {"release_id": active_id},
        ).scalar_one()
    target = output.with_suffix(".zip") if archive_format == "source_zip_v1" else output
    result = export_release_bundle(
        engine, settings, output_path=target, release_id=active_id
    )
    assert result["source_bundle_sha256"] == source_hash
    return target, active_id, source_hash


def _candidate_from_active(
    engine: Engine,
    settings: Settings,
    tmp_path: Path,
    *,
    name_suffix: str,
    change_direction: bool,
) -> tuple[Path, UUID, str, str, str, dict[str, object] | None]:
    """Copy an archived active bundle and make a reviewed, digest-changing candidate."""

    exported_path, base_release_id, base_hash = _export_active_bundle(
        engine, settings, tmp_path / f"base-{uuid4().hex}"
    )
    candidate_dir = tmp_path / f"candidate-{uuid4().hex}"
    candidate_dir.mkdir()
    with BundleReader(exported_path) as reader:
        for relative_path in reader.file_names():
            destination = candidate_dir / Path(relative_path)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(reader.read_bytes(relative_path))

    (candidate_dir / "release_context.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "base_release_id": str(base_release_id),
                "base_source_bundle_sha256": base_hash,
            },
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )

    target_key: str
    target_name: str
    target_payload: dict[str, object] | None = None
    if change_direction:
        directions_path = candidate_dir / "data" / "directions.jsonl"
        records = [
            json.loads(line)
            for line in directions_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        record = records[0]
        target_key = str(record["external_key"])
        target_name = f"{record['name']} — proposal {name_suffix}"
        record["name"] = target_name
        target_payload = record
        directions_path.write_text(
            "".join(
                json.dumps(item, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
                + "\n"
                for item in records
            ),
            encoding="utf-8",
        )
    else:
        target_key, target_name = "", ""
        readme = candidate_dir / "README.md"
        readme.write_text(
            readme.read_text(encoding="utf-8") + f"\n<!-- unrelated {name_suffix} -->\n",
            encoding="utf-8",
        )

    projection = project_bundle(candidate_dir)
    assert projection.expected_base_release_id == base_release_id
    assert projection.expected_base_source_bundle_sha256 == base_hash
    return (
        candidate_dir,
        base_release_id,
        base_hash,
        target_key,
        target_name,
        target_payload,
    )


def _reviewed_ingestion_candidate(
    engine: Engine, settings: Settings, tmp_path: Path
) -> dict[str, object]:
    """Build an accepted exact-key ingestion candidate and retain its review event identity."""

    base_bundle, base_release_id, base_hash = _export_active_bundle(
        engine, settings, tmp_path / f"review-base-{uuid4().hex}"
    )
    with BundleReader(base_bundle) as reader:
        base_statistics = [
            json.loads(line)
            for line in reader.read_bytes("data/historical_admission_statistics.jsonl")
            .decode("utf-8")
            .splitlines()
            if line.strip()
        ]
    base_target = next(
        row for row in base_statistics if row["external_key"] == FIXTURE_STATISTIC_KEY
    )
    base_count = base_target.get("admitted_count")
    if not isinstance(base_count, int) or isinstance(base_count, bool):
        raise TypeError("the reviewed admission fixture needs a known active count")

    fixture_variant = tmp_path / f"fixture-variant-{uuid4().hex}"
    shutil.copytree(FIXTURE_DIR, fixture_variant)
    admission_page = fixture_variant / "admission_information.html"
    html = admission_page.read_text(encoding="utf-8")
    changed_count = base_count + 1
    source_row = "<tr><td>01.03.02</td><td>12</td>"
    assert html.count(source_row) == 1, "expected one exact admission count row in the fixture"
    html = html.replace(source_row, f"<tr><td>01.03.02</td><td>{changed_count}</td>", 1)
    admission_page.write_text(html, encoding="utf-8")
    source_manifest = fixture_variant / "source_manifest.json"
    manifest = json.loads(source_manifest.read_text(encoding="utf-8"))
    body_sha256 = hashlib.sha256(admission_page.read_bytes()).hexdigest()
    admission_snapshot = next(
        item for item in manifest["snapshots"] if item["body_path"] == admission_page.name
    )
    admission_snapshot["content_sha256"] = body_sha256
    admission_snapshot["source_sha256"] = body_sha256
    source_manifest.write_text(
        json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )

    capture = capture_sources(
        mode="fixture",
        fixture_dir=fixture_variant,
        output_dir=tmp_path / f"capture-{uuid4().hex}",
    )
    parse_path = tmp_path / f"parse-{uuid4().hex}.json"
    write_parse_report(parse_capture(capture.capture_dir), parse_path)
    candidate_dir = tmp_path / f"candidate-review-{uuid4().hex}"
    build_candidate_bundle(
        base_bundle=base_bundle,
        parse_report_path=parse_path,
        output_dir=candidate_dir,
        base_release_id=str(base_release_id),
        base_source_bundle_sha256=base_hash,
    )

    candidate_rows = [
        json.loads(line)
        for line in (candidate_dir / "data" / "bmstu_ingestion_candidates.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip()
    ]
    selected = next(
        row
        for row in candidate_rows
        if row["candidate_type"] == "typed_record"
        and row["target_dataset"] == "historical_admission_statistics.jsonl"
        and row["suggested_target"] == FIXTURE_STATISTIC_KEY
    )
    reviewed_at = datetime.now(UTC).isoformat()
    decisions_path = tmp_path / f"decisions-{uuid4().hex}.csv"
    fields = (
        "external_key",
        "decision",
        "reviewed_at",
        "target_external_key",
        "reviewed_by",
    )
    with decisions_path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for row in candidate_rows:
            if row["candidate_type"] == "canonical_snapshot":
                decision = "accept_observation"
            elif row["external_key"] == selected["external_key"]:
                decision = "accept_typed_fact"
            else:
                decision = "reject"
            writer.writerow(
                {
                    "external_key": row["external_key"],
                    "decision": decision,
                    "reviewed_at": reviewed_at,
                    "target_external_key": (
                        FIXTURE_STATISTIC_KEY if decision == "accept_typed_fact" else ""
                    ),
                    "reviewed_by": "proposal-pg16-reviewer",
                }
            )

    reviewed_dir = tmp_path / f"reviewed-{uuid4().hex}"
    materialize_reviewed_bundle(
        candidate_dir=candidate_dir,
        decisions_path=decisions_path,
        output_dir=reviewed_dir,
        actor="proposal-pg16-reviewer",
    )
    decisions = [
        json.loads(line)
        for line in (reviewed_dir / "review_decisions.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip()
    ]
    review_event = next(
        row for row in decisions if row.get("candidate_key") == selected["external_key"]
    )
    target_records = [
        json.loads(line)
        for line in (
            reviewed_dir / "data" / "historical_admission_statistics.jsonl"
        ).read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    target_payload = next(
        row for row in target_records if row["external_key"] == FIXTURE_STATISTIC_KEY
    )
    candidate_payload = json.loads(selected["payload_json"])
    source_hash = candidate_payload.get("source_sha256")
    if not isinstance(source_hash, str):
        source_hash = hashlib.sha256(selected["payload_json"].encode("utf-8")).hexdigest()
    source_artifact_key = selected.get("source_artifact_key")
    if not isinstance(source_artifact_key, str) or not source_artifact_key:
        source_artifact_key = f"proposal-test-source:{selected['external_key']}"
    return {
        "bundle_path": reviewed_dir,
        "base_release_id": base_release_id,
        "base_hash": base_hash,
        "candidate_key": selected["external_key"],
        "review_event_id": review_event["event_id"],
        "target_dataset": selected["target_dataset"],
        "target_key": FIXTURE_STATISTIC_KEY,
        "payload": candidate_payload,
        "materialized_payload": target_payload,
        "source_document_sha256": source_hash,
        "source_artifact_key": source_artifact_key,
    }


def _approved_ingestion_proposal(
    engine: Engine, reviewed: dict[str, object], *, seed: str
):
    service = _proposal_service(engine)
    evidence = (
        ProposalEvidenceReference(
            source_document_sha256=str(reviewed["source_document_sha256"]),
            source_artifact_key=str(reviewed["source_artifact_key"]),
            locator="candidate_payload",
        ),
    )
    created = _create_proposal(
        service,
        seed=seed,
        evidence=evidence,
        expected_active_release_id=reviewed["base_release_id"],
        expected_active_release_sha256=str(reviewed["base_hash"]),
        target_dataset=str(reviewed["target_dataset"]),
        target_key=str(reviewed["target_key"]),
        payload=reviewed["payload"],
        source_candidate_key=str(reviewed["candidate_key"]),
    )
    validated = service.validate_proposal(
        created.proposal_id,
        expected_version=1,
        actor="proposal-validator",
        idempotency_key=f"validate:{seed}",
    )
    approved = service.approve_proposal(
        created.proposal_id,
        expected_version=validated.version,
        reviewer="proposal-reviewer",
        reason="accepted by exact-key ingestion review",
        review_event_id=str(reviewed["review_event_id"]),
        idempotency_key=f"approve:{seed}",
    )
    command = service.publication_command(
        created.proposal_id,
        expected_version=approved.version,
        actor="proposal-publisher",
        idempotency_key=f"publish:{seed}",
    )
    return service, approved, command


def _command_for_publication_key(service, approved, command, publication_key: str):
    proposal_key = "proposal-publish:" + request_sha256(
        {"key": publication_key, "proposal_id": str(command.proposal_id)}
    )
    return service.publication_command(
        approved.proposal_id,
        expected_version=approved.version,
        actor=command.actor,
        idempotency_key=proposal_key,
    )


def _retarget_command(command, **changes):
    values = {
        "proposal_id": command.proposal_id,
        "expected_version": command.expected_version,
        "expected_base_release_id": command.expected_base_release_id,
        "expected_base_source_bundle_sha256": command.expected_base_source_bundle_sha256,
        "source_candidate_key": changes.get("source_candidate_key", command.source_candidate_key),
        "review_event_id": changes.get("review_event_id", command.review_event_id),
        "target_dataset": changes.get("target_dataset", command.target_dataset),
        "target_key": changes.get("target_key", command.target_key),
        "payload_sha256": changes.get("payload_sha256", command.payload_sha256),
        "actor": changes.get("actor", command.actor),
        "idempotency_key": command.idempotency_key,
    }
    changes["request_hash"] = proposal_publication_request_sha256(**values)
    return replace(command, **changes)


def _projection_for_reviewed(reviewed: dict[str, object]):
    return project_bundle(str(reviewed["bundle_path"]))


def _release_count_for_digest(engine: Engine, digest: str) -> int:
    with engine.connect() as connection:
        return connection.execute(
            text("SELECT count(*) FROM data_releases WHERE source_bundle_sha256=:digest"),
            {"digest": digest},
        ).scalar_one()


def _publish_activation_count(engine: Engine, release_id: UUID) -> int:
    with engine.connect() as connection:
        return connection.execute(
            text(
                "SELECT count(*) FROM release_activation_events "
                "WHERE operation='publish' AND active_release_id=:release_id"
            ),
            {"release_id": release_id},
        ).scalar_one()


def test_reviewed_proposal_publishes_in_the_release_transaction_and_retries_idempotently(
    tmp_path: Path,
) -> None:
    engine, settings = _isolated_postgres16()
    try:
        reviewed = _reviewed_ingestion_candidate(engine, settings, tmp_path)
        proposal_seed = f"publish-{uuid4()}"
        service, approved, command = _approved_ingestion_proposal(
            engine, reviewed, seed=proposal_seed
        )
        projection = _projection_for_reviewed(reviewed)
        publication_key = f"publication:{uuid4()}"
        command = _command_for_publication_key(service, approved, command, publication_key)
        publisher = PublicationApplicationService(settings)
        prepare_release_archive(projection)
        barrier = Barrier(2)

        def publish_once():
            barrier.wait(timeout=30)
            result = publisher.publish_bundle(
                projection,
                actor="proposal-publisher",
                expected_active_release_id=reviewed["base_release_id"],
                proposals=(command,),
                idempotency_key=publication_key,
            )
            if result["outcome"] == "committed":
                raise _SimulatedClientTimeout("simulated client timeout after PostgreSQL commit")
            return result

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(publish_once), executor.submit(publish_once)]
            concurrent_results = []
            for future in futures:
                try:
                    concurrent_results.append(("response", future.result(timeout=300)))
                except _SimulatedClientTimeout:
                    concurrent_results.append(("timeout", None))
        assert sum(kind == "timeout" for kind, _ in concurrent_results) == 1
        concurrent_replay = next(
            value
            for kind, value in concurrent_results
            if kind == "response" and value["outcome"] == "idempotent_replay"
        )
        release_id = UUID(concurrent_replay["release_id"])
        assert concurrent_replay["active_release_id"] == str(release_id)
        assert concurrent_replay["published_proposal_ids"] == [str(approved.proposal_id)]

        published = service.repository.get(approved.proposal_id)
        assert published.status is ProposalStatus.PUBLISHED
        assert published.version == approved.version + 1
        assert published.published_release_id == release_id
        assert service.repository.events_for(approved.proposal_id)[-1].next_status is ProposalStatus.PUBLISHED
        assert service.repository.events_for(approved.proposal_id)[-1].resulting_release_id == release_id

        # The per-proposal publish command has its own stable hash and can be rebuilt after commit.
        retry_command = service.publication_command(
            approved.proposal_id,
            expected_version=command.expected_version,
            actor=command.actor,
            idempotency_key=command.idempotency_key,
        )
        assert retry_command == command
        assert retry_command.request_hash == command.request_hash

        different_actor = "proposal-publisher-other"
        different_command = _retarget_command(command, actor=different_actor)
        with pytest.raises(ProposalIdempotencyConflict):
            service.publication_command(
                approved.proposal_id,
                expected_version=command.expected_version,
                actor=different_actor,
                idempotency_key=command.idempotency_key,
            )
        with engine.begin() as connection, pytest.raises(ProposalIdempotencyConflict):
            publish_proposals_in_transaction(
                connection,
                (different_command,),
                release_id=release_id,
                occurred_at=datetime.now(UTC),
            )

        with engine.connect() as connection:
            release_row = connection.execute(
                text(
                    "SELECT status, source_bundle_sha256 FROM data_releases WHERE id=:release_id"
                ),
                {"release_id": release_id},
            ).one()
            base_hash_after = connection.execute(
                text("SELECT source_bundle_sha256 FROM data_releases WHERE id=:base_release_id"),
                {"base_release_id": reviewed["base_release_id"]},
            ).scalar_one()
            target_row = connection.execute(
                text(
                    "SELECT admitted_count, minimum_score, maximum_score "
                    "FROM historical_admission_statistics "
                    "WHERE release_id=:release_id AND external_key=:external_key"
                ),
                {
                    "release_id": release_id,
                    "external_key": reviewed["target_key"],
                },
            ).one()
            source_evidence_count = connection.execute(
                text(
                    "SELECT count(*) FROM historical_statistic_evidence evidence "
                    "JOIN historical_admission_statistics statistic "
                    "ON statistic.release_id=evidence.release_id "
                    "AND statistic.id=evidence.statistic_id "
                    "WHERE statistic.release_id=:release_id "
                    "AND statistic.external_key=:external_key"
                ),
                {
                    "release_id": release_id,
                    "external_key": reviewed["target_key"],
                },
            ).scalar_one()
        materialized_payload = reviewed["materialized_payload"]
        assert release_row.status == "committed"
        assert base_hash_after == reviewed["base_hash"]
        assert tuple(target_row) == (
            materialized_payload["admitted_count"],
            materialized_payload["minimum_score"],
            materialized_payload["maximum_score"],
        )
        assert source_evidence_count > 0
        assert _release_count_for_digest(engine, projection.input_digest) == 1
        assert _publish_activation_count(engine, release_id) == 1
        assert _count(engine, "proposal_events", approved.proposal_id) == 4

        # This retry models the client that lost the first successful response.
        retry = publisher.publish_bundle(
            projection,
            actor="proposal-publisher",
            expected_active_release_id=reviewed["base_release_id"],
            proposals=(retry_command,),
            idempotency_key=publication_key,
        )
        assert retry["outcome"] == "idempotent_replay"
        assert retry["release_id"] == str(release_id)
        assert _release_count_for_digest(engine, projection.input_digest) == 1
        assert _publish_activation_count(engine, release_id) == 1
        assert _count(engine, "proposal_events", approved.proposal_id) == 4

        changed_bundle = tmp_path / f"changed-retry-{uuid4().hex}"
        shutil.copytree(reviewed["bundle_path"], changed_bundle)
        readme = changed_bundle / "README.md"
        readme.write_text(
            readme.read_text(encoding="utf-8") + "\n<!-- changed retry payload -->\n",
            encoding="utf-8",
        )
        changed_projection = project_bundle(changed_bundle)
        with pytest.raises(BundleImportError, match="idempotency key.*different request"):
            publisher.publish_bundle(
                changed_projection,
                actor="proposal-publisher",
                expected_active_release_id=reviewed["base_release_id"],
                proposals=(command,),
                idempotency_key=publication_key,
            )
        assert _release_count_for_digest(engine, changed_projection.input_digest) == 0
        assert service.repository.get(approved.proposal_id).published_release_id == release_id
    finally:
        engine.dispose()


@pytest.mark.parametrize(
    "tamper",
    ["missing_candidate", "wrong_review_event", "wrong_target", "wrong_payload_hash"],
)
def test_unbound_proposal_cannot_publish_or_leave_partial_release(
    tmp_path: Path, tamper: str
) -> None:
    engine, settings = _isolated_postgres16()
    try:
        reviewed = _reviewed_ingestion_candidate(engine, settings, tmp_path)
        service, approved, command = _approved_ingestion_proposal(
            engine, reviewed, seed=f"binding-{tamper}-{uuid4()}"
        )
        projection = _projection_for_reviewed(reviewed)
        publication_key = f"binding-publish:{uuid4()}"
        command = _command_for_publication_key(service, approved, command, publication_key)
        if tamper == "missing_candidate":
            altered = _retarget_command(command, source_candidate_key=f"missing:{uuid4()}")
        elif tamper == "wrong_review_event":
            altered = _retarget_command(
                command, review_event_id=hashlib.sha256(b"wrong review event").hexdigest()
            )
        elif tamper == "wrong_target":
            altered = _retarget_command(command, target_key=f"missing-target:{uuid4()}")
        else:
            altered = _retarget_command(
                command, payload_sha256=hashlib.sha256(b"wrong payload hash").hexdigest()
            )

        with engine.connect() as connection:
            activations_before = connection.execute(
                text("SELECT count(*) FROM release_activation_events")
            ).scalar_one()
        with pytest.raises(BundleImportError):
            PublicationApplicationService(settings).publish_bundle(
                projection,
                actor="proposal-publisher",
                expected_active_release_id=reviewed["base_release_id"],
                proposals=(altered,),
                idempotency_key=publication_key,
            )

        assert _release_count_for_digest(engine, projection.input_digest) == 0
        assert service.repository.get(approved.proposal_id).status is ProposalStatus.APPROVED
        events = service.repository.events_for(approved.proposal_id)
        assert all(event.next_status is not ProposalStatus.PUBLISHED for event in events)
        with engine.connect() as connection:
            activations_after = connection.execute(
                text("SELECT count(*) FROM release_activation_events")
            ).scalar_one()
        assert activations_after == activations_before
    finally:
        engine.dispose()


def test_release_and_proposal_publication_roll_back_together_after_proposal_cas(
    tmp_path: Path,
) -> None:
    engine, settings = _isolated_postgres16()
    try:
        reviewed = _reviewed_ingestion_candidate(engine, settings, tmp_path)
        service, approved, command = _approved_ingestion_proposal(
            engine, reviewed, seed=f"atomic:{uuid4()}"
        )
        projection = _projection_for_reviewed(reviewed)
        prepare_release_archive(projection)
        publication_key = f"atomic-publication:{uuid4()}"
        publication_hash = request_sha256(
            {
                "operation": "test-atomic-failure",
                "publication_key": publication_key,
                "bundle_sha256": projection.input_digest,
            }
        )
        with engine.connect() as connection:
            active_before = connection.execute(
                text("SELECT release_id FROM active_data_release WHERE slot_key='active'")
            ).scalar_one()
            activation_count_before = connection.execute(
                text("SELECT count(*) FROM release_activation_events")
            ).scalar_one()

        def fail_on_activation_event(
            connection, cursor, statement, parameters, context, executemany
        ):
            if "insert into release_activation_events" in " ".join(statement.lower().split()):
                raise RuntimeError("injected failure after proposal participant")

        event.listen(engine, "before_cursor_execute", fail_on_activation_event)
        try:
            with pytest.raises(ReleasePublicationError, match="rolled back"):
                publish_projection(
                    engine,
                    settings,
                    projection,
                    actor="proposal-publisher",
                    proposals=(command,),
                    idempotency_key=publication_key,
                    request_hash=publication_hash,
                )
        finally:
            event.remove(engine, "before_cursor_execute", fail_on_activation_event)

        assert _release_count_for_digest(engine, projection.input_digest) == 0
        assert service.repository.get(approved.proposal_id).status is ProposalStatus.APPROVED
        assert _count(engine, "proposal_events", approved.proposal_id) == 3
        with engine.connect() as connection:
            active_after = connection.execute(
                text("SELECT release_id FROM active_data_release WHERE slot_key='active'")
            ).scalar_one()
            activation_count_after = connection.execute(
                text("SELECT count(*) FROM release_activation_events")
            ).scalar_one()
            retained_archives = connection.execute(
                text(
                    "SELECT count(*) FROM data_release_bundle_artifacts "
                    "WHERE release_id=:release_id"
                ),
                {"release_id": projection.release_id},
            ).scalar_one()
        assert active_after == active_before
        assert activation_count_after == activation_count_before
        assert retained_archives == 0
    finally:
        engine.dispose()


def test_stale_approved_proposal_base_becomes_conflicting_without_a_release(
    tmp_path: Path,
) -> None:
    engine, settings = _isolated_postgres16()
    try:
        reviewed = _reviewed_ingestion_candidate(engine, settings, tmp_path)
        service, approved, command = _approved_ingestion_proposal(
            engine, reviewed, seed=f"stale-base:{uuid4()}"
        )
        unrelated_dir, base_id, base_hash, *_ = _candidate_from_active(
            engine,
            settings,
            tmp_path,
            name_suffix=f"winner-{uuid4()}",
            change_direction=False,
        )
        assert base_id == reviewed["base_release_id"]
        assert base_hash == reviewed["base_hash"]
        stale_publication_key = f"stale-publication:{uuid4()}"
        command = _command_for_publication_key(service, approved, command, stale_publication_key)
        winner_projection = project_bundle(unrelated_dir)
        winner = PublicationApplicationService(settings).publish_bundle(
            winner_projection,
            actor="release-operator",
            expected_active_release_id=base_id,
        )
        assert winner["outcome"] == "committed"

        proposal_projection = _projection_for_reviewed(reviewed)
        with pytest.raises(BundleImportError, match="candidate base is stale"):
            PublicationApplicationService(settings).publish_bundle(
                proposal_projection,
                actor="proposal-publisher",
                expected_active_release_id=base_id,
                proposals=(command,),
                idempotency_key=stale_publication_key,
            )

        conflicting = service.repository.get(approved.proposal_id)
        assert conflicting.status is ProposalStatus.CONFLICTING
        assert conflicting.published_release_id is None
        assert service.repository.events_for(approved.proposal_id)[-1].next_status is ProposalStatus.CONFLICTING
        assert _release_count_for_digest(engine, proposal_projection.input_digest) == 0
        with engine.connect() as connection:
            active_id = connection.execute(
                text("SELECT release_id FROM active_data_release WHERE slot_key='active'")
            ).scalar_one()
        assert active_id == UUID(winner["release_id"])
    finally:
        engine.dispose()


def test_stale_proposal_version_cannot_publish_an_approved_command(tmp_path: Path) -> None:
    engine, settings = _isolated_postgres16()
    try:
        reviewed = _reviewed_ingestion_candidate(engine, settings, tmp_path)
        service, approved, stale_command = _approved_ingestion_proposal(
            engine, reviewed, seed=f"stale-version:{uuid4()}"
        )
        publication_key = f"stale-version-publish:{uuid4()}"
        stale_command = _command_for_publication_key(
            service, approved, stale_command, publication_key
        )
        service.mark_conflicting(
            approved.proposal_id,
            expected_version=approved.version,
            actor="release-operator",
            reason="test advances the aggregate before publication",
            idempotency_key=f"mark-conflict:{uuid4()}",
        )
        projection = _projection_for_reviewed(reviewed)
        with pytest.raises(BundleImportError):
            PublicationApplicationService(settings).publish_bundle(
                projection,
                actor="proposal-publisher",
                expected_active_release_id=reviewed["base_release_id"],
                proposals=(stale_command,),
                idempotency_key=publication_key,
            )
        current = service.repository.get(approved.proposal_id)
        assert current.status is ProposalStatus.CONFLICTING
        assert current.version == approved.version + 1
        assert _release_count_for_digest(engine, projection.input_digest) == 0
        assert all(
            event.next_status is not ProposalStatus.PUBLISHED
            for event in service.repository.events_for(approved.proposal_id)
        )
    finally:
        engine.dispose()


def test_proposal_storage_is_not_exposed_to_readonly_runtimes_or_http() -> None:
    """Proposal administration remains internal and absent from API/Directus grants."""

    from andromeda_api.main import create_app

    engine, settings = _isolated_postgres16()
    try:
        with engine.connect() as connection:
            proposal_tables = {
                row.table_name
                for row in connection.execute(
                    text(
                        "SELECT table_name FROM information_schema.tables "
                        "WHERE table_schema='public' AND table_type='BASE TABLE' "
                        "AND table_name LIKE 'proposal%'"
                    )
                )
            }
            assert {
                "proposals",
                "proposal_revisions",
                "proposal_evidence_refs",
                "proposal_events",
            } <= proposal_tables

            for table_name in proposal_tables:
                qualified_table = f"public.{table_name}"
                for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"):
                    allowed = connection.execute(
                        text(
                            "SELECT has_table_privilege('andromeda_directus_runtime', :relation, :privilege)"
                        ),
                        {"relation": qualified_table, "privilege": privilege},
                    ).scalar_one()
                    assert allowed is False, (
                        "Directus runtime unexpectedly has "
                        f"{privilege} on {qualified_table}"
                    )

            for table_name in proposal_tables:
                qualified_table = f"public.{table_name}"
                for privilege in ("DELETE", "TRUNCATE"):
                    allowed = connection.execute(
                        text(
                            "SELECT has_table_privilege('andromeda_api_runtime', :relation, :privilege)"
                        ),
                        {"relation": qualified_table, "privilege": privilege},
                    ).scalar_one()
                    assert allowed is False, (
                        f"API runtime unexpectedly has {privilege} on {qualified_table}"
                    )
                assert connection.execute(
                    text(
                        "SELECT has_table_privilege('andromeda_api_runtime', :relation, 'SELECT')"
                    ),
                    {"relation": qualified_table},
                ).scalar_one()

            for table_name in ("proposal_revisions", "proposal_evidence_refs", "proposal_events"):
                assert connection.execute(
                    text(
                        "SELECT has_table_privilege('andromeda_api_runtime', :relation, 'UPDATE')"
                    ),
                    {"relation": f"public.{table_name}"},
                ).scalar_one() is False

            directus_tables = {
                row.table_name
                for row in connection.execute(
                    text(
                        "SELECT table_name FROM information_schema.tables "
                        "WHERE table_schema='directus_read'"
                    )
                )
            }
            assert not directus_tables.intersection(proposal_tables)

        app = create_app(settings=settings, engine=engine)
        proposal_routes = [route for route in app.routes if "proposal" in getattr(route, "path", "").lower()]
        assert proposal_routes == []
    finally:
        engine.dispose()
