"""Build a deterministic admission correction as a new, unpublished bundle."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import shutil
from collections import Counter
from pathlib import Path
from typing import Any

import httpx
from andromeda.ingestion.universities.bmstu.capture import AdmissionOrderManifestEntry
from andromeda.ingestion.universities.bmstu.parser.admission_orders import (
    parse_admission_order_document,
)
from andromeda.ingestion.universities.bmstu.parser.campaign_2026.admissions.authority import (
    EXPECTED_MOSCOW_OFFERING_ROWS,
    build_authoritative_intake_records,
)
from andromeda.ingestion.universities.bmstu.source_metadata import (
    BmstuOrderCampus,
    BmstuOrderDocumentKind,
    BmstuOrderDocumentMetadata,
    BmstuOrderFunding,
    BmstuOrderStage,
)

MAIN_ORDERS_URL = "https://priem.bmstu.ru/lists/upload/orders/first_msk_main.pdf"
MAX_ORDER_BYTES = 16 * 1024 * 1024
_CODE = re.compile(r"(?<!\d)\d{2}\.\d{2}\.\d{2}(?!\d)")


def _read_rows(root: Path, relative: str) -> list[dict[str, Any]]:
    return [json.loads(line) for line in (root / relative).read_text(encoding="utf-8-sig").splitlines() if line.strip()]


def _jsonl(rows: list[dict[str, Any]]) -> bytes:
    return ("".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows)).encode("utf-8")


def _tree_hashes(root: Path) -> dict[str, str]:
    return {
        path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(root.rglob("*")) if path.is_file()
    }


def _is_link(path: Path) -> bool:
    # Path.is_junction was added in Python 3.12; CI also runs on 3.11.
    return path.is_symlink() or getattr(path, "is_junction", lambda: False)()


def _guard_paths(source: Path, destination: Path) -> tuple[Path, Path]:
    for path in (source, *source.parents, destination, *destination.parents):
        if _is_link(path):
            raise ValueError("Bundle paths must not traverse symlinks or junctions")
    source = source.resolve(strict=True)
    destination = destination.resolve()
    if not source.is_dir():
        raise ValueError("Input bundle must be a directory")
    if destination == source or destination.is_relative_to(source):
        raise ValueError("Output must be a new path outside the input bundle, never nested inside it")
    if destination.exists():
        raise ValueError("Output must be a new path; destination already exists")
    report_path = destination.with_name(destination.name + "-repair-report.json")
    if report_path.exists() or _is_link(report_path):
        raise ValueError("Repair audit report must also have a new path")
    if any(_is_link(path) for path in source.rglob("*")):
        raise ValueError("Input bundle must not contain symlinks or junctions")
    return source, destination


def _repair_statistics(root: Path, body: bytes) -> tuple[list[dict[str, Any]], int, str]:
    if len(body) > MAX_ORDER_BYTES:
        raise ValueError("Main orders document exceeds the in-memory byte limit")
    documents = _read_rows(root, "data/admission_result_sources.jsonl")
    sources = [row for row in documents if row.get("classification") == {
        "admission_year": 2026, "campus": "moscow", "document_kind": "bachelor_specialist",
        "funding": "budget", "stage": "main", "study_form": None,
    }]
    if len(sources) != 1:
        raise ValueError("Expected exactly one captured Moscow main-budget order source")
    source = sources[0]
    digest = hashlib.sha256(body).hexdigest()
    artifact_key = source.get("source_artifact_key")
    artifacts = [row for row in _read_rows(root, "source_artifacts.jsonl") if row.get("source_key") == artifact_key]
    if (
        len(artifacts) != 1
        or digest != artifacts[0].get("sha256")
        or digest != source.get("sha256")
        or digest != source.get("source_sha256")
    ):
        raise ValueError("Main orders hash differs from the captured source; refusing to reclassify another document")
    statistics = _read_rows(root, "data/admission_statistics.jsonl")
    existing = [row for row in statistics if row.get("source_artifact_key") == artifact_key]
    if not existing or any(row.get("source_sha256") != digest for row in existing):
        raise ValueError("Existing main-budget statistics do not match the verified document hash")
    metadata = BmstuOrderDocumentMetadata(
        manifest_entry=AdmissionOrderManifestEntry("", MAIN_ORDERS_URL),
        document_kind=BmstuOrderDocumentKind.BACHELOR_SPECIALIST,
        funding=BmstuOrderFunding.BUDGET,
        stage=BmstuOrderStage.MAIN,
        campus=BmstuOrderCampus.MOSCOW,
        admission_year=2026,
        study_form=None,
    )
    parsed = parse_admission_order_document(body, metadata)
    if parsed.failed or not parsed.observations:
        raise ValueError("Verified main orders could not be parsed into aggregate observations")

    def identity(row: dict[str, Any]) -> tuple[Any, ...]:
        return row.get("direction_code"), row.get("status"), row.get("score")

    observed = {(item.direction_code, item.status, int(item.score) if item.score is not None else None): item for item in parsed.observations}
    if len(observed) != len(parsed.observations) or set(observed) != {identity(row) for row in existing}:
        raise ValueError("Reparsed main-order aggregates differ from the existing immutable source facts")
    result: list[dict[str, Any]] = []
    corrected = 0
    for row in statistics:
        if row.get("source_artifact_key") != artifact_key:
            result.append(row)
            continue
        observation = observed[identity(row)]
        if observation.competition_type.value != "general":
            raise ValueError("Main orders contain an unexpected competition route; refusing a bulk correction")
        if row.get("competition_type") not in {"other", "general"}:
            raise ValueError("Existing main-order route is outside this narrow repair")
        repaired = dict(row)
        repaired["competition_type"] = "general"
        repaired["external_key"] = row["external_key"].replace(":main:other:", ":main:general:")
        # Keep the public privacy policy: no applicant PDF, text, identifiers or
        # private order URL is persisted, only the verified aggregate facts.
        repaired["source_url"] = None
        result.append(repaired)
        corrected += row.get("competition_type") == "other"
    return result, corrected, digest


def repair_bundle(input: str | Path, output: str | Path, main_order_body: bytes | None = None) -> dict[str, Any]:
    """Create a new bundle from retained exact source rows; never publish it."""
    source, destination = _guard_paths(Path(input).absolute(), Path(output).absolute())
    input_hashes = _tree_hashes(source)
    offers = _read_rows(source, "data/program_offerings.jsonl")
    if len(offers) != EXPECTED_MOSCOW_OFFERING_ROWS:
        raise ValueError("This repair requires the reviewed 127-row Moscow admission source")
    source_identity = {(row.get("source_artifact_key"), row.get("source_sha256"), row.get("source_retrieved_at"), row.get("source_url")) for row in offers}
    if len(source_identity) != 1:
        raise ValueError("Admission offer rows must belong to one captured primary source")
    artifact_key, source_hash, retrieved_at, source_url = next(iter(source_identity))
    artifacts = [row for row in _read_rows(source, "source_artifacts.jsonl") if row.get("source_key") == artifact_key]
    if len(artifacts) != 1 or artifacts[0].get("sha256") != source_hash:
        raise ValueError("Retained intake source hash does not match the source artifact")
    corrected_code_rows: list[str] = []
    for offer in offers:
        cells = offer.get("source_row", [])
        explicit = list(dict.fromkeys(_CODE.findall(cells[1]))) if len(cells) > 1 and isinstance(cells[1], str) else []
        if explicit and explicit != offer.get("direction_codes_in_document"):
            corrected_code_rows.append(offer["external_key"])
            offer["direction_codes_in_document"] = explicit
    source_rows = _read_rows(source, "data/admission_plan_source_rows.jsonl")
    for row in source_rows:
        explicit = list(dict.fromkeys(_CODE.findall(row.get("direction_code_in_source_cell") or "")))
        if explicit:
            row["direction_code_in_document"] = " / ".join(explicit)
    programs = _read_rows(source, "data/educational_programs.jsonl")
    new_offers, new_pools, source_rows, new_reviews, new_relations = build_authoritative_intake_records(
        offers, source_rows,
        directions=_read_rows(source, "data/directions.jsonl"),
        departments=_read_rows(source, "data/departments.jsonl"),
        programs=programs,
        campaign_key="campaign:bmstu:2026", source_url=source_url,
        source_artifact_key=artifact_key, source_retrieved_at=retrieved_at,
        source_sha256=source_hash, previous_offerings=offers,
    )
    previous_by_key = {row["external_key"]: row for row in offers}
    for row in new_offers:
        prior = previous_by_key[row["external_key"]]
        if prior.get("source_sha256") == row.get("source_sha256"):
            for field in ("study_form", "language"):
                if row.get(field) is None:
                    row[field] = prior.get(field)
    offer_keys = {row["external_key"] for row in offers}
    old_pools = _read_rows(source, "data/competition_pools.jsonl")
    removed_pool_keys = {
        row["external_key"] for row in old_pools
        if row.get("source_authority") == "user_assigned_primary_source"
        and row.get("quota_type") in {"special", "separate", "general_competition"}
    }
    preserved_pools = [row for row in old_pools if row["external_key"] not in removed_pool_keys]
    relations = [row for row in _read_rows(source, "data/relationships.jsonl") if not (
        row.get("target_key") in removed_pool_keys
        or (row.get("relation_type") == "offering_includes_catalog_program" and row.get("source_key") in offer_keys)
    )]
    relations.extend(new_relations)
    relation_keys = [row["external_key"] for row in relations]
    if len(relation_keys) != len(set(relation_keys)):
        raise ValueError("Repair would create duplicate relationship keys")
    with (source / "manual_review.csv").open(encoding="utf-8-sig", newline="") as stream:
        reviews = list(csv.DictReader(stream))
    fixed_offers = {row["external_key"] for row in new_offers if row["catalog_join_status"] != "unresolved"}
    resolved_issues = {"offering_to_catalog_profile_unresolved", "authoritative_offering_department_codes_composite", "authoritative_offering_direction_code_composite", "authoritative_offering_direction_not_in_catalog"}
    retained_reviews = [row for row in reviews if not (
        (row.get("record_key") in removed_pool_keys and row.get("issue_type") == "authoritative_direction_quota_conflict")
        or (row.get("record_key") in fixed_offers and row.get("issue_type") in resolved_issues)
    )]
    review_signatures = {(row.get("record_key"), row.get("issue_type")) for row in retained_reviews}
    for row in new_reviews:
        signature = row.get("record_key"), row.get("issue_type")
        if signature not in review_signatures:
            retained_reviews.append(row)
            review_signatures.add(signature)
    review_stream = io.StringIO(newline="")
    writer = csv.DictWriter(review_stream, fieldnames=["record_key", "issue_type", "source_url", "details"], lineterminator="\n")
    writer.writeheader()
    writer.writerows(retained_reviews)
    replacements = {
        "data/program_offerings.jsonl": _jsonl(new_offers),
        "data/competition_pools.jsonl": _jsonl([*preserved_pools, *new_pools]),
        "data/admission_plan_source_rows.jsonl": _jsonl(source_rows),
        "data/relationships.jsonl": _jsonl(relations),
        "manual_review.csv": review_stream.getvalue().encode("utf-8"),
    }
    statistics_corrected = 0
    order_hash = None
    if main_order_body is not None:
        statistics, statistics_corrected, order_hash = _repair_statistics(source, main_order_body)
        replacements["data/admission_statistics.jsonl"] = _jsonl(statistics)
    if _tree_hashes(source) != input_hashes:
        raise ValueError("Input bundle changed during repair")
    shutil.copytree(source, destination)
    for relative, body in replacements.items():
        (destination / relative).write_bytes(body)
    output_hashes = _tree_hashes(destination)
    covered_programs = {key for row in new_offers for key in [row.get("educational_program_key"), *row.get("educational_program_keys", [])] if key}
    uncovered_programs = []
    for program in programs:
        if program["external_key"] in covered_programs:
            continue
        same_source_identity = [offer for offer in new_offers if (
            program.get("direction_code") in offer.get("direction_codes_in_document", [])
            and program.get("department_code") in offer.get("department_codes_in_document", [])
        )]
        uncovered_programs.append({
            "program_key": program["external_key"],
            "program_name": program.get("name"),
            "direction_code": program.get("direction_code"),
            "department_code": program.get("department_code"),
            "reason": "source_profile_name_differs_or_is_not_explicitly_listed" if same_source_identity else "no_intake_row_for_exact_direction_and_department",
            "related_source_offering_keys": [offer["external_key"] for offer in same_source_identity],
        })
    report = {
        "schema_version": 1,
        "operation": "deterministic_admission_repair_unpublished_bundle",
        "offering_count": len(new_offers),
        "offering_pool_count": len(new_pools),
        "preserved_targeted_pools": sum(row.get("quota_type") == "targeted" for row in preserved_pools),
        "shared_program_links": sum(row["relation_type"] == "offering_includes_catalog_program" for row in new_relations),
        "covered_catalog_programs": len(covered_programs),
        "uncovered_catalog_programs": uncovered_programs,
        "offering_link_statuses": dict(sorted(Counter(row["catalog_join_status"] for row in new_offers).items())),
        "corrected_explicit_code_rows": corrected_code_rows,
        "main_order_statistics_reclassified": statistics_corrected,
        "verified_main_order_sha256": order_hash,
        "unresolved_reasons": dict(sorted(Counter(row["issue_type"] for row in new_reviews if row["record_key"] not in fixed_offers).items())),
        "reviews_removed": len(reviews) - sum(row in reviews for row in retained_reviews),
        "primary_source_artifact_key": artifact_key,
        "primary_source_sha256": source_hash,
        "raw_applicant_data_saved": False,
        "input_file_sha256": input_hashes,
        "output_file_sha256": output_hashes,
        "changed_files": [relative for relative in sorted(output_hashes) if output_hashes[relative] != input_hashes.get(relative)],
    }
    # Keep the audit report outside the bundle so validation and release
    # fingerprints describe only the actual release payload.
    report_path = destination.with_name(destination.name + "-repair-report.json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    return report


def _download_main_orders() -> bytes:
    body = bytearray()
    with httpx.stream("GET", MAIN_ORDERS_URL, timeout=30, follow_redirects=False) as response:
        response.raise_for_status()
        for chunk in response.iter_bytes():
            if len(body) + len(chunk) > MAX_ORDER_BYTES:
                raise ValueError("Main orders download exceeds the in-memory byte limit")
            body.extend(chunk)
    return bytes(body)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--verify-main-orders", action="store_true", help="Verify the captured official main-order bytes in memory and repair competition routes")
    args = parser.parse_args()
    _guard_paths(args.input.absolute(), args.output.absolute())
    report = repair_bundle(args.input, args.output, _download_main_orders() if args.verify_main_orders else None)
    print(json.dumps({key: value for key, value in report.items() if key not in {"input_file_sha256", "output_file_sha256"}}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
