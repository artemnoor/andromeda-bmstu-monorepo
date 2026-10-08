"""PostgreSQL adapter for atomic academic release publication."""

from __future__ import annotations

import hashlib
import logging
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from getpass import getuser
from typing import Any, Protocol, cast
from uuid import UUID, uuid4

from andromeda_ontology.proposals import (
    ProposalDomainError,
    ProposalPublicationCommand,
    StaleProposalBaseError,
)
from sqlalchemy import Engine, Table, func, insert, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError, OperationalError, SQLAlchemyError

import andromeda_db.models.admission_models as _admission_models  # noqa: F401
import andromeda_db.models.catalog_models as _catalog_models  # noqa: F401
import andromeda_db.models.evidence_models as _evidence_models  # noqa: F401
import andromeda_db.models.source_models as _source_models  # noqa: F401
from andromeda_db.connection import verify_server_identity
from andromeda_db.models.base import Base
from andromeda_db.models.models import (
    ActiveDataReleaseModel,
    DataReleaseBundleArtifactModel,
    DataReleaseModel,
    ImportBatchModel,
    ReleaseActivationEventModel,
)
from andromeda_db.revisions import SERVICE_SCHEMA_HEAD, current_schema_revision

logger = logging.getLogger("andromeda_db.release_publication")
BATCH_SIZE = 500
REQUIRED_IMPORT_SCHEMA_REVISION = SERVICE_SCHEMA_HEAD
RELEASE_PUBLICATION_LOCK_KEY = int.from_bytes(
    hashlib.sha256(b"andromeda-academic-active-release-v1").digest()[:8],
    byteorder="big",
    signed=True,
)

class ReleaseProjection(Protocol):
    release_id: UUID
    release_key: str
    input_digest: str
    validator_report: dict[str, Any]
    report: dict[str, Any]
    table_rows: dict[str, list[dict[str, Any]]]
    raw_file_hashes: dict[str, str]
    expected_base_release_id: UUID | None
    expected_base_source_bundle_sha256: str | None
    release_context_present: bool
    release_archive_format: str
    release_archive_bytes: bytes
    release_archive_sha256: str


class ReleasePublicationError(RuntimeError):
    """The release projection could not be safely committed."""


class StaleReleaseBaseError(ReleasePublicationError):
    """The active canonical release no longer matches a reviewed candidate."""


def _safe_failure_code(error: Exception) -> str:
    if isinstance(error, StaleReleaseBaseError):
        return "STALE_ACTIVE_RELEASE"
    if isinstance(error, ReleasePublicationError):
        return "BUNDLE_RECONCILIATION_FAILED"
    if isinstance(error, IntegrityError):
        return "DATABASE_CONSTRAINT_FAILED"
    if isinstance(error, OperationalError):
        return "DATABASE_OPERATION_FAILED"
    return "IMPORT_TRANSACTION_FAILED"

TABLE_INSERT_ORDER = (
    "source_artifacts",
    "universities",
    "directions",
    "departments",
    "admission_campaigns",
    "funding_types",
    "quota_types",
    "admission_exams",
    "educational_programs",
    "direction_departments",
    "educational_program_departments",
    "catalog_courses",
    "study_plans",
    "curriculum_items",
    "campaign_calendar_events",
    "program_offerings",
    "competition_pools",
    "competition_pool_offerings",
    "admission_requirement_sets",
    "admission_requirement_nodes",
    "offering_requirement_links",
    "tuition_assertions",
    "historical_admission_statistics",
    "admission_statistics",
    "individual_achievement_policies",
    "admission_documents",
    "admission_document_pages",
    "admission_result_sources",
    "source_relationships",
    "manual_review_items",
    "source_observations",
    "source_evidence",
    "university_evidence",
    "direction_evidence",
    "department_evidence",
    "direction_department_evidence",
    "program_evidence",
    "program_department_evidence",
    "catalog_course_evidence",
    "study_plan_evidence",
    "curriculum_evidence",
    "campaign_evidence",
    "calendar_event_evidence",
    "offering_evidence",
    "competition_pool_evidence",
    "pool_offering_evidence",
    "place_quota_evidence",
    "requirement_set_evidence",
    "requirement_node_evidence",
    "offering_requirement_evidence",
    "tuition_evidence",
    "historical_statistic_evidence",
    "admission_statistic_evidence",
    "achievement_evidence",
    "admission_document_evidence",
    "admission_document_page_evidence",
    "admission_result_source_evidence",
    "source_relationship_evidence",
    "manual_review_evidence",
    "exam_evidence",
    "funding_type_evidence",
    "quota_type_evidence",
)

