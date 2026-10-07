"""Read-only release inspection/export and explicit legacy artifact adoption."""

from __future__ import annotations

import hashlib
import logging
import os
import shutil
import tempfile
from datetime import UTC, datetime
from getpass import getuser
from pathlib import Path, PurePosixPath
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import Engine, insert, select, text, update
from sqlalchemy.exc import IntegrityError

from academic_data_service.importer.bundle import BundleReader, validate_bundle
from academic_data_service.importer.mapping import project_bundle
from academic_data_service.importer.persistence import (
    BundleImportError,
    RELEASE_PUBLICATION_LOCK_KEY,
    _prepare_release_archive,
    _reconcile_database,
)
from academic_data_service.infrastructure.database.connection import verify_server_identity
from academic_data_service.infrastructure.database.models import (
    ActiveDataReleaseModel,
    DataReleaseBundleArtifactModel,
    DataReleaseModel,
    ReleaseActivationEventModel,
)
from academic_data_service.infrastructure.database.revisions import (
    SERVICE_SCHEMA_HEAD,
    current_schema_revision,
)
from academic_data_service.settings import Settings

logger = logging.getLogger("academic_data_service.release")


def _release_query(release_id: UUID | None):
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
        return query.select_from(active.join(release, active.c.release_id == release.c.id)).where(
            active.c.slot_key == "active"
        )
    return query.where(release.c.id == release_id)


def _validated_release(connection: Any, release_id: UUID | None) -> dict[str, Any]:
    row = connection.execute(_release_query(release_id)).mappings().one_or_none()
    if row is None:
        raise BundleImportError("requested academic data release was not found")
    if row["status"] != "committed" or row["reconciliation_status"] not in {
        "passed",
        "passed_with_gaps",
    }:
        raise BundleImportError("only committed and reconciled releases can be exported")
    return dict(row)


def _check_schema(engine: Engine, settings: Settings) -> dict[str, Any]:
    with engine.connect() as connection:
        identity = verify_server_identity(connection, settings)
    revision = current_schema_revision(engine)
    if revision != SERVICE_SCHEMA_HEAD:
        raise BundleImportError("service schema must be upgraded before release operations")
    return {**identity, "schema_revision": revision}


def _write_export(
    *, archive_format: str, archive_bytes: bytes, target: Path, expected_digest: str
) -> Path:
    target = target.expanduser()
    if target.exists() or target.is_symlink():
        raise BundleImportError("release export output must not already exist")
    target.parent.mkdir(parents=True, exist_ok=True)
    parent = target.parent.resolve(strict=True)
    target = parent / target.name
    if archive_format == "source_zip_v1":
        if target.suffix.casefold() != ".zip":
            raise BundleImportError("this release was imported from a ZIP; export output must end in .zip")
        temp_path = parent / f".{target.name}.{uuid4().hex}.tmp"
        try:
            temp_path.write_bytes(archive_bytes)
            with BundleReader(temp_path) as reader:
                if reader.input_digest != expected_digest:
                    raise BundleImportError("exported ZIP digest does not match its release")
                report = validate_bundle(temp_path)
                if not report.get("valid"):
                    raise BundleImportError("archived release bundle failed validation")
            os.replace(temp_path, target)
            return target
        except Exception:
            temp_path.unlink(missing_ok=True)
            raise

    if archive_format != "directory_zip_v1":
        raise BundleImportError("unsupported release bundle archive format")
    temp_dir = Path(tempfile.mkdtemp(prefix=f".{target.name}.export-", dir=parent))
    temp_zip = parent / f".{target.name}.{uuid4().hex}.zip"
    try:
        temp_zip.write_bytes(archive_bytes)
        with BundleReader(temp_zip) as archive_reader:
            for relative_path in archive_reader._file_names():
                path = PurePosixPath(relative_path)
                if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
                    raise BundleImportError("archived release contains an unsafe path")
                destination = temp_dir.joinpath(*path.parts)
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(archive_reader.read_bytes(relative_path))
        with BundleReader(temp_dir) as exported_reader:
            if exported_reader.input_digest != expected_digest:
                raise BundleImportError("exported directory digest does not match its release")
        report = validate_bundle(temp_dir)
        if not report.get("valid"):
            raise BundleImportError("archived release bundle failed validation")
        project_bundle(temp_dir)
        os.replace(temp_dir, target)
        return target
    except Exception:
        if temp_dir.exists():
            shutil.rmtree(temp_dir)
        raise
    finally:
        temp_zip.unlink(missing_ok=True)


