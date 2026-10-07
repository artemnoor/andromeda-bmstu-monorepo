"""Small, read-only probes of selected public BMSTU pages and documents."""

from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlsplit

import httpx
from bs4 import BeautifulSoup

from andromeda.ingestion.universities.bmstu.capture import (
    ORDERS_MANIFEST_URL,
    S06_API_BASE_URL,
    S06_CATALOG_URL,
    S06_DETAIL_API_BASE_URL,
    BmstuSource,
    parse_orders_manifest,
)
from andromeda.ingestion.universities.bmstu.fetch import FetchConfig, Fetcher
from academic_data_service.importer.bundle import BundleReader
from andromeda.ingestion.universities.bmstu.parser.campaign_2026.admission_information.parser import (
    parse_admission_information,
)
from andromeda.ingestion.universities.bmstu.parser.campaign_2026.catalog.parser import (
    parse_catalog_api,
    parse_catalog_html,
)
from andromeda.ingestion.universities.bmstu.parser.campaign_2026.curricula.parser import (
    parse_curriculum_document,
)
from andromeda.ingestion.universities.bmstu.parser.campaign_2026.program_cards.parser import (
    parse_program_card,
)
from andromeda.ingestion.universities.bmstu.parser.campaign_2026.tuition.parser import (
    parse_cost_page,
)
from andromeda_parser.ingest import IngestionError


logger = logging.getLogger("andromeda.ingestion.live_probe")
ADMISSION_INFO_URL = "https://course.bmstu.ru/edu/abiturient/"
MAX_REQUESTS = 12
PROBE_USER_AGENT = "Andromeda-BMSTU-Source-Validation/0.1 (bounded public-source check)"


class _CappedTransport(httpx.BaseTransport):
    """Cap actual HTTP exchanges, including redirects inside one fetch call."""

    def __init__(self, maximum: int, *, transport: httpx.BaseTransport | None = None) -> None:
        self.maximum = maximum
        self.requests = 0
        self._transport = transport or httpx.HTTPTransport()

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        if self.requests >= self.maximum:
            raise httpx.RequestError("live source probe reached its hard HTTP request limit", request=request)
        self.requests += 1
        return self._transport.handle_request(request)

    def close(self) -> None:
        self._transport.close()


class _RequestBudget:
    def __init__(self, fetcher: Fetcher, maximum: int = MAX_REQUESTS) -> None:
        self.fetcher = fetcher
        self.maximum = maximum
        self.requests = 0

    def fetch(self, url: str):
        if self.requests >= self.maximum:
            raise IngestionError(f"live source probe reached its hard request limit ({self.maximum})")
        self.requests += 1
        logger.debug("live probe request=%d/%d source_host=%s", self.requests, self.maximum, urlsplit(url).hostname)
        return self.fetcher.fetch_http(url)

    def fetch_http(self, url: str):
        return self.fetch(url)


def _read_rows(bundle: Path, dataset: str) -> dict[str, dict[str, Any]]:
    try:
        with BundleReader(bundle) as reader:
            relative_path = f"data/{dataset}"
            if not reader.has_file(relative_path):
                return {}
            payload = reader.read_bytes(relative_path).decode("utf-8-sig")
        rows = [json.loads(line) for line in payload.splitlines() if line.strip()]
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise IngestionError(f"could not read comparison dataset {dataset}") from error
    result: dict[str, dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("external_key"), str):
            continue
        if row["external_key"] in result:
            raise IngestionError(f"comparison dataset has duplicate key: {dataset}")
        result[row["external_key"]] = row
    return result