def _validate_projection(projection: ReleaseProjection) -> None:
    if projection.validator_report.get("valid") is not True:
        raise ReleasePublicationError("only a successfully validated bundle can be imported")
    if (
        projection.release_archive_format not in {"source_zip_v1", "directory_zip_v1"}
        or not projection.release_archive_bytes
        or hashlib.sha256(projection.release_archive_bytes).hexdigest()
        != projection.release_archive_sha256
    ):
        raise ReleasePublicationError("release bundle archive is missing or failed its SHA-256 check")
    expected_observations = projection.report.get("source_observations_expected")
    actual_observations = len(projection.table_rows.get("source_observations", []))
    if expected_observations != actual_observations:
        raise ReleasePublicationError("source observation count does not reconcile with input rows")
    unknown_tables = set(projection.table_rows) - set(Base.metadata.tables)
    if unknown_tables:
        raise ReleasePublicationError("mapping contains a table not present in the service schema")
    missing_order = set(projection.table_rows) - set(TABLE_INSERT_ORDER)
    if missing_order:
        raise ReleasePublicationError(
            "mapping contains a table with no declared foreign-key insert order"
        )
    for table_name, rows in projection.table_rows.items():
        seen_keys: set[str] = set()
        for row in rows:
            if row.get("release_id") != projection.release_id:
                raise ReleasePublicationError(f"{table_name} contains a row for another release")
            key = row.get("external_key")
            if not isinstance(key, str) or not key:
                raise ReleasePublicationError(f"{table_name} contains a row without an external key")
            if key in seen_keys:
                raise ReleasePublicationError(f"{table_name} contains duplicate external keys")
            seen_keys.add(key)

def _insert_projection_rows(connection: Any, projection: ReleaseProjection) -> dict[str, int]:
    inserted: dict[str, int] = {}
    for table_name in TABLE_INSERT_ORDER:
        rows = projection.table_rows.get(table_name, [])
        if not rows:
            continue
        table = Base.metadata.tables[table_name]
        chunk_count = (len(rows) + BATCH_SIZE - 1) // BATCH_SIZE
        for ordinal, offset in enumerate(range(0, len(rows), BATCH_SIZE), start=1):
            chunk = rows[offset : offset + BATCH_SIZE]
            try:
                connection.execute(insert(table), chunk)
            except SQLAlchemyError as error:
                original_error = getattr(error, "orig", None)
                diagnostic = getattr(original_error, "diag", None)
                logger.error(
                    "bundle import table chunk rejected",
                    extra={
                        "event": "bundle.import.chunk_rejected",
                        "phase": "database_write",
                        "input_digest": projection.input_digest,
                        "release_key": projection.release_key,
                        "table": table_name,
                        "chunk_ordinal": ordinal,
                        "chunk_count": chunk_count,
                        "chunk_size": len(chunk),
                        "source_key": (
                            str(chunk[0].get("external_key", ""))[:160] if chunk else None
                        ),
                        "sqlstate": getattr(original_error, "sqlstate", None),
                        "constraint_name": getattr(diagnostic, "constraint_name", None),
                        "database_table": getattr(diagnostic, "table_name", None),
                        "database_column": getattr(diagnostic, "column_name", None),
                        "database_exception_type": (
                            type(original_error).__name__ if original_error is not None else None
                        ),
                        "outcome": "rejected",
                    },
                )
                raise
            logger.info(
                "bundle import chunk written",
                extra={
                    "event": "bundle.import.chunk_written",
                    "phase": "database_write",
                    "input_digest": projection.input_digest,
                    "release_key": projection.release_key,
                    "table": table_name,
                    "chunk_ordinal": ordinal,
                    "chunk_count": chunk_count,
                    "chunk_size": len(chunk),
                    "outcome": "inserted",
                },
            )
        inserted[table_name] = len(rows)
    return inserted

