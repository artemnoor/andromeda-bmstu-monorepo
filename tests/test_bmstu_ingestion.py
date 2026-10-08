from __future__ import annotations

import csv
import hashlib
import json
import re
import shutil
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import fitz
import httpx
import pytest
from andromeda.ingestion.pdf_policy import (
    PdfResourceError,
    validate_page_count,
    validate_pdf_payload,
)
from andromeda.ingestion.universities.bmstu.capture import BmstuSource
from andromeda.ingestion.universities.bmstu.curriculum_identity import (
    reconcile_curriculum_rows,
)
from andromeda.ingestion.universities.bmstu.fetch import FetchConfig, Fetcher
from andromeda.ingestion.universities.bmstu.parser.campaign_2026.admissions.authority import (
    build_authoritative_intake_records,
)
from andromeda.ingestion.universities.bmstu.parser.campaign_2026.curricula.parser import (
    parse_curriculum_document,
)
from andromeda.ingestion.universities.bmstu.parser.campaign_2026.tuition.parser import (
    parse_cost_page,
)
from andromeda.ingestion.universities.bmstu.source_models import FetchedResource
from andromeda.shared.contracts.errors import ContractError
from andromeda_api.application.importer.bundle import validate_bundle
from andromeda_api.application.importer.mapping import (
    BundleMappingError,
    _exact_curriculum_parent_pdf,
    project_bundle,
)
from andromeda_ingestion_cli.cli import ApiIngestionOperations
from andromeda_parser.bundle import (
    _remove_jsonl_rows_exact,
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
    run_parse_admission_plan_command,
    write_parse_report,
)
from andromeda_parser.moderation import (
    compare_candidate_bundle,
    prepare_rejected_candidates,
    write_review_template,
)
from andromeda_parser.probe import (
    MAX_REQUESTS,
    _CappedTransport,
    _compare_exact_keys,
    _RequestBudget,
    _safe_report_url,
)
from bs4 import BeautifulSoup

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


