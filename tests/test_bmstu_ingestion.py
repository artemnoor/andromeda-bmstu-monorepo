from __future__ import annotations

import csv
import hashlib
import json
import re
from pathlib import Path

import fitz
import httpx
import pytest
from bs4 import BeautifulSoup

from academic_data_service.importer.bundle import validate_bundle
from academic_data_service.importer.mapping import BundleMappingError, project_bundle
from andromeda.ingestion.universities.bmstu.fetch import FetchConfig, Fetcher
from andromeda.ingestion.pdf_policy import PdfResourceError, validate_page_count, validate_pdf_payload
from andromeda_parser.bundle import (
    build_candidate_bundle,
    dry_run_import,
    materialize_reviewed_bundle,
    validate_import_bundle,
)
from andromeda_parser.ingest import (
    IngestionError,
    _RedactingFilter,
    capture_sources,
    parse_capture,
    write_parse_report,
)


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "tests" / "fixtures" / "bmstu" / "ingestion"
BASE_BUNDLE = ROOT / "data" / "bmstu-2026"


def _fixture_parse_report(tmp_path: Path) -> Path:
    capture = capture_sources(
        mode="fixture",
        fixture_dir=FIXTURE_DIR,
        output_dir=tmp_path / "capture",
    )
    assert capture.snapshot_count == 6
    report = parse_capture(capture.capture_dir)
    output = tmp_path / "parsed.json"
    write_parse_report(report, output)
    return output


def test_fixture_capture_and_parse_are_offline_and_reproducible(tmp_path: Path, monkeypatch) -> None:
    def fail_if_network(*_args, **_kwargs):
        raise AssertionError("fixture capture attempted network access")

    monkeypatch.setattr(Fetcher, "_fetch_http", fail_if_network)
    report_path = _fixture_parse_report(tmp_path)
    parsed = json.loads(report_path.read_text(encoding="utf-8"))

    assert parsed["source_capture_digest"] == "73910bcd959a80fa925227c27ace9a2122cf5fc4f47e368858b666cf2b5c01cd"
    assert len(parsed["sources"]) == 6
    assert parsed["source_gaps"] == []
    assert len(parsed["normalized"]["programs"]) == 2
    assert len(parsed["normalized"]["curricula"]) == 2
    assert len(parsed["normalized"]["disciplines"]) == 101
    assert sum(len(item["items"]) for item in parsed["normalized"]["curricula"]) == 212
    assert all(len(item["sha256"]) == 64 for item in parsed["sources"])
    assert "body" not in parsed


def test_checked_in_source_fixtures_are_redacted_with_hash_provenance() -> None:
    manifest = json.loads((FIXTURE_DIR / "source_manifest.json").read_text(encoding="utf-8"))
    assert manifest["fixture_redaction"]["policy"]
    assert len(manifest["snapshots"]) == 6
    email_pattern = re.compile(rb"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b")
    for snapshot in manifest["snapshots"]:
        fixture_path = FIXTURE_DIR / snapshot["body_path"]
        body = fixture_path.read_bytes()
        assert snapshot["fixture_sanitized"] is True
        assert re.fullmatch(r"[0-9a-f]{64}", snapshot["source_sha256"])
        assert hashlib.sha256(body).hexdigest() == snapshot["content_sha256"]
        assert not email_pattern.search(body)

    detail_soup = BeautifulSoup((FIXTURE_DIR / "detail.html").read_bytes(), "html.parser")
    detail = json.loads(detail_soup.find("script", id="__NEXT_DATA__").string)
    chairs = detail["props"]["initialState"]["bachelorMajorsDetails"]["data"]["chairs"]["items"]
    member_names = [member["name"] for chair in chairs for member in chair.get("members", [])]
    assert member_names and set(member_names) == {"[PERSONAL_NAME_REDACTED]"}


def test_direct_http_is_rate_limited_and_browser_fallback_is_disabled() -> None:
    class Clock:
        value = 0.0

        def __call__(self) -> float:
            return self.value

        def sleep(self, delay: float) -> None:
            self.value += delay

    clock = Clock()
    request_times: list[float] = []

    def respond(request: httpx.Request) -> httpx.Response:
        request_times.append(clock())
        return httpx.Response(200, text="ok", request=request)

    fetcher = Fetcher(
        FetchConfig(browser_mode="never", request_interval_seconds=1.0, retries=0),
        transport=httpx.MockTransport(respond),
        resolver=lambda _host: ["93.184.216.34"],
        sleep_fn=clock.sleep,
        clock_fn=clock,
    )
    try:
        first = fetcher.fetch("https://bmstu.ru/catalog")
        second = fetcher.fetch("https://bmstu.ru/catalog")
        assert first.ok and second.ok
        assert request_times == [0.0, 1.0]
        with pytest.raises(ValueError, match="browser fetching is disabled"):
            fetcher.fetch("https://bmstu.ru/catalog", force_browser=True)
        assert request_times == [0.0, 1.0]
    finally:
        fetcher.close()