def _reconcile_database(connection: Any, projection: ReleaseProjection) -> dict[str, Any]:
    actual_table_counts: dict[str, int] = {}
    for table_name, expected_count in sorted(
        (name, len(rows)) for name, rows in projection.table_rows.items()
    ):
        table = Base.metadata.tables[table_name]
        actual_count = connection.execute(
            select(func.count())
            .select_from(table)
            .where(table.c.release_id == projection.release_id)
        ).scalar_one()
        actual_table_counts[table_name] = int(actual_count)
        if int(actual_count) != expected_count:
            raise ReleasePublicationError(f"row count did not reconcile for {table_name}")

    observed_dataset_counts = {
        str(dataset_name): int(count)
        for dataset_name, count in connection.execute(
            select(
                Base.metadata.tables["source_observations"].c.dataset_name,
                func.count(),
            )
            .where(
                Base.metadata.tables["source_observations"].c.release_id == projection.release_id
            )
            .group_by(Base.metadata.tables["source_observations"].c.dataset_name)
        ).all()
    }
    expected_dataset_counts = {
        name.removesuffix(".jsonl"): count
        for name, count in projection.report["source_dataset_counts"].items()
    }
    expected_dataset_counts.update(
        {
            "source_artifacts": projection.report["source_manifest_count"],
            "manual_review.csv": projection.report["manual_review_count"],
            "user_confirmed_study_plan_links": projection.report[
                "confirmed_study_plan_link_observations"
            ],
            "user_confirmed_study_plan_links_manifest": projection.report.get(
                "confirmed_study_plan_link_manifest_observations", 0
            ),
        }
    )
    expected_dataset_counts = {
        name: count for name, count in expected_dataset_counts.items() if count > 0
    }
    if observed_dataset_counts != expected_dataset_counts:
        raise ReleasePublicationError("source observation datasets do not reconcile with input files")

    operator_counts = {
        str(operator): int(count)
        for operator, count in connection.execute(
            select(
                Base.metadata.tables["admission_requirement_nodes"].c.operator,
                func.count(),
            )
            .where(
                Base.metadata.tables["admission_requirement_nodes"].c.release_id
                == projection.release_id,
                Base.metadata.tables["admission_requirement_nodes"].c.node_kind == "operator",
            )
            .group_by(Base.metadata.tables["admission_requirement_nodes"].c.operator)
        ).all()
        if operator is not None
    }
    if operator_counts != projection.report["requirement_operator_counts"]:
        raise ReleasePublicationError("AND/OR/AT_LEAST operator counts changed during import")
    if projection.report["excluded_olympiad_rows"] != 0:
        raise ReleasePublicationError("forbidden olympiad rows are present in the mapping")
    if projection.report["excluded_personal_applicant_rows"] != 0:
        raise ReleasePublicationError("forbidden personal applicant rows are present in the mapping")
    return {
        "table_counts": actual_table_counts,
        "source_observation_counts": observed_dataset_counts,
        "requirement_operator_counts": operator_counts,
        "explicit_relationship_count": actual_table_counts.get("source_relationships", 0),
        "manual_review_count": actual_table_counts.get("manual_review_items", 0),
        "reconciled": True,
    }

def _record_failed_batch(
    engine: Engine,
    projection: ReleaseProjection,
    failure_code: str,
) -> None:
    try:
        with engine.begin() as connection:
            connection.execute(
                insert(ImportBatchModel).values(
                    id=uuid4(),
                    source_bundle_sha256=projection.input_digest,
                    mapper_version=projection.report["mapper_version"],
                    status="failed",
                    finished_at=datetime.now(UTC),
                    validation_report=projection.validator_report,
                    row_counts=projection.report,
                    failure_code=failure_code,
                )
            )
    except SQLAlchemyError:
        logger.exception(
            "failed import batch metadata could not be recorded",
            extra={
                "event": "bundle.import.failure_audit_failed",
                "input_digest": projection.input_digest,
                "outcome": failure_code,
            },
        )