def export_release_bundle(
    engine: Engine,
    settings: Settings,
    *,
    output_path: str | Path,
    release_id: UUID | None = None,
) -> dict[str, Any]:
    """Export and verify a committed release's exact importer bundle."""

    identity = _check_schema(engine, settings)
    release_table = DataReleaseModel.__table__
    artifact_table = DataReleaseBundleArtifactModel.__table__
    with engine.connect() as connection:
        release = _validated_release(connection, release_id)
        artifact = connection.execute(
            select(artifact_table).where(artifact_table.c.release_id == release["id"])
        ).mappings().one_or_none()
        if artifact is None:
            raise BundleImportError(
                "release has no retained bundle; explicitly adopt an exact-digest legacy bundle"
            )
        archive_bytes = bytes(artifact["archive_bytes"])
        archive_sha256 = hashlib.sha256(archive_bytes).hexdigest()
        if archive_sha256 != artifact["archive_sha256"]:
            raise BundleImportError("stored release archive failed its SHA-256 check")
        archive_metadata = (release.get("reconciliation_summary") or {}).get(
            "release_bundle_archive", {}
        )
        if archive_metadata and (
            archive_metadata.get("sha256") != archive_sha256
            or archive_metadata.get("format") != artifact["archive_format"]
            or archive_metadata.get("byte_size") != len(archive_bytes)
        ):
            raise BundleImportError("release archive metadata does not reconcile")

    output = _write_export(
        archive_format=artifact["archive_format"],
        archive_bytes=archive_bytes,
        target=Path(output_path),
        expected_digest=release["source_bundle_sha256"],
    )
    projection = project_bundle(output, mapper_version=release["mapper_version"])
    if projection.release_id != release["id"] or projection.input_digest != release[
        "source_bundle_sha256"
    ]:
        raise BundleImportError("exported bundle identity does not match selected release")
    with engine.connect() as connection:
        reconciliation = _reconcile_database(connection, projection)
    logger.info(
        "release bundle exported and reconciled",
        extra={
            "event": "release.bundle.exported",
            "release_id": str(release["id"]),
            "digest_prefix": release["source_bundle_sha256"][:12],
            "archive_bytes": len(archive_bytes),
            "output_path": str(output),
            "outcome": "exported",
        },
    )
    return {
        "outcome": "exported",
        "release_id": str(release["id"]),
        "release_key": release["release_key"],
        "source_bundle_sha256": release["source_bundle_sha256"],
        "archive_sha256": archive_sha256,
        "archive_byte_size": len(archive_bytes),
        "output_path": str(output),
        "database_name": identity["database_name"],
        "schema_revision": identity["schema_revision"],
        "reconciliation": reconciliation,
    }


def adopt_legacy_release_bundle(
    engine: Engine,
    settings: Settings,
    *,
    release_id: UUID,
    input_path: str | Path,
) -> dict[str, Any]:
    """Attach a missing archive only when an input bundle exactly identifies a release."""

    identity = _check_schema(engine, settings)
    with engine.connect() as connection:
        existing_release = connection.execute(
            select(DataReleaseModel.mapper_version, DataReleaseModel.status).where(
                DataReleaseModel.id == release_id
            )
        ).one_or_none()
    if existing_release is None or existing_release.status != "committed":
        raise BundleImportError("legacy archive target must be a committed release")
    projection = project_bundle(input_path, mapper_version=existing_release.mapper_version)
    _prepare_release_archive(projection)
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
                raise BundleImportError("legacy archive target must be a committed release")
            if release["reconciliation_status"] not in {"passed", "passed_with_gaps"}:
                raise BundleImportError("legacy archive target is not reconciled")
            if (
                projection.release_id != release_id
                or projection.input_digest != release["source_bundle_sha256"]
                or projection.report["mapper_version"] != release["mapper_version"]
            ):
                raise BundleImportError("supplied bundle does not exactly match the selected release")
            existing = connection.execute(
                select(artifact_table.c.release_id).where(
                    artifact_table.c.release_id == release_id
                )
            ).scalar_one_or_none()
            if existing is not None:
                raise BundleImportError("selected release already has a retained bundle")
            reconciliation = _reconcile_database(connection, projection)
            connection.execute(
                insert(artifact_table).values(
                    release_id=release_id,
                    archive_format=projection.release_archive_format,
                    archive_bytes=projection.release_archive_bytes,
                    archive_sha256=projection.release_archive_sha256,
                )
            )
    except IntegrityError as error:
        raise BundleImportError("legacy bundle archive was concurrently adopted") from error

    logger.info(
        "legacy release bundle adopted by exact digest",
        extra={
            "event": "release.bundle.adopted",
            "release_id": str(release_id),
            "digest_prefix": projection.input_digest[:12],
            "archive_bytes": len(projection.release_archive_bytes),
            "outcome": "adopted",
        },
    )
    return {
        "outcome": "adopted",
        "release_id": str(release_id),
        "source_bundle_sha256": projection.input_digest,
        "archive_sha256": projection.release_archive_sha256,
        "archive_byte_size": len(projection.release_archive_bytes),
        "database_name": identity["database_name"],
        "schema_revision": identity["schema_revision"],
        "reconciliation": reconciliation,
    }


