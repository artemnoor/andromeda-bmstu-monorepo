from __future__ import annotations

import csv
from decimal import Decimal
import hashlib
import json
import re
import shutil
from pathlib import Path
from typing import Any

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
from andromeda.shared.contracts.errors import ContractError


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "tests" / "fixtures" / "bmstu" / "ingestion"
BASE_BUNDLE = ROOT / "data" / "bmstu-2026"


def _fixture_parse_report(tmp_path: Path) -> Path:
    capture = capture_sources(
        mode="fixture",
        fixture_dir=FIXTURE_DIR,
        output_dir=tmp_path / "capture",
    )
    assert capture.snapshot_count == 7
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

    assert parsed["source_capture_digest"] == "dedc5d2731b78a285c42bfdcdf85d6e8e6634d729a1a975ecd7d7f00b0145afc"
    assert len(parsed["sources"]) == 7
    assert parsed["source_gaps"] == []
    assert len(parsed["normalized"]["programs"]) == 2
    assert len(parsed["normalized"]["curricula"]) == 2
    assert len(parsed["normalized"]["disciplines"]) == 101
    assert sum(len(item["items"]) for item in parsed["normalized"]["curricula"]) == 212
    assert len(parsed["normalized"]["historical_results"]) == 1
    assert all(item["department_code"] and item["department_name"] for item in parsed["normalized"]["programs"])
    assert all(len(item["sha256"]) == 64 for item in parsed["sources"])
    assert "body" not in parsed


def test_parser_rejects_fixture_bytes_that_do_not_match_manifest(tmp_path: Path) -> None:
    broken_fixture = tmp_path / "broken-fixture"
    shutil.copytree(FIXTURE_DIR, broken_fixture)
    body = broken_fixture / "admission_information.html"
    body.write_bytes(body.read_bytes() + b"<!-- changed without updating the digest -->\n")

    with pytest.raises(ContractError, match="Fixture body hash does not match manifest"):
        parse_capture(broken_fixture)


