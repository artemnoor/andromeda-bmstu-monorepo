"""Application use cases for validating and publishing reviewed releases."""

from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import Sequence
from getpass import getuser
from pathlib import Path
from typing import Any
from uuid import UUID

from andromeda_db.connection import create_service_engine
from andromeda_db.repositories.proposals import canonical_target_tables
from andromeda_db.repositories.release_publication import (
    ReleasePublicationError,
    StaleReleaseBaseError,
    publish_projection,
)
from andromeda_ontology.proposals import (
    ProposalDomainError,
    ProposalPublicationCommand,
    request_sha256,
)
from andromeda_release_bundles import BundleInputError, BundleReader
from sqlalchemy.exc import SQLAlchemyError

from andromeda_api.application.importer.bundle import validate_bundle
from andromeda_api.application.importer.errors import BundleImportError
from andromeda_api.application.importer.mapping import MappingResult, project_bundle
from andromeda_api.application.settings import Settings, load_settings

logger = logging.getLogger("andromeda_api.application.publication")

_REVIEW_EVENT_CORE_FIELDS = (
    "candidate_key",
    "decision",
    "reviewed_at",
    "reviewed_by",
    "target_dataset",
    "target_external_key",
    "source_identity",
    "source_artifact_key",
    "source_sha256",
    "source_value_json",
    "candidate_payload_sha256",
)
_MATERIALIZER_IGNORED_FIELDS = frozenset(
    {
        "source_artifact_key",
        "source_artifact_keys",
        "source_sha256",
        "source_url",
        "source_retrieved_at",
        "external_key",
    }
)