def test_redacting_filter_strips_query_tokens_and_secret_values() -> None:
    import logging

    record = logging.LogRecord(
        "test", logging.DEBUG, "test.py", 1,
        "request https://bmstu.ru/path?token=abc&offset=2 api_key=xyz",
        (), None,
    )
    assert _RedactingFilter().filter(record)
    result = record.getMessage()
    assert "abc" not in result and "xyz" not in result
    assert "[REDACTED]" in result


def test_pdf_bounds_and_text_extraction() -> None:
    document = fitz.open()
    page = document.new_page()
    page.insert_text((72, 72), "BMSTU synthetic curriculum test")
    body = document.tobytes()
    document.close()

    validate_pdf_payload(body)
    validate_page_count(1)
    with pytest.raises(PdfResourceError):
        validate_pdf_payload(b"not a pdf")
    with pytest.raises(PdfResourceError):
        validate_page_count(501)


def test_candidate_bundle_requires_review_and_preserves_base_facts(tmp_path: Path) -> None:
    parsed_path = _fixture_parse_report(tmp_path)
    candidate_dir = tmp_path / "candidate"
    result = build_candidate_bundle(
        base_bundle=BASE_BUNDLE,
        parse_report_path=parsed_path,
        output_dir=candidate_dir,
    )
    candidate_key = result["candidate_key"]
    assert result["validation"]["valid"]
    assert result["validation"]["counts"]["normalized_records"] == 21_912
    assert not list(candidate_dir.rglob("*.pdf"))
    assert validate_bundle(candidate_dir)["source_artifacts"]["saved_files_present"] == 0
    with pytest.raises(IngestionError, match="unreviewed candidate"):
        validate_import_bundle(candidate_dir)
    with pytest.raises(BundleMappingError, match="no import mapping"):
        project_bundle(candidate_dir)

    decisions = tmp_path / "review.csv"
    with decisions.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=("external_key", "decision", "reviewed_at"))
        writer.writeheader()
        writer.writerow(
            {
                "external_key": candidate_key,
                "decision": "accept_observation",
                "reviewed_at": "2026-10-06T00:00:00+00:00",
            }
        )

    reviewed_dir = tmp_path / "reviewed"
    materialized = materialize_reviewed_bundle(
        candidate_dir=candidate_dir,
        decisions_path=decisions,
        output_dir=reviewed_dir,
    )
    assert materialized["accepted"] == 1
    assert materialized["validation"]["valid"]
    assert validate_import_bundle(reviewed_dir)["valid"]

    dry_run = dry_run_import(reviewed_dir)
    assert dry_run["outcome"] == "dry_run"
    assert dry_run["database_connection_opened"] is False
    assert dry_run["network_requests"] == 0
    typed_counts = dry_run["mapping"]["typed_row_counts"]
    for base_file in (BASE_BUNDLE / "data").glob("*.jsonl"):
        if base_file.name == "admission_information_source_tables.jsonl":
            continue
        assert (reviewed_dir / "data" / base_file.name).read_bytes() == base_file.read_bytes()
    assert typed_counts["universities"] == 1
    assert typed_counts["directions"] == 53
    assert typed_counts["departments"] == 77
    assert typed_counts["educational_programs"] == 152
    assert typed_counts["study_plans"] == 152
    assert typed_counts["curriculum_items"] == 14_165
    assert typed_counts["admission_requirement_sets"] == 81
    assert typed_counts["admission_requirement_nodes"] == 405
    assert typed_counts["source_artifacts"] == 504
    assert typed_counts["source_observations"] == 23_027


def test_candidate_rejects_applicant_and_olympiad_payloads() -> None:
    from andromeda_parser.ingest import _assert_safe_payload

    with pytest.raises(IngestionError, match="personal field"):
        _assert_safe_payload({"applicant_id": "123456"})
    with pytest.raises(IngestionError, match="olympiad fields"):
        _assert_safe_payload({"olympiad_result": "not for publication"})
