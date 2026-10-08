"""Application use cases for validating and publishing reviewed releases."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any
from uuid import UUID

from andromeda_api.application.importer.bundle import BundleInputError, BundleReader, validate_bundle
from andromeda_api.application.importer.errors import BundleImportError
from andromeda_api.application.importer.mapping import MappingResult, project_bundle
from andromeda_api.application.settings import Settings, load_settings
from andromeda_db.connection import create_service_engine
from andromeda_db.repositories.release_publication import (
    ReleasePublicationError,
    publish_projection,
)

logger = logging.getLogger("andromeda_api.application.publication")


def _prepare_release_archive(projection: MappingResult) -> None:
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
    ) -> dict[str, Any]:
        if expected_active_release_id is not None and (
            not prepared_release.release_context_present
            or prepared_release.expected_base_release_id != expected_active_release_id
        ):
            raise BundleImportError("candidate base does not match the expected active release")
        _prepare_release_archive(prepared_release)
        settings = self.settings or load_settings()
        engine = create_service_engine(settings)
        try:
            return publish_projection(engine, settings, prepared_release, actor=actor)
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
) -> dict[str, Any]:
    """Publish a reviewed, materialized bundle through the shared application service."""

    prepared_release = project_bundle(input_dir)
    return PublicationApplicationService().publish_bundle(
        prepared_release,
        actor=actor,
        expected_active_release_id=expected_active_release_id,
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