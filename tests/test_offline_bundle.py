from __future__ import annotations

import json
import shutil
from pathlib import Path

from andromeda_api.application.importer.bundle import BundleReader, validate_bundle
from andromeda_api.application.importer.persistence import run_bundle_import

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


def test_release_bundle_archive_is_deterministic_and_lossless(tmp_path: Path) -> None:
    with BundleReader(BUNDLE) as reader:
        expected_digest = reader.input_digest
        expected_files = {item.relative_path: item.sha256 for item in reader.files}
        archive_format, archive_bytes, archive_sha256 = reader.release_archive()
    with BundleReader(BUNDLE) as reader:
        repeated_format, repeated_bytes, repeated_sha256 = reader.release_archive()

    assert archive_format == "directory_zip_v1"
    assert repeated_format == archive_format
    assert repeated_bytes == archive_bytes
    assert repeated_sha256 == archive_sha256

    archive_path = tmp_path / "release.zip"
    archive_path.write_bytes(archive_bytes)
    extracted = tmp_path / "exported"
    extracted.mkdir()
    with BundleReader(archive_path) as reader:
        assert {item.relative_path: item.sha256 for item in reader.files} == expected_files
        for relative_path in reader._file_names():
            destination = extracted / Path(relative_path)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(reader.read_bytes(relative_path))
    with BundleReader(extracted) as reader:
        assert reader.input_digest == expected_digest
        assert {item.relative_path: item.sha256 for item in reader.files} == expected_files


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