def _compare_exact_keys(
    live_rows: list[dict[str, Any]],
    current_rows: dict[str, dict[str, Any]],
    *,
    fields: tuple[str, ...],
) -> dict[str, Any]:
    comparisons: list[dict[str, Any]] = []
    unkeyed_rows = 0
    exact_matches = 0
    live_unmatched = 0
    changed_records = 0
    for live in live_rows:
        key = live.get("external_key")
        if not isinstance(key, str):
            unkeyed_rows += 1
            continue
        current = current_rows.get(key)
        changed = [field for field in fields if current is not None and live.get(field) != current.get(field)]
        if current is None:
            live_unmatched += 1
        else:
            exact_matches += 1
        if changed:
            changed_records += 1
        if current is None or changed:
            comparisons.append(
                {
                    "external_key": key,
                    "match": current is not None,
                    "changed_fields": changed,
                    "current_values": {field: current.get(field) for field in fields} if current else None,
                    "live_values": {field: live.get(field) for field in fields},
                }
            )
    return {
        "live_records_with_exact_key": len(live_rows) - unkeyed_rows,
        "live_records_without_exact_key": unkeyed_rows,
        "exact_key_matches": exact_matches,
        "live_keys_not_in_current_release": live_unmatched,
        "changed_records": changed_records,
        "differences_only": True,
        "records": comparisons,
    }


def _source_record(url: str, resource: Any) -> dict[str, Any]:
    return {
        "requested_url": _safe_report_url(url),
        "final_url": _safe_report_url(resource.final_url),
        "status_code": resource.status_code,
        "content_type": resource.content_type,
        "retrieved_at": resource.fetched_at,
        "byte_size": len(resource.body),
        "sha256": hashlib.sha256(resource.body).hexdigest() if resource.body else None,
        "attempts": resource.attempts,
        "error_code": resource.error_code,
        "retry_class": resource.retry_class,
        "redirect_count": len(resource.redirects),
    }


def _safe_report_url(url: str) -> str:
    """Keep host/path context while omitting query tokens and share-link keys."""
    parsed = urlsplit(url)
    host = (parsed.hostname or "").casefold()
    path = parsed.path or "/"
    if (
        host in {"disk.yandex.ru", "clck.ru", "clck.su"}
        or host.endswith(".yandex.net")
        or (host.endswith(".yandex.ru") and host != "cloud-api.yandex.net")
    ):
        path = "/[REDACTED]"
    return f"{parsed.scheme}://{host}{path}"


def _find_exam_requirements_pdf(body: bytes) -> str | None:
    soup = BeautifulSoup(body, "html.parser")
    for anchor in soup.find_all("a", href=True):
        label = " ".join(anchor.get_text(" ", strip=True).casefold().split())
        href = str(anchor.get("href", ""))
        if ".pdf" not in urlsplit(href).path.casefold():
            continue
        if any(term in label for term in ("приложение 1", "вступительных испытаний", "минимальн")):
            from urllib.parse import urljoin

            selected = urljoin(ADMISSION_INFO_URL, href)
            parsed = urlsplit(selected)
            if parsed.scheme == "https" and (parsed.hostname == "bmstu.ru" or (parsed.hostname or "").endswith(".bmstu.ru")):
                return selected
    return None


