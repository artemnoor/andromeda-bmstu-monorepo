from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from andromeda_parser.repair_admission_bundle import repair_bundle

SOURCE = Path(__file__).resolve().parents[1] / "data" / "bmstu-2026"


def _rows(path: Path, dataset: str) -> list[dict]:
    return [json.loads(line) for line in (path / "data" / f"{dataset}.jsonl").read_text(encoding="utf-8").splitlines()]


def _digest(path: Path) -> dict[str, str]:
    return {str(item.relative_to(path)): hashlib.sha256(item.read_bytes()).hexdigest() for item in path.rglob("*") if item.is_file()}


def test_repair_keeps_originals_and_targeted_records_and_is_deterministic(tmp_path: Path) -> None:
    original = _digest(SOURCE)
    first = tmp_path / "first"
    second = tmp_path / "second"
    report = repair_bundle(SOURCE, first)
    repair_bundle(SOURCE, second)
    assert _digest(SOURCE) == original
    assert _digest(first) == _digest(second)
    assert report["offering_count"] == 127
    assert report["offering_pool_count"] == 508
    assert report["shared_program_links"] == 10
    assert report["covered_catalog_programs"] == 118
    assert len(report["uncovered_catalog_programs"]) == 34
    assert all(row["reason"] for row in report["uncovered_catalog_programs"])
    original_targets = [row for row in _rows(SOURCE, "competition_pools") if row["quota_type"] == "targeted"]
    repaired_targets = [row for row in _rows(first, "competition_pools") if row["quota_type"] == "targeted"]
    assert repaired_targets == original_targets
    for dataset in ("educational_programs", "study_plans", "curriculum_items", "admission_statistics"):
        assert (first / "data" / f"{dataset}.jsonl").read_bytes() == (SOURCE / "data" / f"{dataset}.jsonl").read_bytes()
    original_offers = {row["external_key"]: row for row in _rows(SOURCE, "program_offerings")}
    for row in _rows(first, "program_offerings"):
        assert row["study_form"] == original_offers[row["external_key"]]["study_form"]
        assert row["language"] == original_offers[row["external_key"]]["language"]


def test_distinct_offering_quota_values_and_provenance_are_preserved(tmp_path: Path) -> None:
    output = tmp_path / "repaired"
    repair_bundle(SOURCE, output)
    pools = _rows(output, "competition_pools")
    by_offer = {row["program_offering_key"]: row for row in pools if row["quota_type"] == "special" and row.get("direction_code") == "01.03.03"}
    first = by_offer["offering:bmstu:2026:app8.1:p1:t1:r3"]
    second = by_offer["offering:bmstu:2026:app8.1:p1:t1:r4"]
    assert first["places"] == 2
    assert second["places"] == 4
    assert first["source_sha256"] == second["source_sha256"]
    assert first["source_locators"] == [{"page": 1, "table": 1, "row": 3}]
    assert not any(row["scope_level"] == "direction" and row["quota_type"] in {"special", "separate"} for row in pools)
    law = next(row for row in _rows(output, "program_offerings") if row["external_key"].endswith("p6:t1:r7"))
    assert law["direction_code"] == "40.05.03/40.05.01"
    assert law["source_row"][1] == "40.05.03/40.05.01"
    assert law["educational_program_key"] is not None
    original_reviews = (SOURCE / "manual_review.csv").read_text(encoding="utf-8")
    repaired_reviews = (output / "manual_review.csv").read_text(encoding="utf-8")
    assert "official_source_fetch_failed" in original_reviews
    assert "official_source_fetch_failed" in repaired_reviews


def test_changed_order_bytes_are_refused_before_creating_output(tmp_path: Path) -> None:
    output = tmp_path / "repaired"
    with pytest.raises(ValueError, match="hash"):
        repair_bundle(SOURCE, output, main_order_body=b"%PDF-1.4 changed document")
    assert not output.exists()


def test_input_and_nested_output_paths_are_refused(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="new|inside|nested"):
        repair_bundle(SOURCE, SOURCE)
    with pytest.raises(ValueError, match="new|inside|nested"):
        repair_bundle(SOURCE, SOURCE / "nested-repair")
    existing = tmp_path / "existing"
    existing.mkdir()
    with pytest.raises(ValueError, match="new|exist"):
        repair_bundle(SOURCE, existing)
