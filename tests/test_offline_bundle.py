from __future__ import annotations

import json
import shutil
from pathlib import Path

from academic_data_service.importer.bundle import BundleReader, validate_bundle
from academic_data_service.importer.persistence import run_bundle_import


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BUNDLE = PROJECT_ROOT / "data" / "bmstu-2026"


def test_published_bmstu_bundle_validates() -> None:
    report = validate_bundle(BUNDLE)

    assert report["valid"] is True, report["errors"]
    assert report["errors"] == []
    with BundleReader(BUNDLE) as reader:
        assert len(reader.files) >= 30


def test_dry_run_maps_without_database_configuration(monkeypatch) -> None:
    monkeypatch.delenv("ACADEMIC_DATA_DATABASE_URL", raising=False)
    result = run_bundle_import(str(BUNDLE), commit=False)

    assert result["outcome"] == "dry_run"
    assert result["database_connection_opened"] is False
    assert result["network_requests"] == 0
    assert result["mapping"]["typed_row_counts"]["universities"] == 1
    assert result["mapping"]["typed_row_counts"]["directions"] == 53


def test_validator_rejects_personal_fields(tmp_path: Path) -> None:
    unsafe_bundle = tmp_path / "bundle-with-personal-field"
    shutil.copytree(BUNDLE, unsafe_bundle)
    directions = unsafe_bundle / "data" / "directions.jsonl"
    lines = directions.read_text(encoding="utf-8").splitlines()
    first_record = json.loads(lines[0])
    first_record["email"] = "student@example.invalid"
    lines[0] = json.dumps(first_record, ensure_ascii=False)
    directions.write_text("\n".join(lines) + "\n", encoding="utf-8")

    report = validate_bundle(unsafe_bundle)

    assert report["valid"] is False
    assert report["errors"]