def release_status(engine: Engine, settings: Settings) -> dict[str, Any]:
    """Return safe metadata for the active release without exporting bundle contents."""

    identity = _check_schema(engine, settings)
    with engine.connect() as connection:
        active_id = connection.execute(
            select(ActiveDataReleaseModel.release_id).where(
                ActiveDataReleaseModel.slot_key == "active"
            )
        ).scalar_one_or_none()
        if active_id is None:
            raise BundleImportError("no active release; use explicit --bootstrap for the first release")
        release = _validated_release(connection, None)
        archive_id = connection.execute(
            select(
                DataReleaseBundleArtifactModel.release_id,
                DataReleaseBundleArtifactModel.archive_format,
            ).where(
                DataReleaseBundleArtifactModel.release_id == release["id"]
            )
        ).one_or_none()
    return {
        "release_id": str(release["id"]),
        "release_key": release["release_key"],
        "source_bundle_sha256": release["source_bundle_sha256"],
        "status": release["status"],
        "reconciliation_status": release["reconciliation_status"],
        "archive_available": archive_id is not None,
        "archive_format": archive_id.archive_format if archive_id is not None else None,
        "database_name": identity["database_name"],
        "schema_revision": identity["schema_revision"],
    }


def require_empty_active_slot(engine: Engine, settings: Settings) -> None:
    """Fail explicit bootstrap when any active release already exists."""

    _check_schema(engine, settings)
    with engine.connect() as connection:
        active_id = connection.execute(
            select(ActiveDataReleaseModel.release_id).where(
                ActiveDataReleaseModel.slot_key == "active"
            )
        ).scalar_one_or_none()
    if active_id is not None:
        raise BundleImportError("bootstrap is allowed only when no active release exists")


def rollback_active_release(
    engine: Engine,
    settings: Settings,
    *,
    target_release_id: UUID,
    expected_active_release_id: UUID,
    reason: str,
    actor: str | None = None,
) -> dict[str, Any]:
    """Switch the active pointer to a verified immutable release with an audit event."""

    reason = reason.strip()
    actor_name = (actor or getuser()).strip()
    if not reason or len(reason) > 2000:
        raise BundleImportError("rollback reason must contain 1 to 2000 characters")
    if not actor_name or len(actor_name) > 256:
        raise BundleImportError("operator identity must contain 1 to 256 characters")
    _check_schema(engine, settings)

    with engine.connect() as connection:
        artifact_format = connection.execute(
            select(DataReleaseBundleArtifactModel.archive_format).where(
                DataReleaseBundleArtifactModel.release_id == target_release_id
            )
        ).scalar_one_or_none()
    if artifact_format is None:
        raise BundleImportError("rollback target has no verified release bundle archive")
    with tempfile.TemporaryDirectory(prefix="andromeda-release-rollback-") as temporary:
        output_path = Path(temporary) / (
            "target.zip" if artifact_format == "source_zip_v1" else "target"
        )
        verified = export_release_bundle(
            engine,
            settings,
            output_path=output_path,
            release_id=target_release_id,
        )

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
            raise BundleImportError(
                "rollback base is stale: active release changed; inspect and retry explicitly"
            )
        target = connection.execute(
            select(release_table.c.id, release_table.c.source_bundle_sha256).where(
                release_table.c.id == target_release_id,
                release_table.c.status == "committed",
                release_table.c.reconciliation_status.in_(("passed", "passed_with_gaps")),
            )
        ).one_or_none()
        if target is None or target.source_bundle_sha256 != verified["source_bundle_sha256"]:
            raise BundleImportError("rollback target changed or is no longer a verified release")
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
                actor=actor_name,
                reason=reason,
                occurred_at=now,
            )
        )
    logger.info(
        "active release rolled back to verified release",
        extra={
            "event": "release.rollback.completed",
            "previous_release_id": str(expected_active_release_id),
            "active_release_id": str(target_release_id),
            "actor": actor_name,
            "outcome": "rolled_back",
        },
    )
    return {
        "outcome": "rolled_back",
        "previous_active_release_id": str(expected_active_release_id),
        "active_release_id": str(target_release_id),
        "source_bundle_sha256": verified["source_bundle_sha256"],
        "actor": actor_name,
        "reason": reason,
        "database_name": verified["database_name"],
    }