def test_exact_key_diff_conflicts_and_safe_bulk_template(tmp_path: Path) -> None:
    candidate_dir = tmp_path / "candidate-diff"
    shutil.copytree(BASE_BUNDLE, candidate_dir)
    statistics_path = BASE_BUNDLE / "data" / "historical_admission_statistics.jsonl"
    statistics = [json.loads(line) for line in statistics_path.read_text(encoding="utf-8").splitlines()]
    by_key = {row["external_key"]: row for row in statistics}
    artifact_rows = [
        json.loads(line)
        for line in (BASE_BUNDLE / "source_artifacts.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    artifact = next(row for row in artifact_rows if row["source_key"] == by_key[statistics[0]["external_key"]]["source_artifact_key"])

    candidates: list[dict[str, Any]] = []

    def candidate(candidate_key: str, target_key: str, payload: dict[str, Any], source_identity: str) -> None:
        encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        candidates.append(
            {
                "external_key": candidate_key,
                "candidate_type": "typed_record",
                "target_dataset": "historical_admission_statistics.jsonl",
                "source_identity": source_identity,
                "suggested_target": target_key,
                "source_capture_digest": "a" * 64,
                "source_artifact_key": artifact["source_key"],
                "review_state": "pending",
                "payload_json": encoded,
                "payload_sha256": hashlib.sha256(encoded.encode("utf-8")).hexdigest(),
            }
        )

    safe_key = "admission_statistic:bmstu:2025:01.03.02:paid:direction"
    safe_payload = dict(by_key[safe_key])
    safe_payload["finality_note"] = "Source explicitly confirms this aggregate is final."
    candidate("bmstu_fact_candidate:safe-finality", safe_key, safe_payload, "source:safe-finality")
    unchanged_row = next(
        row
        for row in statistics
        if row["source_artifact_key"] == artifact["source_key"]
        and row["external_key"] not in {
            safe_key,
            "admission_statistic:bmstu:2024:01.03.02:paid:direction",
            "admission_statistic:bmstu:2023:01.03.02:paid:direction",
        }
    )
    candidate(
        "bmstu_fact_candidate:unchanged",
        unchanged_row["external_key"],
        dict(unchanged_row),
        "source:unchanged",
    )

    critical_key = "admission_statistic:bmstu:2024:01.03.02:paid:direction"
    critical_payload = dict(by_key[critical_key])
    critical_payload["minimum_score"] = 259
    candidate("bmstu_fact_candidate:critical-score", critical_key, critical_payload, "source:critical-score")

    new_payload = dict(safe_payload)
    new_key = "admission_statistic:bmstu:test-new:01.03.02:paid:direction"
    new_payload["external_key"] = new_key
    new_payload["admission_year"] = 2022
    candidate("bmstu_fact_candidate:new-key", new_key, new_payload, "source:new-key")

    conflict_key = "admission_statistic:bmstu:2023:01.03.02:paid:direction"
    conflict_a = dict(by_key[conflict_key])
    conflict_b = dict(by_key[conflict_key])
    conflict_a["finality_note"] = "Conflicting source A."
    conflict_b["finality_note"] = "Conflicting source B."
    candidate("bmstu_fact_candidate:conflict-a", conflict_key, conflict_a, "source:conflict-a")
    candidate("bmstu_fact_candidate:conflict-b", conflict_key, conflict_b, "source:conflict-b")

    candidate_path = candidate_dir / "data" / "bmstu_ingestion_candidates.jsonl"
    candidate_path.write_text(
        "".join(json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n" for row in candidates),
        encoding="utf-8",
    )
    (candidate_dir / "ingestion_candidate_manifest.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "capture_digest": "a" * 64,
                "candidate_keys": [row["external_key"] for row in candidates],
                "complete_datasets": [],
            },
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    diff = compare_candidate_bundle(candidate_dir)
    classifications = {row["candidate_key"]: row for row in diff["records"]}
    assert classifications["bmstu_fact_candidate:safe-finality"]["classification"] == "changed"
    assert classifications["bmstu_fact_candidate:safe-finality"]["bulk_eligible"] is True
    assert classifications["bmstu_fact_candidate:critical-score"]["bulk_eligible"] is False
    assert classifications["bmstu_fact_candidate:new-key"]["classification"] == "new"
    assert classifications["bmstu_fact_candidate:conflict-a"]["classification"] == "conflicting"
    assert classifications["bmstu_fact_candidate:conflict-b"]["classification"] == "conflicting"
    assert classifications["bmstu_fact_candidate:unchanged"]["classification"] == "unchanged"
    assert classifications["bmstu_fact_candidate:unchanged"]["provenance_verified"] is True
    assert diff["counts"].get("potentially_removed", 0) == 0
    complete_manifest_path = candidate_dir / "ingestion_candidate_manifest.json"
    complete_manifest = json.loads(complete_manifest_path.read_text(encoding="utf-8"))
    complete_manifest["complete_datasets"] = ["historical_admission_statistics.jsonl"]
    complete_manifest_path.write_text(json.dumps(complete_manifest, sort_keys=True) + "\n", encoding="utf-8")
    complete_diff = compare_candidate_bundle(candidate_dir)
    removed = [row for row in complete_diff["records"] if row["classification"] == "potentially_removed"]
    assert removed
    assert all(row["bulk_eligible"] is False for row in removed)

    template_path = tmp_path / "bulk-template.csv"
    counts = write_review_template(candidate_dir, template_path, actor="test-reviewer")
    with template_path.open(encoding="utf-8", newline="") as stream:
        decisions = {row["external_key"]: row for row in csv.DictReader(stream)}
    assert counts == {
        "candidates": 5,
        "prefilled_safe": 1,
        "individual_review_required": 4,
        "unchanged_skipped": 1,
    }
    assert "bmstu_fact_candidate:unchanged" not in decisions
    assert decisions["bmstu_fact_candidate:safe-finality"]["decision"] == "accept_typed_fact"
    for key in (
        "bmstu_fact_candidate:critical-score",
        "bmstu_fact_candidate:new-key",
        "bmstu_fact_candidate:conflict-a",
        "bmstu_fact_candidate:conflict-b",
    ):
        assert decisions[key]["decision"] == ""


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


def test_real_curriculum_fixtures_have_stable_exact_item_keys_and_pdf_provenance() -> None:
    profile = {
        "code": "01.03.02-01",
        "name": "fixture profile",
        "study_plan_external_key": "study_plan:program:bmstu:01.03.02:ИУ9:01.03.02-01:source:1-1",
    }
    expected_counts = {"curriculum.pdf": 89, "curriculum_2.pdf": 123}
    for name in ("curriculum.pdf", "curriculum_2.pdf"):
        body = (FIXTURE_DIR / name).read_bytes()
        kwargs = {
            "content_type": "application/pdf",
            "final_url": f"https://official.bmstu.ru/{name}",
            "share_url": f"https://official.bmstu.ru/{name}",
            "profile": profile,
            "retrieved_at": "2026-10-07T00:00:00+00:00",
        }
        first = parse_curriculum_document(body, **kwargs)
        repeated = parse_curriculum_document(body, **kwargs)
        first_keys = [item.get("external_key") for item in first["items"]]
        repeated_keys = [item.get("external_key") for item in repeated["items"]]
        assert first["identity_status"] == "exact"
        assert first_keys == repeated_keys
        plan_key = profile["study_plan_external_key"]
        assert len(first_keys) == expected_counts[name]
        assert all(key.startswith(f"curriculum_item:{plan_key}:identity:") for key in first_keys)
        assert len(first_keys) == len(set(first_keys))
        assert all(item["source_sha256"] == hashlib.sha256(body).hexdigest() for item in first["items"])
        assert all(item["source_locator"]["printed_row_no"] == item["row_no"] for item in first["items"])
        assert all(item["source_locator"]["parsed_position"] == item["source_position"] for item in first["items"])
        assert all(item["source_row"]["identity"]["source_identity_id"] for item in first["items"])


def test_curriculum_external_key_survives_mutable_fact_changes() -> None:
    plan_key = "study_plan:program:bmstu:01.03.02:test"
    previous = [{
        "external_key": f"curriculum_item:{plan_key}:row:1",
        "curriculum_key": plan_key,
        "discipline": "Математический анализ",
        "semester": 1,
        "hours": 108,
        "assessment_type": "Экзамен",
    }]
    revised = {
        "discipline": "Математический анализ",
        "semester": 2,
        "hours": 144,
        "assessment_type": "Зачёт",
        "parsed_position": 14,
        "source_sha256": hashlib.sha256(b"revision").hexdigest(),
    }
    matched = reconcile_curriculum_rows(plan_key, [revised], previous)
    assert matched.rows[0].status == "matched"
    assert matched.rows[0].canonical_external_key == previous[0]["external_key"]

    renamed = reconcile_curriculum_rows(
        plan_key,
        [{**revised, "discipline": "Математический анализ II"}],
        previous,
    )
    assert renamed.rows[0].status == "ambiguous"
    assert renamed.rows[0].suggested_existing_keys == (previous[0]["external_key"],)


def test_live_report_113_row_plan_reconciles_against_checked_in_release_slice() -> None:
    plans = [
        json.loads(line)
        for line in (BASE_BUNDLE / "data" / "study_plans.jsonl").read_text(encoding="utf-8-sig").splitlines()
        if line.strip()
    ]
    plan = next(row for row in plans if row.get("profile_code") == "01.03.02-01" and row.get("education_year") == 2026)
    plan_key = plan["external_key"]
    current = [
        json.loads(line)
        for line in (BASE_BUNDLE / "data" / "curriculum_items.jsonl").read_text(encoding="utf-8-sig").splitlines()
        if line.strip()
    ]
    current = [row for row in current if row.get("curriculum_key") == plan_key]
    assert len(current) == 113
    incoming = [
        {
            "discipline": row["discipline"],
            "semester": row.get("semester"),
            "hours": row.get("hours"),
            "credits": row.get("credits"),
            "assessment_type": row.get("assessment_type"),
            "parsed_position": position,
            "printed_row_no": row.get("row_no"),
            "source_sha256": row.get("source_sha256"),
        }
        for position, row in enumerate(current, start=1)
    ]
    result = reconcile_curriculum_rows(plan_key, incoming, current)
    assert result.counts == {"matched": 113, "new": 0, "ambiguous": 0, "potentially_removed": 0}
    assert [row.canonical_external_key for row in result.rows] == [row["external_key"] for row in current]


def test_renamed_curriculum_candidate_is_reviewed_as_ambiguous(tmp_path: Path) -> None:
    parse_report_path = _fixture_parse_report(tmp_path)
    report = json.loads(parse_report_path.read_text(encoding="utf-8"))
    curriculum = report["normalized"]["curricula"][0]
    program = next(row for row in report["normalized"]["programs"] if row["id"] == curriculum["program_id"])
    plans = [
        json.loads(line)
        for line in (BASE_BUNDLE / "data" / "study_plans.jsonl").read_text(encoding="utf-8-sig").splitlines()
        if line.strip()
    ]
    plan = next(row for row in plans if row.get("profile_code") == program["code"] and row.get("education_year") == curriculum["education_year"])
    plan_rows = [
        json.loads(line)
        for line in (BASE_BUNDLE / "data" / "curriculum_items.jsonl").read_text(encoding="utf-8-sig").splitlines()
        if line.strip()
    ]
    plan_rows = [row for row in plan_rows if row.get("curriculum_key") == plan["external_key"]]
    selected = next(
        item for item in curriculum["items"]
        if len([
            row for row in plan_rows
            if row.get("discipline") == item["source_name"] and row.get("semester") == item.get("semester")
        ]) == 1
        and len(item["source_name"]) >= 8
    )
    old_name = selected["source_name"]
    selected["source_name"] = old_name[:-1] + ("я" if old_name[-1] != "я" else "о")
    parse_report_path.write_text(json.dumps(report, ensure_ascii=False), encoding="utf-8")

    candidate_dir = tmp_path / "candidate-ambiguous"
    build_candidate_bundle(base_bundle=BASE_BUNDLE, parse_report_path=parse_report_path, output_dir=candidate_dir)
    diff = compare_candidate_bundle(candidate_dir)
    row = next(
        entry for entry in diff["records"]
        if entry.get("target_dataset") == "curriculum_items.jsonl"
        and entry.get("classification") == "ambiguous"
        and entry.get("suggested_existing_keys")
    )
    assert row["bulk_eligible"] is False
    assert row["target_external_key"].startswith("curriculum_observation:")
    assert row["suggested_existing_keys"]
    assert not any(
        entry.get("classification") == "potentially_removed"
        and entry.get("target_external_key") in row["suggested_existing_keys"]
        for entry in diff["records"]
    )


def test_tuition_year_identity_is_exact_or_remains_pending() -> None:
    confirmed = """
    <div id="v-pills-1">
      <h2>Стоимость обучения на 2026/2027 учебный год</h2>
      <table><tr><th>Код</th><th>Направление</th><th>Стоимость</th></tr>
      <tr><td>01.03.02</td><td>Прикладная математика</td><td>250 000 руб.</td></tr></table>
    </div>
    """.encode()
    parsed = parse_cost_page(confirmed, "https://course.bmstu.ru/edu/abiturient/")
    assert len(parsed["tuition_records"]) == 1
    assert parsed["tuition_records"][0]["study_year_label"] == "2026-2027"
    assert parsed["tuition_records"][0]["external_key"].startswith("tuition:bmstu:01.03.02:2026-2027:")
    assert parsed["pending_tuition_observations"] == []

    unspecified = """
    <table><tr><th>Код</th><th>Направление</th><th>Стоимость</th></tr>
    <tr><td>01.03.02</td><td>Прикладная математика</td><td>250 000 руб.</td></tr></table>
    """.encode()
    pending = parse_cost_page(unspecified, "https://course.bmstu.ru/edu/abiturient/")
    assert pending["tuition_records"] == []
    assert len(pending["pending_tuition_observations"]) == 1
    observation = pending["pending_tuition_observations"][0]
    assert observation["external_key"] is None
    assert observation["gap_code"] == "academic_year_not_explicit_in_owning_section"


def test_live_admission_fixture_does_not_infer_tuition_year() -> None:
    parsed = parse_cost_page(
        (FIXTURE_DIR / "admission_information.html").read_bytes(),
        "https://course.bmstu.ru/edu/abiturient/",
    )
    assert parsed["tuition_records"] == []
    assert parsed["pending_tuition_observations"]
    assert all(row["external_key"] is None for row in parsed["pending_tuition_observations"])


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


def test_live_probe_request_budget_is_hard_bounded() -> None:
    class FakeFetcher:
        def __init__(self) -> None:
            self.urls: list[str] = []

        def fetch_http(self, url: str) -> str:
            self.urls.append(url)
            return url

    fake = FakeFetcher()
    budget = _RequestBudget(fake)  # type: ignore[arg-type]
    for index in range(MAX_REQUESTS):
        assert budget.fetch(f"https://bmstu.ru/probe/{index}") == f"https://bmstu.ru/probe/{index}"
    with pytest.raises(IngestionError, match="hard request limit"):
        budget.fetch("https://bmstu.ru/probe/over-limit")
    assert budget.requests == MAX_REQUESTS
    assert len(fake.urls) == MAX_REQUESTS


def test_live_probe_http_budget_counts_redirect_exchanges() -> None:
    requested: list[str] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requested.append(str(request.url))
        return httpx.Response(302, headers={"location": f"/hop-{len(requested)}"}, request=request)

    transport = _CappedTransport(2, transport=httpx.MockTransport(respond))
    fetcher = Fetcher(
        FetchConfig(retries=0, max_redirects=8, request_interval_seconds=0),
        transport=transport,
        resolver=lambda _host: ["93.184.216.34"],
    )
    try:
        result = fetcher.fetch_http("https://bmstu.ru/start")
    finally:
        fetcher.close()
    assert len(requested) == 2
    assert transport.requests == 2
    assert result.error_code == "retry_exhausted"


def test_live_probe_403_and_429_are_terminal_without_retry() -> None:
    for status_code, expected_error in ((403, "http_error"), (429, "retry_exhausted")):
        seen: list[int] = []

        def respond(
            request: httpx.Request,
            *,
            response_status: int = status_code,
            observed: list[int] = seen,
        ) -> httpx.Response:
            observed.append(response_status)
            return httpx.Response(response_status, content=b"access response", request=request)

        fetcher = Fetcher(
            FetchConfig(retries=0, request_interval_seconds=0),
            transport=httpx.MockTransport(respond),
            resolver=lambda _host: ["93.184.216.34"],
        )
        try:
            result = fetcher.fetch_http("https://bmstu.ru/probe")
        finally:
            fetcher.close()
        assert result.status_code == status_code
        assert result.error_code == expected_error
        assert result.attempts == 1
        assert seen == [status_code]


def test_live_probe_rejects_redirect_outside_official_host_policy() -> None:
    requested: list[str] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requested.append(str(request.url))
        return httpx.Response(302, headers={"location": "https://not-bmstu.invalid/data"}, request=request)

    fetcher = Fetcher(
        FetchConfig(retries=0, request_interval_seconds=0),
        transport=httpx.MockTransport(respond),
        resolver=lambda _host: ["93.184.216.34"],
    )
    try:
        result = fetcher.fetch_http("https://bmstu.ru/probe")
    finally:
        fetcher.close()
    assert result.error_code is not None and result.error_code.startswith("redirect_")
    assert len(requested) == 1


def test_live_probe_response_body_limit_is_enforced() -> None:
    fetcher = Fetcher(
        FetchConfig(retries=0, request_interval_seconds=0, max_body_bytes=1024),
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                200,
                headers={"content-length": "2048"},
                content=b"x" * 2048,
                request=request,
            )
        ),
        resolver=lambda _host: ["93.184.216.34"],
    )
    try:
        result = fetcher.fetch_http("https://bmstu.ru/probe")
    finally:
        fetcher.close()
    assert result.error_code == "response_body_truncated"
    assert result.truncated is True
    assert len(result.body) == 1024


def test_live_probe_report_urls_omit_share_keys_and_queries() -> None:
    assert _safe_report_url("https://disk.yandex.ru/d/private-share-key?token=secret") == (
        "https://disk.yandex.ru/[REDACTED]"
    )


def test_live_probe_exact_comparison_keeps_only_actionable_differences() -> None:
    comparison = _compare_exact_keys(
        [
            {"external_key": "same", "value": 1},
            {"external_key": "changed", "value": 2},
            {"external_key": "new", "value": 3},
            {"value": 4},
        ],
        {"same": {"external_key": "same", "value": 1}, "changed": {"external_key": "changed", "value": 1}},
        fields=("value",),
    )
    assert comparison["exact_key_matches"] == 2
    assert comparison["live_keys_not_in_current_release"] == 1
    assert comparison["changed_records"] == 1
    assert comparison["live_records_without_exact_key"] == 1
    assert {row["external_key"] for row in comparison["records"]} == {"changed", "new"}
    assert _safe_report_url("https://api.www.bmstu.ru/majors?limit=1&token=secret") == (
        "https://api.www.bmstu.ru/majors"
    )


def test_selected_plan_capture_downloads_at_most_one_document() -> None:
    class FakeFetcher:
        def __init__(self) -> None:
            self.urls: list[str] = []

        def fetch_http(self, url: str) -> FetchedResource:
            self.urls.append(url)
            body = json.dumps(
                {
                    "_embedded": {
                        "items": [
                            {"file": "https://downloader.disk.yandex.net/first.pdf"},
                            {"file": "https://downloader.disk.yandex.net/second.pdf"},
                        ]
                    }
                }
            ).encode() if "public/resources" in url else b"%PDF-1.7 sample"
            return FetchedResource(
                requested_url=url,
                final_url=url,
                status_code=200,
                content_type="application/json" if "public/resources" in url else "application/pdf",
                body=body,
                fetched_at="2026-10-07T00:00:00+00:00",
            )

    fake = FakeFetcher()
    source = BmstuSource(fetcher=fake)  # type: ignore[arg-type]
    snapshots = source._fetch_public_documents("https://disk.yandex.ru/d/fixture-key", max_documents=1)
    assert len(snapshots) == 2  # metadata plus exactly one selected PDF
    assert fake.urls == [
        "https://cloud-api.yandex.net/v1/disk/public/resources?public_key=https%3A%2F%2Fdisk.yandex.ru%2Fd%2Ffixture-key",
        "https://downloader.disk.yandex.net/first.pdf",
    ]
    assert len(source._capture_gaps) == 1
    assert source._capture_gaps[0].reason == "additional_documents_not_probed"


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
    application = ApiIngestionOperations()
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
    diff = compare_candidate_bundle(candidate_dir)
    assert diff["counts"].get("changed", 0) > 0
    assert diff["counts"].get("new", 0) > 0
    assert diff["counts"].get("potentially_removed", 0) == 0
    assert "complete_scopes" in diff["coverage"]
    review_template_path = tmp_path / "grouped-review-template.csv"
    template_counts = write_review_template(
        candidate_dir,
        review_template_path,
        actor="reviewer@example.invalid",
    )
    assert (
        template_counts["prefilled_safe"]
        + template_counts["individual_review_required"]
        + template_counts["unchanged_skipped"]
        == result["candidate_count"]
    )
    with review_template_path.open(encoding="utf-8", newline="") as stream:
        template_rows = list(csv.DictReader(stream))
    by_diff_key = {row.get("candidate_key"): row for row in diff["records"]}
    assert not any(
        by_diff_key.get(row["external_key"], {}).get("classification") == "unchanged"
        for row in template_rows
    )
    for row in template_rows:
        if row["decision"]:
            classification = by_diff_key[row["external_key"]]
            assert classification["classification"] == "changed" and classification["bulk_eligible"]
            assert row["reviewed_by"] == "reviewer@example.invalid"
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
    review_required_keys = {
        str(row["candidate_key"])
        for row in diff["records"]
        if isinstance(row.get("candidate_key"), str)
        and not (
            row["classification"] == "unchanged"
            and row.get("provenance_verified") is True
            and not next(candidate for candidate in candidate_rows if candidate["external_key"] == row["candidate_key"]).get("prior_rejection_event_ids")
        )
    }
    accepted_targets = {
        key: value for key, value in accepted_targets.items() if key in review_required_keys
    }
    with decisions.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=("external_key", "decision", "reviewed_at", "target_external_key"))
        writer.writeheader()
        for row in candidate_rows:
            if row["external_key"] not in review_required_keys:
                continue
            decision = "accept_observation" if row["candidate_type"] == "canonical_snapshot" else (
                "accept_typed_fact" if row["external_key"] in accepted_targets else "reject"
            )
            writer.writerow({
                "external_key": row["external_key"],
                "decision": decision,
                "reviewed_at": "2026-10-07T00:00:00+00:00",
                "target_external_key": accepted_targets.get(row["external_key"], ""),
            })

    reviewed_dir = tmp_path / "reviewed"
    materialized = materialize_reviewed_bundle(
        candidate_dir=candidate_dir,
        decisions_path=decisions,
        output_dir=reviewed_dir,
        project_bundle=application.project_bundle,
    )
    assert materialized["accepted"] == 1 + len(accepted_targets)
    assert materialized["accepted_typed"] == len(accepted_targets)
    assert materialized["unchanged_skipped"] == len(candidate_rows) - len(review_required_keys)
    assert materialized["validation"]["valid"]
    assert validate_import_bundle(reviewed_dir, application)["valid"]
    accepted_curriculum_key = accepted_targets[item_candidate["external_key"]]
    reviewed_curriculum_rows = [
        json.loads(line)
        for line in (reviewed_dir / "data" / "curriculum_items.jsonl").read_text(encoding="utf-8-sig").splitlines()
        if line.strip()
    ]
    accepted_curriculum_row = next(row for row in reviewed_curriculum_rows if row["external_key"] == accepted_curriculum_key)
    assert accepted_curriculum_row["source_row"]["identity"]["source_identity_id"].startswith("curriculum-source-identity:")
    assert accepted_curriculum_row["source_sha256"]
    assert accepted_curriculum_row["source_retrieved_at"]
    assert accepted_curriculum_row["source_locator"]["parsed_position"]
    audit_rows = [
        json.loads(line)
        for line in (reviewed_dir / "review_decisions.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert len(audit_rows) == len(review_required_keys)
    assert not any(row["candidate_key"] not in review_required_keys for row in audit_rows)
    assert all(row["reviewed_by"] and row["source_value_json"] for row in audit_rows)
    rejected = [row for row in candidate_rows if row["external_key"] in review_required_keys and row["external_key"] not in accepted_targets and row["candidate_type"] == "typed_record"]
    assert rejected
    archived_rejections = [
        json.loads(line)
        for line in (reviewed_dir / "data" / "bmstu_rejected_candidates.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert len(archived_rejections) == len(rejected)
    reopen_key = rejected[0]["external_key"]
    reopened_dir = tmp_path / "re-moderation"
    reopened = prepare_rejected_candidates(
        reviewed_dir,
        reopened_dir,
        candidate_keys={reopen_key},
    )
    assert reopened["reopened_candidates"] == 1
    reopened_candidate = json.loads((reopened_dir / "data" / "bmstu_ingestion_candidates.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert reopened_candidate["external_key"] == reopen_key
    assert reopened_candidate["prior_rejection_event_ids"]
    remoderate_template = tmp_path / "remoderate-template.csv"
    remoderate_template_counts = write_review_template(
        reopened_dir,
        remoderate_template,
        actor="reviewer@example.invalid",
    )
    assert remoderate_template_counts["prefilled_safe"] == 0
    remoderate_decisions = tmp_path / "remoderate-decisions.csv"
    with remoderate_decisions.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(
            stream,
            fieldnames=("external_key", "decision", "reviewed_at", "target_external_key", "reviewed_by"),
        )
        writer.writeheader()
        writer.writerow(
            {
                "external_key": reopen_key,
                "decision": "reject",
                "reviewed_at": "2026-10-06T00:00:00+00:00",
                "target_external_key": "",
                "reviewed_by": "reviewer@example.invalid",
            }
        )
    reopened_again_dir = tmp_path / "re-moderated-again"
    materialize_reviewed_bundle(
        candidate_dir=reopened_dir,
        decisions_path=remoderate_decisions,
        output_dir=reopened_again_dir,
        project_bundle=application.project_bundle,
    )
    repeated_audit = [
        json.loads(line)
        for line in (reopened_again_dir / "review_decisions.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert len(repeated_audit) == len(candidate_rows) + 1
    assert sum(row["candidate_key"] == reopen_key for row in repeated_audit) == 2
    assert validate_import_bundle(reopened_again_dir, application)["valid"]

    dry_run = dry_run_import(reviewed_dir, application)
    assert dry_run["outcome"] == "dry_run"
    assert dry_run["database_connection_opened"] is False
    assert dry_run["network_requests"] == 0
    typed_counts = dry_run["mapping"]["typed_row_counts"]
    assert dry_run["mapping"]["mapper_version"] == "bmstu-2026-bundle-v4"
    assert dry_run["mapping"]["curriculum_provenance_inheritance"] == {
        "inherited_exact_parent_pdf": 5_267,
    }
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
    # The accepted fixture update adds a second source PDF to one existing row.
    assert typed_counts["curriculum_evidence"] == 14_166
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


def _authoritative_offer(
    key: str,
    row: int,
    *,
    program_name: str,
    budget: int = 10,
    paid: int = 20,
    special: int = 0,
    separate: int = 2,
) -> dict[str, Any]:
    locator = {"page": 2, "table": 1, "row": row}
    return {
        "external_key": key,
        "direction_codes_in_document": ["09.03.01"],
        "department_code_in_document": "ИУ5",
        "department_rows_in_document": [{"department_code_in_document": "ИУ5", "source_locator": locator}],
        "program_name_in_document": program_name,
        "budget_places_at_department": budget,
        "paid_places_at_department": paid,
        "special_quota_places_at_offering": special,
        "separate_quota_places_at_offering": separate,
        "source_locator": locator,
        "source_locators": [locator],
        "source_row": [program_name, budget, paid, special, separate],
    }


def _build_authoritative_test_records(offers: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], ...]:
    department_codes = {"ИУ5"}
    for offer in offers:
        for row in offer.get("department_rows_in_document", []):
            code = row.get("department_code_in_document")
            if isinstance(code, str) and code.startswith("ИУ"):
                department_codes.add(code)
    departments = [
        {"external_key": f"department:bmstu:{code}", "code": code, "name": code}
        for code in sorted(department_codes)
    ]
    directions = [{"external_key": "direction:bmstu:09.03.01", "code": "09.03.01", "name": "Информатика"}]
    programs = [
        {
            "external_key": f"program:bmstu:09.03.01:{index}",
            "direction_code": "09.03.01",
            "department_code": "ИУ5",
            "name": offer["program_name_in_document"],
        }
        for index, offer in enumerate(offers, start=1)
    ]
    return build_authoritative_intake_records(
        offers,
        [],
        directions=directions,
        departments=departments,
        programs=programs,
        campaign_key="campaign:bmstu:2026",
        source_url="local://test/appendix-8-1.pdf",
        source_artifact_key="source_artifact:test-appendix-8-1",
        source_retrieved_at="2026-10-07T00:00:00+00:00",
        source_sha256="a" * 64,
    )


def test_appendix_8_1_quotas_keep_offering_scope_and_exact_links() -> None:
    source_offers = [
        _authoritative_offer("offering:test:one", 10, program_name="Информатика", special=2, separate=8),
        _authoritative_offer("offering:test:two", 11, program_name="Информационные системы", special=6, separate=0),
    ]

    offers, pools, _source_rows, manual, relationships = _build_authoritative_test_records(source_offers)
    repeated = _build_authoritative_test_records(source_offers)

    quota_pools = [pool for pool in pools if pool["quota_type"] in {"special", "separate"}]
    assert len(offers) == 2
    assert len(quota_pools) == 4
    assert all(pool["scope_level"] == "offering" for pool in quota_pools)
    assert all(pool["department_code"] == "ИУ5" for pool in quota_pools)
    assert all(pool["source_sha256"] == "a" * 64 for pool in quota_pools)
    assert all(pool["source_artifact_key"] == "source_artifact:test-appendix-8-1" for pool in quota_pools)
    assert {pool["places"] for pool in quota_pools} == {0, 2, 6, 8}
    assert not any(row["issue_type"] == "authoritative_direction_quota_conflict" for row in manual)

    quota_links = [row for row in relationships if row["target_key"] in {pool["external_key"] for pool in quota_pools}]
    assert len(quota_links) == 4
    assert {
        (row["source_key"], row["target_key"])
        for row in quota_links
    } == {
        (pool["program_offering_key"], pool["external_key"])
        for pool in quota_pools
    }
    assert all(row["source_artifact_key"] == "source_artifact:test-appendix-8-1" for row in quota_links)
    assert [row["external_key"] for row in pools] == [row["external_key"] for row in repeated[1]]
    assert [(row["source_key"], row["target_key"]) for row in relationships] == [
        (row["source_key"], row["target_key"]) for row in repeated[4]
    ]


def test_appendix_8_1_same_exact_pool_with_different_values_requires_review() -> None:
    original = _authoritative_offer("offering:test:duplicate", 10, program_name="Информатика", special=2)
    conflicting = dict(original, special_quota_places_at_offering=3)

    _offers, pools, _source_rows, manual, relationships = _build_authoritative_test_records([original, conflicting])

    special = next(pool for pool in pools if pool["quota_type"] == "special")
    assert special["places"] is None
    assert special["conflicting_reported_places"] == [2, 3]
    assert special["places_by_source_row"] == [
        {"places": 2, "locator": original["source_locator"]},
        {"places": 3, "locator": conflicting["source_locator"]},
    ]
    assert any(
        row["record_key"] == special["external_key"]
        and row["issue_type"] == "authoritative_offering_quota_conflict"
        for row in manual
    )
    assert sum(row["target_key"] == special["external_key"] for row in relationships) == 1


def test_appendix_8_1_multiple_department_row_preserves_locators_without_split() -> None:
    offer = _authoritative_offer("offering:test:merged", 10, program_name="Новая программа", special=1)
    offer["department_code_in_document"] = "ИУ5 / ИУ6"
    offer["department_rows_in_document"] = [
        {"department_code_in_document": "ИУ5", "source_locator": {"page": 2, "table": 1, "row": 10}},
        {"department_code_in_document": "ИУ6", "source_locator": {"page": 2, "table": 1, "row": 11}},
    ]
    offer["source_locators"] = [row["source_locator"] for row in offer["department_rows_in_document"]]

    _offers, pools, _source_rows, manual, relationships = _build_authoritative_test_records([offer])

    special = next(pool for pool in pools if pool["quota_type"] == "special")
    assert special["scope_level"] == "offering"
    assert special["department_code"] is None
    assert special["places"] == 1
    assert special["source_locators"] == offer["source_locators"]
    assert any(
        row["issue_type"] in {
            "authoritative_offering_department_codes_composite",
            "authoritative_offering_has_combined_department_codes",
        }
        for row in manual
    )
    assert any(row["source_key"] == offer["external_key"] and row["target_key"] == special["external_key"] for row in relationships)


def test_curriculum_evidence_fallback_requires_exact_unique_parent_pdf() -> None:
    record = {
        "external_key": "curriculum_item:study-plan:row:7",
        "curriculum_key": "study_plan:exact",
        "source_document_url": "https://files.example/plan.pdf",
    }
    plan = {
        "external_key": "study_plan:exact",
        "study_plan_url": "https://files.example/plan.pdf",
        "source_artifact_keys": ["artifact:html", "artifact:json", "artifact:pdf"],
    }
    artifacts = {
        "artifact:html": {
            "source_key": "artifact:html",
            "source_type": "bmstu_profile_study_plan_link",
            "content_type": "text/html; charset=utf-8",
            "status_code": 200,
            "sha256": "b" * 64,
        },
        "artifact:json": {
            "source_key": "artifact:json",
            "source_type": "bmstu_profile_study_plan_metadata",
            "content_type": "application/json",
            "status_code": 200,
            "sha256": "c" * 64,
        },
        "artifact:pdf": {
            "source_key": "artifact:pdf",
            "source_type": "bmstu_profile_specific_study_plan_file",
            "content_type": "application/pdf",
            "status_code": 200,
            "sha256": "d" * 64,
            "retrieved_at": "2026-10-02T00:00:00+00:00",
        },
    }

    resolved = _exact_curriculum_parent_pdf(record, {"study_plan:exact": [plan]}, artifacts)
    assert resolved == ("artifact:pdf", artifacts["artifact:pdf"])

    wrong_url = dict(record, source_document_url="https://files.example/another.pdf")
    assert _exact_curriculum_parent_pdf(wrong_url, {"study_plan:exact": [plan]}, artifacts) is None
    duplicate_parent = {"study_plan:exact": [plan, dict(plan)]}
    assert _exact_curriculum_parent_pdf(record, duplicate_parent, artifacts) is None
    two_pdfs = dict(artifacts, **{
        "artifact:pdf-2": dict(artifacts["artifact:pdf"], source_key="artifact:pdf-2")
    })
    two_pdf_plan = dict(plan, source_artifact_keys=["artifact:pdf", "artifact:pdf-2"])
    assert _exact_curriculum_parent_pdf(record, {"study_plan:exact": [two_pdf_plan]}, two_pdfs) is None
    unavailable_pdf = dict(artifacts["artifact:pdf"], status_code=403)
    assert _exact_curriculum_parent_pdf(
        record,
        {"study_plan:exact": [plan]},
        dict(artifacts, **{"artifact:pdf": unavailable_pdf}),
    ) is None


def test_projected_curriculum_evidence_resolves_to_the_exact_parent_pdf() -> None:
    source_rows = [
        json.loads(line)
        for line in (BASE_BUNDLE / "data" / "curriculum_items.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    child = next(
        row for row in source_rows
        if not row.get("source_artifact_key") and not row.get("source_artifact_keys")
    )
    result = project_bundle(BASE_BUNDLE)
    child_id = result.ids_by_table["curriculum_items"][child["external_key"]]
    bridge = next(
        row for row in result.table_rows["curriculum_evidence"]
        if row["curriculum_item_id"] == child_id
    )
    evidence = next(
        row for row in result.table_rows["source_evidence"]
        if row["id"] == bridge["evidence_id"]
    )
    artifact = next(
        row for row in result.table_rows["source_artifacts"]
        if row["id"] == evidence["source_artifact_id"]
    )

    assert artifact["source_type"] == "bmstu_profile_specific_study_plan_file"
    assert artifact["content_type"] == "application/pdf"
    assert len(artifact["sha256"]) == 64
    assert evidence["locator"] == {
        "scope": "study_plan_document",
        "study_plan_external_key": child["curriculum_key"],
        "page_row_locator_available": False,
    }
    assert "page and row are unavailable" in evidence["claim"]


def test_mapper_v3_release_projection_keeps_legacy_evidence_counts_for_rollback() -> None:
    legacy = project_bundle(BASE_BUNDLE, mapper_version="bmstu-2026-bundle-v3")
    current = project_bundle(BASE_BUNDLE, mapper_version="bmstu-2026-bundle-v4")

    assert len(legacy.table_rows["curriculum_evidence"]) == 8_898
    assert len(legacy.table_rows["source_evidence"]) == 13_886
    assert legacy.report.get("curriculum_provenance_inheritance", {}) == {}
    assert len(current.table_rows["curriculum_evidence"]) == 14_165
    assert len(current.table_rows["source_evidence"]) == 19_153
    assert current.report["curriculum_provenance_inheritance"]["inherited_exact_parent_pdf"] == 5_267


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


def test_local_admission_pdf_report_keeps_hash_and_strips_local_path(tmp_path: Path, monkeypatch: Any) -> None:
    source = tmp_path / "БС.pdf"
    body = b"%PDF-1.7\nfixture"
    source.write_bytes(body)
    output = tmp_path / "parse-report.json"

    def parse_pdf(_body: bytes, _reference: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        assert _body == body
        return (
            [{"external_key": "offer:exact", "source_url": str(source)}],
            [{"source_url": "local://private/path", "source_locator": {"page": 1, "row": 2}}],
        )

    monkeypatch.setattr(
        "andromeda.ingestion.universities.bmstu.parser.campaign_2026.admissions.parse_intake_plan_pdf",
        parse_pdf,
    )

    class Parser:
        @staticmethod
        def error(message: str) -> None:
            raise AssertionError(message)

    result = run_parse_admission_plan_command(
        SimpleNamespace(
            input=source,
            output=output,
            captured_at="2026-10-03T12:50:55.107065+00:00",
            log_level="ERROR",
        ),
        Parser(),
    )
    report = json.loads(output.read_text(encoding="utf-8"))
    serialized = json.dumps(report, ensure_ascii=False)
    assert result == 0
    assert report["sources"][0]["sha256"] == hashlib.sha256(body).hexdigest()
    assert report["sources"][0]["local_attachment"] is True
    assert report["sources"][0]["requested_url"] is None
    assert str(source) not in serialized
    assert "local://private/path" not in serialized
    assert report["normalized"]["authoritative_admission_plan"]["source_rows"][0]["source_locator"] == {
        "page": 1,
        "row": 2,
    }


def test_exact_retirement_removes_only_hash_verified_jsonl_rows(tmp_path: Path) -> None:
    from andromeda_parser.bundle import IngestionError

    target = tmp_path / "relationships.jsonl"
    removed = {"external_key": "relationship:old", "target_key": "pool:old"}
    retained_line = b'{ "external_key" : "relationship:keep", "target_key" : "pool:keep" }\r\n'
    removed_line = json.dumps(removed, ensure_ascii=False).encode("utf-8") + b"\r\n"
    target.write_bytes(retained_line + removed_line)
    digest = hashlib.sha256(
        json.dumps(removed, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()

    _remove_jsonl_rows_exact(target, {"relationship:old": digest})
    assert target.read_bytes() == retained_line

    target.write_bytes(retained_line + removed_line.replace(b"pool:old", b"pool:changed"))
    with pytest.raises(IngestionError, match="changed since candidate preparation"):
        _remove_jsonl_rows_exact(target, {"relationship:old": digest})