def test_checked_in_source_fixtures_are_redacted_with_hash_provenance() -> None:
    manifest = json.loads((FIXTURE_DIR / "source_manifest.json").read_text(encoding="utf-8"))
    assert manifest["fixture_redaction"]["policy"]
    assert len(manifest["snapshots"]) == 7
    assert {row["body_path"]: row["source_sha256"] for row in manifest["snapshots"] if "source_sha256" in row} == {
        "common.html": "27c7a2142d586ce462b3753c6a5e5061f667f3ef7ac6a2f3ae32b642cb6261ff",
        "catalog.html": "5d8460c5662b476f7c2d2611426134169f4926febfbf2a755fd3f6e97e889fd3",
        "catalog_2.json": "121c58c40e9e371b20454700618eefc24fad9c96d7d81ec3413b5289d56964db",
        "detail.html": "7145f212707d923433cced08977bea99eacc8604865ab1bb4877405c3d429eaf",
        "curriculum.pdf": "6ff702f01fae34893897dc047249131cf62c760de1d3181707dc970faaae9fa0",
        "curriculum_2.pdf": "0358f9b5fb94304c3ed012f9285ec5bf7587dd272c499cd733f5ecad4dbc0047",
    }
    email_pattern = re.compile(rb"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b")
    for snapshot in manifest["snapshots"]:
        fixture_path = FIXTURE_DIR / snapshot["body_path"]
        body = fixture_path.read_bytes()
        assert snapshot["fixture_sanitized"] is True
        if "source_sha256" in snapshot:
            assert re.fullmatch(r"[0-9a-f]{64}", snapshot["source_sha256"])
        assert hashlib.sha256(body).hexdigest() == snapshot["content_sha256"]
        assert not email_pattern.search(body)
    aggregate = next(row for row in manifest["snapshots"] if row["body_path"] == "admission_information.html")
    assert aggregate["source_kind"] == "bmstu_admission_information"

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
    assert result["validation"]["valid"]
    assert result["typed_candidate_count"] >= 250
    assert result["validation"]["counts"]["normalized_records"] == (
        validate_bundle(BASE_BUNDLE)["counts"]["normalized_records"] + result["candidate_count"]
    )
    assert not list(candidate_dir.rglob("*.pdf"))
    assert validate_bundle(candidate_dir)["source_artifacts"]["saved_files_present"] == 0
    with pytest.raises(IngestionError, match="unreviewed candidate"):
        validate_import_bundle(candidate_dir)
    with pytest.raises(BundleMappingError, match="no import mapping"):
        project_bundle(candidate_dir)

    candidate_rows = [
        json.loads(line)
        for line in (candidate_dir / "data" / "bmstu_ingestion_candidates.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    decisions = tmp_path / "review.csv"
    accepted_targets: dict[str, str] = {}
    exact_program_links = {
        "program:bmstu:09.03.01-02": "program:bmstu:09.03.01:ИУ5:09.03.01-02:source:1-1",
        "program:bmstu:09.03.01-12": "program:bmstu:09.03.01:ИУ5:09.03.01-12:source:1-2",
    }
    exact_plan_links = {
        "curriculum:bmstu:09.03.01-02-2026": "study_plan:program:bmstu:09.03.01:ИУ5:09.03.01-02:source:1-1",
        "curriculum:bmstu:09.03.01-12-2026": "study_plan:program:bmstu:09.03.01:ИУ5:09.03.01-12:source:1-2",
    }
    item_candidate: dict[str, Any] | None = None
    for row in candidate_rows:
        if row["candidate_type"] != "typed_record":
            continue
        dataset = row["target_dataset"]
        identity = row["source_identity"]
        if dataset in {"universities.jsonl", "directions.jsonl", "departments.jsonl"}:
            accepted_targets[row["external_key"]] = row["suggested_target"]
        elif dataset == "educational_programs.jsonl" and identity in exact_program_links:
            accepted_targets[row["external_key"]] = exact_program_links[identity]
        elif dataset == "study_plans.jsonl" and identity in exact_plan_links:
            accepted_targets[row["external_key"]] = exact_plan_links[identity]
        elif dataset == "relationships.jsonl" and identity.startswith("relationship:bmstu:program-plan:"):
            if "program:bmstu:09.03.01-02" in identity and "curriculum:bmstu:09.03.01-02-2026" in identity:
                accepted_targets[row["external_key"]] = row["suggested_target"]
        elif dataset in {
            "relationships.jsonl",
            "exams.jsonl",
            "admission_exam_requirements.jsonl",
            "program_offerings.jsonl",
            "competition_pools.jsonl",
            "historical_admission_statistics.jsonl",
        }:
            accepted_targets[row["external_key"]] = row["suggested_target"]
        elif dataset == "curriculum_items.jsonl" and item_candidate is None:
            payload = json.loads(row["payload_json"])
            plan_candidate_key = payload["curriculum_key"]["$candidate_ref"]
            plan_target = next(
                (
                    exact_plan_links[plan["source_identity"]]
                    for plan in candidate_rows
                    if plan["external_key"] == plan_candidate_key
                    and plan["source_identity"] in exact_plan_links
                ),
                None,
            )
            if plan_target is None or not plan_target.endswith("09.03.01-02:source:1-1"):
                continue
            base_items = [
                json.loads(line)
                for line in (BASE_BUNDLE / "data" / "curriculum_items.jsonl").read_text(encoding="utf-8-sig").splitlines()
            ]
            credits = Decimal(str(payload["credits"])) if payload.get("credits") is not None else None
            matches = [
                base_row
                for base_row in base_items
                if base_row.get("curriculum_key") == plan_target
                and base_row.get("discipline") == payload.get("discipline")
                and base_row.get("semester") == payload.get("semester")
                and base_row.get("hours") == payload.get("hours")
                and (Decimal(str(base_row["credits"])) if base_row.get("credits") is not None else None) == credits
            ]
            if len(matches) == 1:
                item_candidate = row
                accepted_targets[row["external_key"]] = matches[0]["external_key"]

    assert item_candidate is not None, "fixture review must identify one exact existing curriculum item key"
    with decisions.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=("external_key", "decision", "reviewed_at", "target_external_key"))
        writer.writeheader()
        for row in candidate_rows:
            decision = "accept_observation" if row["candidate_type"] == "canonical_snapshot" else (
                "accept_typed_fact" if row["external_key"] in accepted_targets else "reject"
            )
            writer.writerow({
                "external_key": row["external_key"],
                "decision": decision,
                "reviewed_at": "2026-10-06T00:00:00+00:00",
                "target_external_key": accepted_targets.get(row["external_key"], ""),
            })

    reviewed_dir = tmp_path / "reviewed"
    materialized = materialize_reviewed_bundle(
        candidate_dir=candidate_dir,
        decisions_path=decisions,
        output_dir=reviewed_dir,
    )
    assert materialized["accepted"] == 1 + len(accepted_targets)
    assert materialized["accepted_typed"] == len(accepted_targets)
    assert materialized["validation"]["valid"]
    assert validate_import_bundle(reviewed_dir)["valid"]

    dry_run = dry_run_import(reviewed_dir)
    assert dry_run["outcome"] == "dry_run"
    assert dry_run["database_connection_opened"] is False
    assert dry_run["network_requests"] == 0
    typed_counts = dry_run["mapping"]["typed_row_counts"]
    changed_keys: dict[str, set[str]] = {}
    for candidate_row in candidate_rows:
        target_key = accepted_targets.get(candidate_row["external_key"])
        if target_key:
            changed_keys.setdefault(candidate_row.get("target_dataset", ""), set()).add(target_key)
        elif candidate_row["candidate_type"] == "canonical_snapshot":
            changed_keys.setdefault("admission_information_source_tables.jsonl", set()).add(candidate_row["external_key"])
    for base_file in (BASE_BUNDLE / "data").glob("*.jsonl"):
        target_file = reviewed_dir / "data" / base_file.name
        if base_file.name not in changed_keys:
            assert target_file.read_bytes() == base_file.read_bytes()
            continue
        base_rows = {json.loads(line)["external_key"]: line for line in base_file.read_bytes().splitlines(keepends=True)}
        target_rows = {json.loads(line)["external_key"]: line for line in target_file.read_bytes().splitlines(keepends=True)}
        for external_key, raw_line in base_rows.items():
            if external_key not in changed_keys[base_file.name]:
                assert target_rows[external_key] == raw_line
    assert typed_counts["universities"] == 1
    assert typed_counts["directions"] == 53
    assert typed_counts["departments"] == 77
    assert typed_counts["educational_programs"] == 152
    assert typed_counts["study_plans"] == 152
    assert typed_counts["curriculum_items"] == 14_165
    assert typed_counts["admission_exams"] > 0
    assert typed_counts["program_offerings"] == 131
    assert typed_counts["competition_pools"] == 944
    assert typed_counts["admission_requirement_sets"] == 85
    assert typed_counts["admission_requirement_nodes"] > 405
    assert typed_counts["historical_admission_statistics"] >= 783
    assert typed_counts["tuition_assertions"] > 0
    assert typed_counts["source_artifacts"] > 498
    assert typed_counts["source_observations"] > 23_020

    updated_history = next(
        json.loads(line)
        for line in (reviewed_dir / "data" / "historical_admission_statistics.jsonl").read_text(encoding="utf-8").splitlines()
        if json.loads(line)["external_key"] == "admission_statistic:bmstu:2025:01.03.02:paid:direction"
    )
    assert (updated_history["admitted_count"], updated_history["minimum_score"], updated_history["maximum_score"]) == (12, 201, 280)


def test_candidate_rejects_applicant_and_olympiad_payloads() -> None:
    from andromeda_parser.ingest import _assert_safe_payload

    with pytest.raises(IngestionError, match="personal field"):
        _assert_safe_payload({"applicant_id": "123456"})
    with pytest.raises(IngestionError, match="olympiad fields"):
        _assert_safe_payload({"olympiad_result": "not for publication"})


def test_conflicting_reviewed_sources_fail_closed_and_unknowns_do_not_erase() -> None:
    from andromeda_parser.bundle import _merge_reviewed_target_row

    target = {
        "external_key": "admission_statistic:bmstu:2025:01.03.02:paid:direction",
        "admitted_count": 29,
        "minimum_score": 250,
        "source_artifact_key": "source_artifact:existing",
    }
    with pytest.raises(IngestionError, match="conflicting accepted sources"):
        _merge_reviewed_target_row(
            target,
            {
                "external_key": target["external_key"],
                "admitted_count": 12,
                "source_artifact_key": "source_artifact:new",
            },
        )

    merged = _merge_reviewed_target_row(
        target,
        {
            "external_key": target["external_key"],
            "admitted_count": None,
            "maximum_score": 280,
            "source_artifact_key": "source_artifact:new",
        },
    )
    assert merged["admitted_count"] == 29
    assert merged["minimum_score"] == 250
    assert merged["maximum_score"] == 280
    assert merged["source_artifact_keys"] == ["source_artifact:existing", "source_artifact:new"]