def _review_event_id(event: dict[str, Any]) -> str:
    """Recompute the ingestion event ID from the exact canonical event core."""

    if any(field not in event for field in _REVIEW_EVENT_CORE_FIELDS):
        raise BundleImportError("review decision history omits fields covered by its event ID")
    event_core = {field: event[field] for field in _REVIEW_EVENT_CORE_FIELDS}
    canonical = json.dumps(
        event_core,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def _resolve_candidate_references(value: Any, targets: dict[str, str]) -> Any:
    if isinstance(value, dict):
        if set(value) == {"$candidate_ref"}:
            candidate_key = value["$candidate_ref"]
            if not isinstance(candidate_key, str) or candidate_key not in targets:
                raise BundleImportError("approved proposal payload references an unaccepted candidate")
            return targets[candidate_key]
        return {
            key: _resolve_candidate_references(child, targets)
            for key, child in value.items()
        }
    if isinstance(value, list):
        return [_resolve_candidate_references(child, targets) for child in value]
    return value


def _jsonl_objects(raw_bytes: bytes, *, description: str) -> list[dict[str, Any]]:
    try:
        rows = [json.loads(line) for line in raw_bytes.decode("utf-8").splitlines() if line.strip()]
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise BundleImportError(f"{description} is malformed") from error
    if not all(isinstance(row, dict) for row in rows):
        raise BundleImportError(f"{description} contains a non-object row")
    return rows


def _validate_proposal_bundle_binding(
    prepared_release: MappingResult,
    proposals: Sequence[ProposalPublicationCommand],
) -> None:
    """Bind each approved proposal to its exact row in the immutable reviewed bundle."""

    if not proposals:
        return
    input_path = prepared_release.bundle_input_path
    if input_path is None:
        raise BundleImportError("proposal publication requires the reviewed bundle input")
    try:
        with BundleReader(input_path) as reader:
            if reader.input_digest != prepared_release.input_digest:
                raise BundleImportError("reviewed bundle changed after it was mapped")
            if not reader.has_file("review_decisions.jsonl"):
                raise BundleImportError("reviewed bundle has no durable review decision history")
            raw_events = reader.read_bytes("review_decisions.jsonl")
            if not reader.has_file("ingestion_candidate_manifest.json"):
                raise BundleImportError("reviewed bundle has no accepted-candidate manifest")
            manifest_raw = reader.read_bytes("ingestion_candidate_manifest.json")
            manifest_datasets = {
                command.target_dataset for command in proposals
            }
            materialized_by_dataset = {
                dataset: reader.read_bytes(f"data/{dataset}")
                for dataset in manifest_datasets
                if reader.has_file(f"data/{dataset}")
            }
    except BundleInputError as error:
        raise BundleImportError("reviewed proposal bundle could not be read safely") from error

    try:
        events = _jsonl_objects(raw_events, description="review decision history")
        manifest = json.loads(manifest_raw)
    except json.JSONDecodeError as error:
        raise BundleImportError("reviewed candidate manifest is malformed") from error
    if not isinstance(manifest, dict):
        raise BundleImportError("reviewed candidate manifest must be an object")

    event_by_id: dict[str, dict[str, Any]] = {}
    for event in events:
        event_id = event.get("event_id")
        if not isinstance(event_id, str) or _review_event_id(event) != event_id:
            raise BundleImportError("review decision event ID does not match its exact event core")
        if event_id in event_by_id:
            raise BundleImportError("review decision history contains a duplicate event ID")
        event_by_id[event_id] = event

    accepted_ids = manifest.get("accepted_typed_review_event_ids")
    if not isinstance(accepted_ids, list) or not all(isinstance(value, str) for value in accepted_ids):
        raise BundleImportError("reviewed candidate manifest has no accepted typed review IDs")
    if len(accepted_ids) != len(set(accepted_ids)):
        raise BundleImportError("reviewed candidate manifest contains duplicate accepted event IDs")
    accepted_events: dict[str, dict[str, Any]] = {}
    accepted_target_by_candidate: dict[str, str] = {}
    for event_id in accepted_ids:
        event = event_by_id.get(event_id)
        if event is None or event.get("decision") != "accept_typed_fact":
            raise BundleImportError("accepted candidate manifest does not match review history")
        candidate_key = event.get("candidate_key")
        target_key = event.get("target_external_key")
        if not isinstance(candidate_key, str) or not isinstance(target_key, str) or not target_key:
            raise BundleImportError("accepted typed decision has no exact candidate and target keys")
        if candidate_key in accepted_target_by_candidate:
            raise BundleImportError("accepted candidate manifest repeats a candidate key")
        accepted_events[event_id] = event
        accepted_target_by_candidate[candidate_key] = target_key

    for command in proposals:
        event = accepted_events.get(command.review_event_id)
        if event is None:
            raise BundleImportError("proposal approval does not match one exact reviewed decision")
        source_value = event.get("source_value_json")
        source_hash = event.get("candidate_payload_sha256")
        if (
            event.get("candidate_key") != command.source_candidate_key
            or event.get("decision") != "accept_typed_fact"
            or event.get("target_dataset") != command.target_dataset
            or event.get("target_external_key") != command.target_key
            or source_hash != command.payload_sha256
            or not isinstance(source_value, str)
            or hashlib.sha256(source_value.encode("utf-8")).hexdigest() != command.payload_sha256
        ):
            raise BundleImportError("reviewed candidate does not match the approved proposal revision")

        try:
            approved_payload = json.loads(source_value)
        except (TypeError, json.JSONDecodeError) as error:
            raise BundleImportError("approved proposal payload is malformed") from error
        if not isinstance(approved_payload, dict):
            raise BundleImportError("approved proposal payload must be an object")
        is_retirement = approved_payload.get("retire_existing_record") is True

        if is_retirement:
            materialized_rows = []
        else:
            raw_dataset = materialized_by_dataset.get(command.target_dataset)
            if raw_dataset is None:
                raise BundleImportError("approved proposal target dataset is absent from the release")
            materialized_rows = _jsonl_objects(
                raw_dataset,
                description=f"materialized {command.target_dataset}",
            )
        matching_rows = [
            row for row in materialized_rows if row.get("external_key") == command.target_key
        ]
        if is_retirement:
            if matching_rows:
                raise BundleImportError("retired proposal target remains in the materialized dataset")
            continue
        if len(matching_rows) != 1:
            raise BundleImportError("approved proposal target is missing or duplicated in the release")

        resolved_payload = _resolve_candidate_references(approved_payload, accepted_target_by_candidate)
        if not isinstance(resolved_payload, dict):
            raise BundleImportError("resolved proposal payload must be an object")
        materialized_row = matching_rows[0]
        for field, expected_value in resolved_payload.items():
            # The ingestion merger treats null as "leave the existing value unchanged".
            if field in _MATERIALIZER_IGNORED_FIELDS or expected_value is None:
                continue
            if materialized_row.get(field) != expected_value:
                raise BundleImportError(
                    "materialized proposal target does not contain the exact approved payload"
                )

        # The mapper projection is the exact structure that will be inserted into the release;
        # prove the exact target survived that mapping as well as the source JSONL merge.
        try:
            projected_tables = canonical_target_tables(command.target_dataset)
        except ProposalDomainError as error:
            raise BundleImportError("proposal target has no canonical release table mapping") from error
        projected_matches = [
            row
            for table_name in projected_tables
            for row in prepared_release.table_rows.get(table_name, [])
            if row.get("external_key") == command.target_key
        ]
        if len(projected_matches) != 1:
            raise BundleImportError("approved proposal target is absent or duplicated after mapping")


def _proposal_publication_request(
    prepared_release: MappingResult,
    proposals: Sequence[ProposalPublicationCommand],
    actor: str,
    publication_key: str | None,
) -> tuple[str | None, str | None, tuple[ProposalPublicationCommand, ...]]:
    if not proposals and publication_key is None:
        return None, None, ()

    if proposals and not prepared_release.release_context_present:
        raise BundleImportError("proposal publication requires a reviewed active-release base")
    proposal_ids = [command.proposal_id for command in proposals]
    if len(proposal_ids) != len(set(proposal_ids)):
        raise BundleImportError("a publication command cannot contain a proposal more than once")
    proposal_facts = []
    for command in proposals:
        if (
            command.expected_base_release_id != prepared_release.expected_base_release_id
            or command.expected_base_source_bundle_sha256
            != prepared_release.expected_base_source_bundle_sha256
        ):
            raise BundleImportError("proposal base does not match the reviewed release bundle")
        proposal_facts.append(
            {
                "proposal_id": str(command.proposal_id),
                "expected_version": command.expected_version,
                "expected_status": command.expected_status.value,
                "source_candidate_key": command.source_candidate_key,
                "review_event_id": command.review_event_id,
                "target_dataset": command.target_dataset,
                "target_key": command.target_key,
                "payload_sha256": command.payload_sha256,
            }
        )
    proposal_facts.sort(key=lambda item: item["proposal_id"])
    request_hash = request_sha256(
        {
            "operation": "publish_reviewed_bundle",
            "actor": actor,
            "bundle_sha256": prepared_release.input_digest,
            "mapper_version": prepared_release.report["mapper_version"],
            "expected_active_release_id": (
                str(prepared_release.expected_base_release_id)
                if prepared_release.expected_base_release_id
                else None
            ),
            "expected_active_release_sha256": prepared_release.expected_base_source_bundle_sha256,
            "proposals": proposal_facts,
        }
    )
    key = publication_key or f"proposal-publish:{request_hash}"
    if not key.strip() or len(key) > 256:
        raise BundleImportError("publication idempotency key must contain 1 to 256 characters")

    commands = tuple(sorted(proposals, key=lambda item: str(item.proposal_id)))
    for command in commands:
        expected_proposal_key = "proposal-publish:" + request_sha256(
            {"key": key, "proposal_id": str(command.proposal_id)}
        )
        if command.actor != actor or command.idempotency_key != expected_proposal_key:
            raise BundleImportError(
                "proposal command identity does not match the publication actor and idempotency key"
            )
    return key, request_hash, commands


def prepare_release_archive(projection: MappingResult) -> None:
    """Create the immutable archive while confirming the mapped input has not drifted."""

    if projection.release_archive_bytes:
        return
    if not projection.bundle_input_path:
        raise BundleImportError("mapped bundle input path is unavailable for release archival")
    try:
        with BundleReader(projection.bundle_input_path) as reader:
            if reader.input_digest != projection.input_digest:
                raise BundleImportError("bundle changed after mapping; release archive was not prepared")
            archive_format, archive_bytes, archive_sha256 = reader.release_archive()
    except BundleInputError as error:
        raise BundleImportError("bundle could not be archived safely") from error
    projection.release_archive_format = archive_format
    projection.release_archive_bytes = archive_bytes
    projection.release_archive_sha256 = archive_sha256


class PublicationApplicationService:
    """Validate a prepared release and delegate one atomic commit to the DB repository."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings

    def publish_bundle(
        self,
        prepared_release: MappingResult,
        actor: str | None = None,
        expected_active_release_id: UUID | None = None,
        *,
        proposals: Sequence[ProposalPublicationCommand] = (),
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        if expected_active_release_id is not None and (
            not prepared_release.release_context_present
            or prepared_release.expected_base_release_id != expected_active_release_id
        ):
            raise BundleImportError("candidate base does not match the expected active release")
        _validate_proposal_bundle_binding(prepared_release, proposals)
        prepare_release_archive(prepared_release)
        settings = self.settings or load_settings()
        publish_actor = actor or getuser()
        command_key, request_hash, publication_commands = _proposal_publication_request(
            prepared_release,
            proposals,
            publish_actor,
            idempotency_key,
        )
        engine = create_service_engine(settings)
        try:
            return publish_projection(
                engine,
                settings,
                prepared_release,
                actor=publish_actor,
                proposals=publication_commands,
                idempotency_key=command_key,
                request_hash=request_hash,
            )
        except StaleReleaseBaseError as error:
            if publication_commands:
                from andromeda_db.repositories.proposals import (
                    SQLAlchemyProposalRepository,
                )

                from andromeda_api.application.proposals import (
                    AllowProposalAuthorization,
                    ProposalApplicationService,
                )

                try:
                    proposal_service = ProposalApplicationService(
                        SQLAlchemyProposalRepository(engine),
                        authorization=AllowProposalAuthorization(),
                    )
                    proposal_service.mark_proposals_conflicting(
                        (
                            (
                                command.proposal_id,
                                command.expected_version,
                                "active release changed after proposal review",
                            )
                            for command in publication_commands
                        ),
                        actor=publish_actor,
                        idempotency_key_prefix=(
                            "stale-publication-base:" + request_sha256({"key": command_key})
                        ),
                    )
                except (ProposalDomainError, SQLAlchemyError) as conflict_error:
                    logger.error(
                        "failed to record stale-base proposal conflict after publication rollback",
                        extra={
                            "event": "proposal.publication.conflict_record_failed",
                            "proposal_count": len(publication_commands),
                            "exception_type": type(conflict_error).__name__,
                            "outcome": "failed",
                        },
                    )
            raise BundleImportError(str(error)) from error
        except ReleasePublicationError as error:
            raise BundleImportError(str(error)) from error
        finally:
            engine.dispose()


def validate_import_bundle(input_path: str | Path) -> dict[str, Any]:
    """Run the complete offline bundle validation use case."""

    return validate_bundle(input_path)


def dry_run_bundle(input_path: str | Path) -> dict[str, Any]:
    """Validate and map a bundle without opening a database connection."""

    projection = project_bundle(input_path)
    return {
        "outcome": "dry_run",
        "database_connection_opened": False,
        "network_requests": 0,
        "input_digest": projection.input_digest,
        "release_key": projection.release_key,
        "mapping": projection.report,
    }


def publish_reviewed_bundle(
    input_dir: str | Path,
    *,
    actor: str | None = None,
    expected_active_release_id: UUID | None = None,
    proposals: Sequence[ProposalPublicationCommand] = (),
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    """Publish a reviewed, materialized bundle through the shared application service."""

    prepared_release = project_bundle(input_dir)
    return PublicationApplicationService().publish_bundle(
        prepared_release,
        actor=actor,
        expected_active_release_id=expected_active_release_id,
        proposals=proposals,
        idempotency_key=idempotency_key,
    )


def get_release_status() -> dict[str, Any]:
    """Return the active release summary through the application read use case."""

    from andromeda_api.application.operations.releases import release_status

    settings = load_settings()
    engine = create_service_engine(settings)
    try:
        return release_status(engine, settings)
    finally:
        engine.dispose()


def export_active_release_bundle(output_path: str | Path) -> dict[str, Any]:
    """Export and verify the active release archive through its application use case."""

    from andromeda_api.application.operations.releases import export_release_bundle

    settings = load_settings()
    engine = create_service_engine(settings)
    try:
        return export_release_bundle(engine, settings, output_path=output_path)
    finally:
        engine.dispose()


def assert_empty_active_slot() -> None:
    """Verify the first-publication slot is empty before an explicit bootstrap."""

    from andromeda_api.application.operations.releases import require_empty_active_slot

    settings = load_settings()
    engine = create_service_engine(settings)
    try:
        require_empty_active_slot(engine, settings)
    finally:
        engine.dispose()
