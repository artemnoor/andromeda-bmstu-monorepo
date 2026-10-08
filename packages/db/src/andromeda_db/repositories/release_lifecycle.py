"""Database repositories for release archive and activation lifecycle operations."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Protocol
from uuid import UUID, uuid4

from sqlalchemy import Engine, insert, select, text, update
from sqlalchemy.exc import IntegrityError

from andromeda_db.connection import verify_server_identity
from andromeda_db.models.models import (
    ActiveDataReleaseModel,
    DataReleaseBundleArtifactModel,
    DataReleaseModel,
    ReleaseActivationEventModel,
)
from andromeda_db.repositories.release_publication import (
    RELEASE_PUBLICATION_LOCK_KEY,
    _reconcile_database,
)
from andromeda_db.revisions import SERVICE_SCHEMA_HEAD, current_schema_revision


class ReleaseLifecycleError(RuntimeError):
    """A release lifecycle request failed its database invariants."""


class ReleaseProjection(Protocol):
    release_id: UUID
    input_digest: str
    report: dict[str, Any]
    release_archive_format: str
    release_archive_bytes: bytes
    release_archive_sha256: str
    table_rows: dict[str, list[dict[str, Any]]]


def _identity(engine: Engine, settings: Any) -> dict[str, Any]:
    with engine.connect() as connection:
        identity = verify_server_identity(connection, settings)
    revision = current_schema_revision(engine)
    if revision != SERVICE_SCHEMA_HEAD:
        raise ReleaseLifecycleError("service schema must be upgraded before release operations")
    return {**identity, "schema_revision": revision}


def get_release(engine: Engine, release_id: UUID | None = None) -> dict[str, Any] | None:
    release = DataReleaseModel.__table__
    active = ActiveDataReleaseModel.__table__
    query = select(
        release.c.id,
        release.c.release_key,
        release.c.source_bundle_sha256,
        release.c.mapper_version,
        release.c.status,
        release.c.reconciliation_status,
        release.c.reconciliation_summary,
        release.c.created_at,
        release.c.committed_at,
    )
    if release_id is None:
        query = query.select_from(active.join(release, active.c.release_id == release.c.id)).where(
            active.c.slot_key == "active"
        )
    else:
        query = query.where(release.c.id == release_id)
    with engine.connect() as connection:
        row = connection.execute(query).mappings().one_or_none()
    return dict(row) if row is not None else None


def get_release_archive(engine: Engine, release_id: UUID) -> dict[str, Any] | None:
    artifact = DataReleaseBundleArtifactModel.__table__
    with engine.connect() as connection:
        row = connection.execute(
            select(artifact).where(artifact.c.release_id == release_id)
        ).mappings().one_or_none()
    return dict(row) if row is not None else None


def release_status(engine: Engine, settings: Any) -> dict[str, Any]:
    identity = _identity(engine, settings)
    release = get_release(engine)
    if release is None:
        raise ReleaseLifecycleError("no active release; use explicit --bootstrap for the first release")
    if release["status"] != "committed" or release["reconciliation_status"] not in {
        "passed", "passed_with_gaps"
    }:
        raise ReleaseLifecycleError("only committed and reconciled releases can be inspected")
    archive = get_release_archive(engine, release["id"])
    return {
        "release_id": str(release["id"]),
        "release_key": release["release_key"],
        "source_bundle_sha256": release["source_bundle_sha256"],
        "status": release["status"],
        "reconciliation_status": release["reconciliation_status"],
        "archive_available": archive is not None,
        "archive_format": archive["archive_format"] if archive is not None else None,
        "database_name": identity["database_name"],
        "schema_revision": identity["schema_revision"],
    }


def require_empty_active_slot(engine: Engine, settings: Any) -> None:
    _identity(engine, settings)
    active = ActiveDataReleaseModel.__table__
    with engine.connect() as connection:
        active_id = connection.execute(
            select(active.c.release_id).where(active.c.slot_key == "active")
        ).scalar_one_or_none()
    if active_id is not None:
        raise ReleaseLifecycleError("bootstrap is allowed only when no active release exists")


def adopt_legacy_archive(
    engine: Engine,
    *,
    release_id: UUID,
    projection: ReleaseProjection,
) -> dict[str, Any]:
    release_table = DataReleaseModel.__table__
    artifact_table = DataReleaseBundleArtifactModel.__table__
    try:
        with engine.begin() as connection:
            release = connection.execute(
                select(release_table)
                .where(release_table.c.id == release_id)
                .with_for_update()
            ).mappings().one_or_none()
            if release is None or release["status"] != "committed":
                raise ReleaseLifecycleError("legacy archive target must be a committed release")
            if release["reconciliation_status"] not in {"passed", "passed_with_gaps"}:
                raise ReleaseLifecycleError("legacy archive target is not reconciled")
            if (
                projection.release_id != release_id
                or projection.input_digest != release["source_bundle_sha256"]
                or projection.report["mapper_version"] != release["mapper_version"]
            ):
                raise ReleaseLifecycleError("supplied bundle does not exactly match the selected release")
            existing = connection.execute(
                select(artifact_table.c.release_id).where(artifact_table.c.release_id == release_id)
            ).scalar_one_or_none()
            if existing is not None:
                raise ReleaseLifecycleError("selected release already has a retained bundle")
            reconciliation = _reconcile_database(connection, projection)
            connection.execute(
                insert(artifact_table).values(
                    release_id=release_id,
                    archive_format=projection.release_archive_format,
                    archive_bytes=projection.release_archive_bytes,
                    archive_sha256=projection.release_archive_sha256,
                )
            )
    except ReleaseLifecycleError:
        raise
    except IntegrityError as error:
        raise ReleaseLifecycleError("legacy bundle archive was concurrently adopted") from error
    return reconciliation


def rollback_release(
    engine: Engine,
    *,
    target_release_id: UUID,
    expected_active_release_id: UUID,
    verified_source_bundle_sha256: str,
    reason: str,
    actor: str,
) -> dict[str, Any]:
    active_table = ActiveDataReleaseModel.__table__
    release_table = DataReleaseModel.__table__
    activation_table = ReleaseActivationEventModel.__table__
    now = datetime.now(UTC)
    with engine.begin() as connection:
        connection.execute(
            text("SELECT pg_advisory_xact_lock(:lock_key)"),
            {"lock_key": RELEASE_PUBLICATION_LOCK_KEY},
        )
        active_id = connection.execute(
            select(active_table.c.release_id)
            .where(active_table.c.slot_key == "active")
            .with_for_update()
        ).scalar_one_or_none()
        if active_id != expected_active_release_id:
            raise ReleaseLifecycleError(
                "rollback base is stale: active release changed; inspect and retry explicitly"
            )
        target = connection.execute(
            select(release_table.c.id, release_table.c.source_bundle_sha256).where(
                release_table.c.id == target_release_id,
                release_table.c.status == "committed",
                release_table.c.reconciliation_status.in_(("passed", "passed_with_gaps")),
            )
        ).one_or_none()
        if target is None or target.source_bundle_sha256 != verified_source_bundle_sha256:
            raise ReleaseLifecycleError("rollback target changed or is no longer a verified release")
        if active_id == target_release_id:
            return {
                "outcome": "no_op",
                "active_release_id": str(active_id),
                "target_release_id": str(target_release_id),
                "reason": "rollback_target_is_already_active",
            }
        connection.execute(
            update(active_table)
            .where(active_table.c.slot_key == "active")
            .values(release_id=target_release_id, changed_at=now)
        )
        connection.execute(
            insert(activation_table).values(
                id=uuid4(),
                operation="rollback",
                previous_release_id=active_id,
                active_release_id=target_release_id,
                expected_active_release_id=expected_active_release_id,
                source_bundle_sha256=target.source_bundle_sha256,
                actor=actor,
                reason=reason,
                occurred_at=now,
            )
        )
    return {
        "outcome": "rolled_back",
        "previous_active_release_id": str(expected_active_release_id),
        "active_release_id": str(target_release_id),
        "source_bundle_sha256": verified_source_bundle_sha256,
        "actor": actor,
        "reason": reason,
    }

def check_release_schema(engine: Engine, settings: Any) -> dict[str, Any]:
    """Verify database identity and release schema head for an application use case."""

    return _identity(engine, settings)