def probe_official_sources(
    compare_bundle: Path, *, output_path: Path, release_id: str | None = None
) -> dict[str, Any]:
    """Fetch at most eight selected public resources; never stages or commits their data."""

    base = compare_bundle.expanduser().resolve(strict=True)
    with BundleReader(base) as reader:
        comparison_digest = reader.input_digest
    if output_path.is_symlink() or output_path.exists():
        raise IngestionError("live probe report path must be a new regular file")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    transport = _CappedTransport(MAX_REQUESTS)
    fetcher = Fetcher(
        FetchConfig(
            timeout_seconds=10.0,
            retries=0,
            user_agent=PROBE_USER_AGENT,
            browser_mode="never",
            max_body_bytes=30_000_000,
            request_interval_seconds=1.0,
            total_budget_seconds=10.0,
            max_redirects=1,
        ),
        transport=transport,
    )
    budget = _RequestBudget(fetcher)
    source_records: list[dict[str, Any]] = []
    source_gaps: list[dict[str, str]] = []
    categories: dict[str, dict[str, Any]] = {}
    exact_comparisons: dict[str, Any] = {}
    catalog_rows: tuple[dict[str, Any], ...] = ()
    detail: dict[str, Any] | None = None
    admission_body: bytes | None = None
    try:
        selected_urls = (
            ("program_catalog_html", S06_CATALOG_URL),
            ("program_catalog_api_one_record", S06_API_BASE_URL + "?limit=1&offset=0"),
            ("admission_information", ADMISSION_INFO_URL),
            ("admission_order_index", ORDERS_MANIFEST_URL),
        )
        resources: dict[str, Any] = {}
        for name, url in selected_urls:
            resource = budget.fetch(url)
            resources[name] = resource
            source_records.append({"source": name, **_source_record(url, resource)})
            if not resource.ok:
                source_gaps.append(
                    {
                        "source": name,
                        "url": _safe_report_url(url),
                        "reason": "http_403" if resource.status_code == 403 else "http_429" if resource.status_code == 429 else resource.error_code or "source_unavailable",
                    }
                )

        catalog_html = resources["program_catalog_html"]
        html_cards: tuple[dict[str, str], ...] = ()
        if catalog_html.ok:
            try:
                html_cards = parse_catalog_html(catalog_html.body)
                categories["program_catalog_html"] = {
                    "status": "parsed" if html_cards else "parsed_empty",
                    "visible_card_links": len(html_cards),
                }
                if not html_cards:
                    source_gaps.append(
                        {"source": "program_catalog_html", "url": _safe_report_url(S06_CATALOG_URL), "reason": "no_program_links_in_selected_html"}
                    )
            except ValueError as error:
                categories["program_catalog_html"] = {"status": "parser_gap", "error_type": type(error).__name__}
                source_gaps.append({"source": "program_catalog_html", "url": _safe_report_url(S06_CATALOG_URL), "reason": "parser_contract_error"})
        else:
            categories["program_catalog_html"] = {"status": "source_gap", "visible_card_links": None}

        api = resources["program_catalog_api_one_record"]
        if api.ok:
            try:
                api_payload = json.loads(api.body.decode("utf-8-sig"))
                api_page = api_payload.get("data", []) if isinstance(api_payload, dict) else []
                if not isinstance(api_page, list) or len(api_page) > 1:
                    raise IngestionError("catalog API ignored the one-record probe limit")
                catalog_rows = parse_catalog_api(api.body)
                meta = api_payload.get("meta", {})
                categories["program_catalog_api"] = {
                    "status": "parsed",
                    "returned_records": len(catalog_rows),
                    "requested_limit": 1,
                    "reported_total": meta.get("count") if isinstance(meta, dict) else None,
                    "detail_cards_fetched": 0,
                }
            except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as error:
                categories["program_catalog_api"] = {"status": "parser_gap", "error_type": type(error).__name__}
                source_gaps.append({"source": "program_catalog_api", "url": _safe_report_url(S06_API_BASE_URL), "reason": "parser_contract_error"})
        else:
            categories["program_catalog_api"] = {"status": "source_gap", "returned_records": None}

        if catalog_rows:
            first = catalog_rows[0]
            detail_url = S06_DETAIL_API_BASE_URL + quote(str(first["slug"]), safe="")
            try:
                detail_resource = budget.fetch(detail_url)
                source_records.append({"source": "one_program_detail", **_source_record(detail_url, detail_resource)})
                if detail_resource.ok:
                    detail = parse_program_card(detail_resource.body, str(first["code"]), detail_url)
                    categories["program_card_and_departments"] = {
                        "status": "parsed",
                        "direction_code": first["code"],
                        "department_count": len(detail.get("departments", [])),
                        "program_count": len(detail.get("programs", [])),
                        "study_plan_links_seen": sum(bool(row.get("study_plan_url")) for row in detail.get("programs", [])),
                        "upstream_places_present": detail.get("raw_places_ignored"),
                        "upstream_price_present": detail.get("raw_price_ignored"),
                    }
                    direction_current = _read_rows(base, "directions.jsonl")
                    department_current = _read_rows(base, "departments.jsonl")
                    program_current = _read_rows(base, "educational_programs.jsonl")
                    exact_comparisons["direction"] = _compare_exact_keys(
                        [detail["direction"]], direction_current, fields=("code", "name")
                    )
                    exact_comparisons["departments"] = _compare_exact_keys(
                        detail["departments"], department_current, fields=("code", "name")
                    )
                    exact_comparisons["programs"] = _compare_exact_keys(
                        detail["programs"], program_current, fields=("code", "name", "study_plan_url")
                    )
                else:
                    categories["program_card_and_departments"] = {"status": "source_gap"}
                    source_gaps.append({"source": "one_program_detail", "url": _safe_report_url(detail_url), "reason": "http_403" if detail_resource.status_code == 403 else "http_429" if detail_resource.status_code == 429 else detail_resource.error_code or "source_unavailable"})
            except (ValueError, IngestionError) as error:
                categories["program_card_and_departments"] = {"status": "parser_or_budget_gap", "error_type": type(error).__name__}
                source_gaps.append({"source": "one_program_detail", "url": _safe_report_url(detail_url), "reason": "parser_or_request_budget_gap"})
        else:
            categories["program_card_and_departments"] = {"status": "source_gap"}

        if detail:
            selected_profile = next(
                (row for row in detail.get("programs", []) if row.get("study_plan_url")), None
            )
            if selected_profile:
                source = BmstuSource(fetcher=budget)  # exactly one plan URL; its resolver/download remain under the same cap
                try:
                    plan_snapshots = source._fetch_public_documents(
                        str(selected_profile["study_plan_url"]), max_documents=1
                    )
                    source_gaps.extend(
                        {
                            "source": str(item.entity_type),
                            "url": _safe_report_url(str(item.source_url)),
                            "reason": str(item.reason),
                        }
                        for item in source._capture_gaps
                    )
                    source_records.extend(
                        {
                            "source": snapshot.source_kind,
                            "requested_url": _safe_report_url(str(snapshot.requested_url)),
                            "final_url": _safe_report_url(str(snapshot.final_url)),
                            "status_code": snapshot.status_code,
                            "content_type": snapshot.content_type,
                            "retrieved_at": snapshot.captured_at.isoformat(),
                            "byte_size": len(snapshot.body),
                            "sha256": snapshot.content_sha256,
                            "attempts": 1,
                        }
                        for snapshot in plan_snapshots
                    )
                    pdf = next((item for item in plan_snapshots if item.source_kind == "bmstu_curriculum_document"), None)
                    if pdf:
                        parsed_plan = parse_curriculum_document(
                            pdf.body,
                            content_type=pdf.content_type,
                            final_url=str(pdf.final_url),
                            share_url=str(selected_profile["study_plan_url"]),
                            profile={"code": selected_profile.get("code"), "name": selected_profile.get("name")},
                            retrieved_at=pdf.captured_at.isoformat(),
                        )
                        categories["study_plan_and_disciplines"] = {
                            "status": "parsed" if not parsed_plan.get("error") else "parser_gap",
                            "profile_code": parsed_plan.get("profile_code"),
                            "education_year": parsed_plan.get("education_year"),
                            "semester_count": parsed_plan.get("semester_count"),
                            "discipline_rows": len(parsed_plan.get("items", [])),
                            "parser_error": parsed_plan.get("error"),
                        }
                        current_items = _read_rows(base, "curriculum_items.jsonl")
                        plan_items = [
                            item for item in parsed_plan.get("items", []) if isinstance(item, dict)
                        ]
                        exact_comparisons["curriculum_items"] = _compare_exact_keys(
                            plan_items, current_items, fields=("discipline", "semester", "hours", "credits")
                        )
                        if exact_comparisons["curriculum_items"]["live_records_without_exact_key"]:
                            source_gaps.append(
                                {
                                    "source": "curriculum_items",
                                    "url": _safe_report_url(str(selected_profile["study_plan_url"])),
                                    "reason": "parser_emitted_discipline_rows_without_exact_external_keys",
                                }
                            )
                    else:
                        categories["study_plan_and_disciplines"] = {"status": "source_gap", "discipline_rows": None}
                except (ValueError, IngestionError, OSError) as error:
                    categories["study_plan_and_disciplines"] = {"status": "parser_or_budget_gap", "error_type": type(error).__name__}
                    source_gaps.append({"source": "one_study_plan", "url": _safe_report_url(str(selected_profile["study_plan_url"])), "reason": "parser_or_request_budget_gap"})
                finally:
                    source.close()
            else:
                categories["study_plan_and_disciplines"] = {"status": "source_gap", "discipline_rows": None}
                source_gaps.append({"source": "one_study_plan", "url": _safe_report_url(S06_DETAIL_API_BASE_URL), "reason": "selected_detail_has_no_public_plan_link"})
        else:
            categories["study_plan_and_disciplines"] = {"status": "source_gap", "discipline_rows": None}

        admission = resources["admission_information"]
        if admission.ok:
            admission_body = admission.body
            try:
                stats = parse_admission_information(admission.body, ADMISSION_INFO_URL)["historical_results"]
                tuition = parse_cost_page(admission.body, ADMISSION_INFO_URL)["tuition_records"]
                visible = BeautifulSoup(admission.body, "html.parser").get_text(" ", strip=True)
                date_mentions = sorted(
                    set(
                        re.findall(
                            r"\b\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+20\d{2}(?:\s+года)?(?:\s+в\s+\d{1,2}\s+час(?:а|ов))?",
                            visible,
                            flags=re.I,
                        )
                    )
                )
                categories["admission_information"] = {
                    "status": "parsed",
                    "aggregate_statistics": len(stats),
                    "tuition_rows": len(tuition),
                    "campaign_date_mentions": date_mentions[:8],
                    "applicant_rows_emitted": 0,
                }
                exact_comparisons["historical_statistics"] = _compare_exact_keys(
                    stats,
                    _read_rows(base, "historical_admission_statistics.jsonl"),
                    fields=("admitted_count", "minimum_score", "maximum_score", "average_score"),
                )
                exact_comparisons["tuition"] = _compare_exact_keys(
                    tuition, _read_rows(base, "tuition.jsonl"), fields=("annual_amount_rub", "currency", "study_year_label")
                )
                if exact_comparisons["tuition"]["live_keys_not_in_current_release"]:
                    source_gaps.append(
                        {
                            "source": "tuition",
                            "url": _safe_report_url(ADMISSION_INFO_URL),
                            "reason": "live_tuition_external_keys_do_not_match_current_release_keys",
                        }
                    )
            except (ValueError, OSError) as error:
                categories["admission_information"] = {"status": "parser_gap", "error_type": type(error).__name__}
                source_gaps.append({"source": "admission_information", "url": _safe_report_url(ADMISSION_INFO_URL), "reason": "parser_contract_error"})
        else:
            categories["admission_information"] = {"status": "source_gap"}

        order_resource = resources["admission_order_index"]
        if order_resource.ok:
            try:
                order_entries = parse_orders_manifest(order_resource.body, ORDERS_MANIFEST_URL)
                categories["admission_orders_and_places"] = {
                    "status": "manifest_parsed",
                    "enabled_document_count": len(order_entries),
                    "document_bodies_fetched": 0,
                    "applicant_documents_excluded": True,
                }
            except Exception as error:
                categories["admission_orders_and_places"] = {"status": "parser_gap", "error_type": type(error).__name__}
                source_gaps.append({"source": "admission_order_index", "url": _safe_report_url(ORDERS_MANIFEST_URL), "reason": "parser_contract_error"})
        else:
            categories["admission_orders_and_places"] = {"status": "source_gap"}

        requirements_pdf_url = _find_exam_requirements_pdf(admission_body) if admission_body else None
        if requirements_pdf_url and budget.requests < MAX_REQUESTS:
            requirement_resource = budget.fetch(requirements_pdf_url)
            source_records.append({"source": "exam_requirements_appendix", **_source_record(requirements_pdf_url, requirement_resource)})
            if requirement_resource.ok:
                from andromeda.ingestion.universities.bmstu.parser.campaign_2026.admissions.parser import (
                    parse_exam_requirements_pdf,
                )

                try:
                    requirement_rows, _raw_rows = parse_exam_requirements_pdf(requirement_resource.body, requirements_pdf_url)
                    categories["exams_and_requirements"] = {
                        "status": "parsed",
                        "directions_with_requirements": len(requirement_rows),
                        "exam_requirements": sum(len(row.get("exams", [])) for row in requirement_rows),
                    }
                    exact_comparisons["exam_requirements"] = _compare_exact_keys(
                        requirement_rows,
                        _read_rows(base, "admission_exam_requirements.jsonl"),
                        fields=("requirement_tree",),
                    )
                except Exception as error:
                    categories["exams_and_requirements"] = {"status": "parser_gap", "error_type": type(error).__name__}
                    source_gaps.append({"source": "exam_requirements_appendix", "url": _safe_report_url(requirements_pdf_url), "reason": "parser_contract_error"})
            else:
                categories["exams_and_requirements"] = {"status": "source_gap"}
                source_gaps.append({"source": "exam_requirements_appendix", "url": _safe_report_url(requirements_pdf_url), "reason": "http_403" if requirement_resource.status_code == 403 else "http_429" if requirement_resource.status_code == 429 else requirement_resource.error_code or "source_unavailable"})
        else:
            categories["exams_and_requirements"] = {"status": "source_gap", "reason": "official requirements PDF link not found on selected page or request budget exhausted"}
            source_gaps.append({"source": "exam_requirements_appendix", "url": _safe_report_url(ADMISSION_INFO_URL), "reason": "official_requirements_link_unavailable"})

        categories["places_and_quotas"] = {
            "status": "source_gap",
            "reason": "bounded detail probe exposes no typed places/quota rows; order index was inspected without fetching applicant-level documents",
        }
        source_gaps.append({"source": "places_and_quotas", "url": _safe_report_url(S06_DETAIL_API_BASE_URL), "reason": "no safe aggregate places/quota table identified in this bounded probe"})
        report = {
            "schema_version": 1,
            "probe_date": datetime.now(UTC).isoformat(),
            "coverage": "partial",
            "publication": "not_committed",
            "scope": "sample only: one API catalog row, one detail card, at most one linked plan, one admissions page, one orders index, one requirements PDF",
            "request_policy": {
                "hard_fetch_call_limit": MAX_REQUESTS,
                "fetch_calls_used": budget.requests,
                "timeout_seconds": 10,
                "retries": 0,
                "request_interval_seconds": 1,
                "max_http_requests_including_redirects": MAX_REQUESTS,
                "http_requests_used": transport.requests,
                "max_body_bytes": 30_000_000,
                "browser_fallback": False,
                "applicant_order_documents_fetched": False,
                "live_data_committed": False,
            },
            "comparison_release": {"release_id": release_id, "bundle_sha256": comparison_digest},
            "sources": source_records,
            "categories": categories,
            "exact_external_key_comparison": exact_comparisons,
            "source_gaps": source_gaps,
            "limitations": [
                "A bounded source sample does not demonstrate full live parser coverage.",
                "No current values from this report were staged or committed.",
                "The order index was inspected only as metadata; individual result documents were not downloaded.",
                "No automatic deletions or identity matching by similar names were performed.",
            ],
        }
        output_path.write_text(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        return report
    finally:
        fetcher.close()


__all__ = ["probe_official_sources"]