def publish_projection(
    engine: Engine,
    settings: Any,
    projection: ReleaseProjection,
    *,
    actor: str | None = None,
    before_activation: Callable[[], None] | None = None,
    proposals: Sequence[ProposalPublicationCommand] = (),
    idempotency_key: str | None = None,
    request_hash: str | None = None,
) -> dict[str, Any]:
    """Write one release transactionally and update the active pointer last."""

    _validate_projection(projection)
    if bool(idempotency_key) != bool(request_hash):
        raise ReleasePublicationError(
            "publication idempotency key and request hash must be provided together"
        )
    if idempotency_key is not None and (
        not idempotency_key.strip()
        or idempotency_key != idempotency_key.strip()
        or len(idempotency_key) > 256
        or len(request_hash or "") != 64
        or any(character not in "0123456789abcdef" for character in request_hash or "")
    ):
        raise ReleasePublicationError("publication idempotency identity is invalid")
    if proposals and idempotency_key is None:
        raise ReleasePublicationError(
            "proposal publication requires a stable idempotency key and request hash"
        )
    with engine.connect() as connection:
        identity = verify_server_identity(connection, settings)
    revision = current_schema_revision(engine)
    if revision != REQUIRED_IMPORT_SCHEMA_REVISION:
        raise ReleasePublicationError(
            f"service schema must be at {REQUIRED_IMPORT_SCHEMA_REVISION} before import"
        )

    actor_name = (actor or getuser()).strip()
    if not actor_name or len(actor_name) > 256:
        raise ReleasePublicationError("operator identity must contain 1 to 256 characters")
    batch_id = uuid4()
    now = datetime.now(UTC)
    active_table = cast(Table, ActiveDataReleaseModel.__table__)
    release_table = cast(Table, DataReleaseModel.__table__)
    archive_table = cast(Table, DataReleaseBundleArtifactModel.__table__)
    activation_table = cast(Table, ReleaseActivationEventModel.__table__)
    batch_table = cast(Table, ImportBatchModel.__table__)

    try:
        with engine.begin() as connection:
            connection.execute(
                text("SELECT pg_advisory_xact_lock(:lock_key)"),
                {"lock_key": RELEASE_PUBLICATION_LOCK_KEY},
            )
            active_release_id = connection.execute(
                select(active_table.c.release_id)
                .where(active_table.c.slot_key == "active")
                .with_for_update()
            ).scalar_one_or_none()
            if idempotency_key is not None:
                prior_command = connection.execute(
                    select(
                        batch_table.c.id.label("batch_id"),
                        batch_table.c.status.label("batch_status"),
                        batch_table.c.source_bundle_sha256,
                        batch_table.c.mapper_version,
                        batch_table.c.publication_request_hash,
                        release_table.c.id.label("release_id"),
                        release_table.c.release_key,
                        release_table.c.status.label("release_status"),
                    )
                    .select_from(
                        batch_table.join(release_table, release_table.c.batch_id == batch_table.c.id)
                    )
                    .where(batch_table.c.publication_idempotency_key == idempotency_key)
                ).one_or_none()
                if prior_command is not None:
                    if prior_command.publication_request_hash != request_hash:
                        raise ReleasePublicationError(
                            "publication idempotency key was already used with a different request"
                        )
                    if (
                        prior_command.batch_status != "committed"
                        or prior_command.release_status != "committed"
                        or prior_command.source_bundle_sha256 != projection.input_digest
                        or prior_command.mapper_version != projection.report["mapper_version"]
                    ):
                        raise ReleasePublicationError(
                            "publication idempotency record does not match the committed request"
                        )
                    prior_activation = connection.execute(
                        select(
                            activation_table.c.previous_release_id,
                            activation_table.c.actor,
                        )
                        .where(
                            activation_table.c.operation == "publish",
                            activation_table.c.active_release_id == prior_command.release_id,
                        )
                        .order_by(activation_table.c.occurred_at.desc())
                        .limit(1)
                    ).one_or_none()
                    replay_result = {
                        "outcome": "idempotent_replay",
                        "reason": "publication_command_already_committed",
                        "actor": prior_activation.actor if prior_activation else actor_name,
                        "input_digest": projection.input_digest,
                        "release_id": str(prior_command.release_id),
                        "release_key": prior_command.release_key,
                        "batch_id": str(prior_command.batch_id),
                        "previous_active_release_id": (
                            str(prior_activation.previous_release_id)
                            if prior_activation and prior_activation.previous_release_id
                            else None
                        ),
                        "active_release_id": (
                            str(active_release_id) if active_release_id else None
                        ),
                        "database_name": identity["database_name"],
                        "schema_revision": revision,
                        "mapping": projection.report,
                    }
                    if proposals:
                        replay_result["published_proposal_ids"] = [
                            str(command.proposal_id)
                            for command in sorted(proposals, key=lambda item: str(item.proposal_id))
                        ]
                    return replay_result
            existing = connection.execute(
                select(
                    release_table.c.id,
                    release_table.c.status,
                    release_table.c.source_bundle_sha256,
                ).where(
                    release_table.c.source_bundle_sha256 == projection.input_digest,
                    release_table.c.mapper_version == projection.report["mapper_version"],
                )
            ).one_or_none()
            if existing is not None and existing.status == "committed":
                if active_release_id == existing.id:
                    if proposals:
                        raise ReleasePublicationError(
                            "reviewed proposal bundle is already active under a different command key"
                        )
                    return {
                        "outcome": "no_op",
                        "reason": "bundle_digest_and_mapper_version_already_active",
                        "input_digest": projection.input_digest,
                        "release_id": str(existing.id),
                        "release_key": projection.release_key,
                        "active_release_id": str(active_release_id),
                        "database_name": identity["database_name"],
                        "schema_revision": revision,
                        "mapping": projection.report,
                    }
                raise ReleasePublicationError(
                    "bundle was already committed as an inactive release; use explicit rollback"
                )

            expected_active_id = (
                projection.expected_base_release_id
                if projection.release_context_present
                else None
            )
            if active_release_id != expected_active_id:
                raise StaleReleaseBaseError(
                    "candidate base is stale: active release changed; export, diff, and review again"
                )
            if expected_active_id is not None:
                active_digest = connection.execute(
                    select(release_table.c.source_bundle_sha256).where(
                        release_table.c.id == expected_active_id
                    )
                ).scalar_one_or_none()
                if active_digest != projection.expected_base_source_bundle_sha256:
                    raise StaleReleaseBaseError(
                        "candidate base digest does not match the locked active release"
                    )

            connection.execute(
                insert(batch_table).values(
                    id=batch_id,
                    source_bundle_sha256=projection.input_digest,
                    mapper_version=projection.report["mapper_version"],
                    status="staging",
                    started_at=now,
                    validation_report=projection.validator_report,
                    row_counts=projection.report,
                    publication_idempotency_key=idempotency_key,
                    publication_request_hash=request_hash,
                )
            )
            connection.execute(
                insert(release_table).values(
                    id=projection.release_id,
                    release_key=projection.release_key,
                    source_bundle_sha256=projection.input_digest,
                    mapper_version=projection.report["mapper_version"],
                    batch_id=batch_id,
                    status="staging",
                    schema_revision=revision,
                    reconciliation_status=None,
                    reconciliation_summary=None,
                    created_at=now,
                    committed_at=None,
                )
            )
            connection.execute(
                insert(archive_table).values(
                    release_id=projection.release_id,
                    archive_format=projection.release_archive_format,
                    archive_bytes=projection.release_archive_bytes,
                    archive_sha256=projection.release_archive_sha256,
                    created_at=now,
                )
            )
            inserted_counts = _insert_projection_rows(connection, projection)
            reconciliation = _reconcile_database(connection, projection)
            report_payload = {
                **projection.report,
                "source_file_sha256": projection.raw_file_hashes,
                "release_bundle_archive": {
                    "format": projection.release_archive_format,
                    "sha256": projection.release_archive_sha256,
                    "byte_size": len(projection.release_archive_bytes),
                },
                "database_reconciliation": reconciliation,
                "database_name": identity["database_name"],
                "schema_revision": revision,
                "committed_at": now.isoformat(),
            }
            if before_activation is not None:
                before_activation()

            previous_active = active_release_id
            connection.execute(
                update(release_table)
                .where(release_table.c.id == projection.release_id)
                .values(
                    status="committed",
                    reconciliation_status=(
                        "passed_with_gaps"
                        if projection.report["warnings"]
                        or projection.report["unresolved_exact_references"]
                        or projection.validator_report.get("warnings")
                        else "passed"
                    ),
                    reconciliation_summary=report_payload,
                    committed_at=now,
                )
            )
            connection.execute(
                update(batch_table)
                .where(batch_table.c.id == batch_id)
                .values(status="committed", finished_at=now, row_counts=report_payload)
            )
            published_proposal_ids: tuple[UUID, ...] = ()
            if proposals:
                from andromeda_db.repositories.proposals import (
                    publish_proposals_in_transaction,
                )

                try:
                    published_proposal_ids = publish_proposals_in_transaction(
                        connection,
                        proposals,
                        release_id=projection.release_id,
                        occurred_at=now,
                    )
                except StaleProposalBaseError as error:
                    raise StaleReleaseBaseError(
                        "candidate base is stale: proposal base does not match the locked active release"
                    ) from error
            connection.execute(
                pg_insert(active_table)
                .values(slot_key="active", release_id=projection.release_id, changed_at=now)
                .on_conflict_do_update(
                    index_elements=[active_table.c.slot_key],
                    set_={"release_id": projection.release_id, "changed_at": now},
                )
            )
            connection.execute(
                insert(activation_table).values(
                    id=uuid4(),
                    operation="publish",
                    previous_release_id=previous_active,
                    active_release_id=projection.release_id,
                    expected_active_release_id=expected_active_id,
                    source_bundle_sha256=projection.input_digest,
                    actor=actor_name,
                    reason=None,
                    occurred_at=now,
                )
            )
        result = {
            "outcome": "committed",
            "actor": actor_name,
            "input_digest": projection.input_digest,
            "release_id": str(projection.release_id),
            "release_key": projection.release_key,
            "batch_id": str(batch_id),
            "previous_active_release_id": str(previous_active) if previous_active else None,
            "active_release_id": str(projection.release_id),
            "database_name": identity["database_name"],
            "schema_revision": revision,
            "inserted_counts": inserted_counts,
            "reconciliation": reconciliation,
            "mapping": projection.report,
        }
        if published_proposal_ids:
            result["published_proposal_ids"] = [
                str(proposal_id) for proposal_id in published_proposal_ids
            ]
        logger.info(
            "bundle release committed and activated",
            extra={
                "event": "bundle.import.activated",
                "phase": "activation",
                "input_digest": projection.input_digest,
                "release_key": projection.release_key,
                "batch_id": str(batch_id),
                "database_name": identity["database_name"],
                "outcome": "committed",
            },
        )
        return result
    except (
        SQLAlchemyError,
        ProposalDomainError,
        ReleasePublicationError,
        RuntimeError,
        ValueError,
        TypeError,
        OSError,
    ) as error:
        # Normalize database, domain, and callback failures only after the
        # transaction context has rolled back.
        failure_code = _safe_failure_code(error)
        _record_failed_batch(engine, projection, failure_code)
        original_error = getattr(error, "orig", None)
        diagnostic = getattr(original_error, "diag", None)
        logger.error(
            "bundle import transaction rolled back",
            extra={
                "event": "bundle.import.rolled_back",
                "phase": "database_write",
                "input_digest": projection.input_digest,
                "release_key": projection.release_key,
                "batch_id": str(batch_id),
                "failure_code": failure_code,
                "failure_reason": (
                    str(error)[:200] if isinstance(error, ReleasePublicationError) else None
                ),
                "exception_type": type(error).__name__,
                "sqlstate": getattr(original_error, "sqlstate", None),
                "constraint_name": getattr(diagnostic, "constraint_name", None),
                "database_table": getattr(diagnostic, "table_name", None),
                "database_column": getattr(diagnostic, "column_name", None),
                "outcome": "rolled_back",
            },
        )
        safe_detail = str(error) if isinstance(error, ReleasePublicationError) else failure_code
        error_type = StaleReleaseBaseError if isinstance(error, StaleReleaseBaseError) else ReleasePublicationError
        raise error_type(
            f"bundle import rolled back: {failure_code}: {safe_detail}"
        ) from None


def reconcile_release_projection(engine: Engine, projection: ReleaseProjection) -> dict[str, Any]:
    """Reconcile an exported projection against persisted rows without mutation."""

    with engine.connect() as connection:
        return _reconcile_database(connection, projection)
