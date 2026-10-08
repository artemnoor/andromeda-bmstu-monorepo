"""Compose pure ingestion commands with the canonical API application use cases."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from andromeda_parser.cli import main as ingestion_main

from andromeda_ingestion_cli.proposal_workflow import (
    apply_candidate_diff,
    publication_commands,
    register_candidate_bundle,
    review_candidate_bundle,
)


class ApiIngestionOperations:
    """Adapter from ingestion's operator port to existing application services."""

    def assert_empty_active_slot(self) -> None:
        from andromeda_api.application.publication import assert_empty_active_slot

        assert_empty_active_slot()

    def get_release_status(self) -> dict[str, Any]:
        from andromeda_api.application.publication import get_release_status

        return get_release_status()

    def export_active_release_bundle(self, output_path: Path) -> dict[str, Any]:
        from andromeda_api.application.publication import export_active_release_bundle

        return export_active_release_bundle(output_path)

    def validate_import_bundle(self, input_path: Path) -> dict[str, Any]:
        from andromeda_api.application.publication import validate_import_bundle

        return validate_import_bundle(input_path)

    def project_bundle(self, input_path: Path) -> Any:
        from andromeda_api.application.importer.mapping import project_bundle

        return project_bundle(str(input_path))

    def dry_run_bundle(self, input_path: Path) -> dict[str, Any]:
        from andromeda_api.application.publication import dry_run_bundle

        return dry_run_bundle(input_path)

    def register_candidate_bundle(self, input_path: Path, *, actor: str) -> list[dict[str, Any]]:
        return register_candidate_bundle(input_path, actor=actor)

    def apply_candidate_diff(
        self,
        input_path: Path,
        report: dict[str, Any],
        *,
        actor: str,
    ) -> None:
        apply_candidate_diff(input_path, report, actor=actor)

    def review_candidate_bundle(
        self,
        candidate_path: Path,
        decisions_path: Path,
        reviewed_path: Path,
        *,
        actor: str,
    ) -> list[dict[str, Any]]:
        return review_candidate_bundle(
            candidate_path,
            decisions_path,
            reviewed_path,
            actor=actor,
        )

    def publish_reviewed_bundle(self, input_path: Path) -> dict[str, Any]:
        from getpass import getuser

        from andromeda_api.application.publication import publish_reviewed_bundle

        actor = getuser()
        proposals, idempotency_key, expected_active_release_id = publication_commands(
            input_path,
            actor=actor,
        )
        return publish_reviewed_bundle(
            input_path,
            actor=actor,
            expected_active_release_id=expected_active_release_id,
            proposals=proposals,
            idempotency_key=idempotency_key,
        )


def main(argv: list[str] | None = None) -> int:
    """Run the compatible command grammar through its outer application adapter."""

    return ingestion_main(argv, application=ApiIngestionOperations())
