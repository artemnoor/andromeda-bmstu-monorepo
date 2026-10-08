"""Read-only release inspection/export and explicit legacy artifact adoption."""

from __future__ import annotations

import hashlib
import logging
import os
import shutil
import tempfile
from getpass import getuser
from pathlib import Path, PurePosixPath
from typing import Any
from uuid import UUID, uuid4

from andromeda_db.repositories.release_lifecycle import (
    ReleaseLifecycleError,
    adopt_legacy_archive,
    check_release_schema,
    get_release,
    get_release_archive,
)
from andromeda_db.repositories.release_lifecycle import (
    release_status as database_release_status,
)
from andromeda_db.repositories.release_lifecycle import (
    require_empty_active_slot as database_require_empty_active_slot,
)
from andromeda_db.repositories.release_lifecycle import (
    rollback_release as database_rollback_release,
)
from andromeda_db.repositories.release_publication import reconcile_release_projection

from andromeda_api.application.importer.bundle import BundleReader, validate_bundle
from andromeda_api.application.importer.mapping import project_bundle
from andromeda_api.application.importer.persistence import BundleImportError
from andromeda_api.application.publication import _prepare_release_archive
from andromeda_api.application.settings import Settings

logger = logging.getLogger("academic_data_service.release")


def _validated_release(engine: Any, release_id: UUID | None) -> dict[str, Any]:
    row = get_release(engine, release_id)
    if row is None:
        raise BundleImportError("requested academic data release was not found")
    if row["status"] != "committed" or row["reconciliation_status"] not in {
        "passed",
        "passed_with_gaps",
    }:
        raise BundleImportError("only committed and reconciled releases can be exported")
    return row


def _check_schema(engine: Any, settings: Settings) -> dict[str, Any]:
    try:
        return check_release_schema(engine, settings)
    except ReleaseLifecycleError as error:
        raise BundleImportError(str(error)) from error

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
    engine: Any,
    settings: Settings,
    *,
    output_path: str | Path,
    release_id: UUID | None = None,
) -> dict[str, Any]:
    """Export and verify a committed release's exact importer bundle."""

    identity = _check_schema(engine, settings)
    release = _validated_release(engine, release_id)
    artifact = get_release_archive(engine, release["id"])
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
    reconciliation = reconcile_release_projection(engine, projection)
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
    engine: Any,
    settings: Settings,
    *,
    release_id: UUID,
    input_path: str | Path,
) -> dict[str, Any]:
    """Attach a missing archive only when an input bundle exactly identifies a release."""

    identity = _check_schema(engine, settings)
    existing_release = get_release(engine, release_id)
    if existing_release is None or existing_release["status"] != "committed":
        raise BundleImportError("legacy archive target must be a committed release")
    projection = project_bundle(input_path, mapper_version=existing_release["mapper_version"])
    _prepare_release_archive(projection)
    try:
        reconciliation = adopt_legacy_archive(
            engine, release_id=release_id, projection=projection
        )
    except ReleaseLifecycleError as error:
        raise BundleImportError(str(error)) from error

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


def release_status(engine: Any, settings: Settings) -> dict[str, Any]:
    """Return safe metadata for the active release without exporting bundle contents."""

    try:
        return database_release_status(engine, settings)
    except ReleaseLifecycleError as error:
        raise BundleImportError(str(error)) from error


def require_empty_active_slot(engine: Any, settings: Settings) -> None:
    """Fail explicit bootstrap when any active release already exists."""

    try:
        database_require_empty_active_slot(engine, settings)
    except ReleaseLifecycleError as error:
        raise BundleImportError(str(error)) from error


def rollback_active_release(
    engine: Any,
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
    identity = _check_schema(engine, settings)

    artifact = get_release_archive(engine, target_release_id)
    if artifact is None:
        raise BundleImportError("rollback target has no verified release bundle archive")
    with tempfile.TemporaryDirectory(prefix="andromeda-release-rollback-") as temporary:
        output_path = Path(temporary) / (
            "target.zip" if artifact["archive_format"] == "source_zip_v1" else "target"
        )
        verified = export_release_bundle(
            engine,
            settings,
            output_path=output_path,
            release_id=target_release_id,
        )

    try:
        result = database_rollback_release(
            engine,
            target_release_id=target_release_id,
            expected_active_release_id=expected_active_release_id,
            verified_source_bundle_sha256=verified["source_bundle_sha256"],
            reason=reason,
            actor=actor_name,
        )
    except ReleaseLifecycleError as error:
        raise BundleImportError(str(error)) from error
    if result["outcome"] == "no_op":
        return result
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
        **result,
        "database_name": identity["database_name"],
    }
