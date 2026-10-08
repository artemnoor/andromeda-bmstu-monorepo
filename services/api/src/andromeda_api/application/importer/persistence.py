"""Compatibility entrypoint for the application publication use cases."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from andromeda_api.application.importer.errors import BundleImportError
from andromeda_api.application.publication import dry_run_bundle, publish_reviewed_bundle

logger = logging.getLogger("andromeda_api.application.importer")


def run_bundle_import(
    input_path: str,
    *,
    commit: bool,
    output_path: str | None = None,
) -> dict[str, Any]:
    """Preserve the CLI result contract while delegating writes to the shared service."""

    result = publish_reviewed_bundle(input_path) if commit else dry_run_bundle(input_path)
    if output_path:
        output = Path(output_path)
        if output.is_dir():
            output = output / "import-report.json"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        logger.info(
            "bundle import report written",
            extra={
                "event": "bundle.import.report_written",
                "phase": "output",
                "input_digest": result.get("input_digest"),
                "relative_file": str(output),
                "outcome": result.get("outcome"),
            },
        )
        result["report_path"] = str(output)
    return result

__all__ = ["BundleImportError", "run_bundle_import"]