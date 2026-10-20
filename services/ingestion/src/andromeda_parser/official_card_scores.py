"""Offline, bounded addition of exact official-card scores to a new release bundle.

Published input files are never modified. Enrollment aggregates stay untouched;
missing card scores remain null and never imply BVI or zero.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import math
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from andromeda.ingestion.universities.bmstu.parser.campaign_2026.common import (
    normalize_code,
)

KIND = "official_program_card_passing_score"
MAX_CARDS = 100
MAX_BODY_BYTES = 5_000_000
logger = logging.getLogger(__name__)


def _score(value: object) -> int | None:
    if value is None or (
        isinstance(value, str) and value.strip() in {"", "-", "—", "–"}
    ):
        return None
    if isinstance(value, bool):
        raise ValueError("Boolean is not an official passing score")  # noqa: TRY004
    if isinstance(value, str) and value.strip().isdigit():
        value = int(value.strip())
    if not isinstance(value, int) or not math.isfinite(value) or not 0 <= value <= 400:
        raise ValueError(
            "Official passing score must be an integer in [0, 400] or explicit unavailable"
        )
    return value


def _read_card(body: bytes, direction_code: str, source_url: str) -> dict[str, Any]:
    url = urlsplit(source_url)
    if (
        url.scheme != "https"
        or url.netloc != "api.www.bmstu.ru"
        or not url.path.startswith("/majors/")
        or url.query
        or url.fragment
    ):
        raise ValueError("Expected exact official BMSTU major-card URL")
    if len(body) > MAX_BODY_BYTES:
        raise ValueError("Card exceeds bounded response size")
    root = json.loads(body.decode("utf-8-sig"))
    if not isinstance(root, dict) or not isinstance(root.get("additional"), dict):
        raise ValueError("Official card has no additional object")  # noqa: TRY004
    if normalize_code(root["additional"].get("code")) != normalize_code(direction_code):
        raise ValueError("Official card direction identity disagrees with catalog")
    return root


def parse_official_card_scores(
    body: bytes, *, direction_code: str, source_url: str, year: int
) -> list[dict[str, Any]]:
    """Parse only the requested year's budget/paid official aggregate, no fallback."""
    if not 1900 <= year <= 2200:
        raise ValueError("Invalid admission year")
    root = _read_card(body, direction_code, source_url)
    old_points = root["additional"].get("oldPoints")
    if not isinstance(old_points, dict) or not isinstance(
        old_points.get(str(year)), dict
    ):
        raise ValueError("Official card omits requested admission year")  # noqa: TRY004
    values = old_points[str(year)]
    code = normalize_code(direction_code)
    return [
        {
            "external_key": f"official_card_score:bmstu:{year}:{code}:{funding}",
            "direction_code": code,
            "direction_key": f"direction:bmstu:{code}",
            "admission_year": year,
            "funding_type": funding,
            "funding_type_key": f"funding_type:{funding}",
            "outcome_type": KIND,
            "scope_type": "direction",
            "scope_label": code,
            "campus_scope": "official_direction_card",
            "study_form": None,
            "minimum_score": _score(values.get(funding)),
            "maximum_score": None,
            "average_score": None,
            "admitted_count": None,
            "snapshot_date": None,
            "source_url": source_url,
            "source_locator": {"field": f"additional.oldPoints.{year}.{funding}"},
            "finality_note": "Official direction-card passing score; unavailable is not zero or BVI. Enrollment counts are independently sourced from orders.",
        }
        for funding in ("budget", "paid")
    ]


def _jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows = [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if not all(isinstance(row, dict) for row in rows):
        raise ValueError(f"Non-object JSONL row: {path.name}")
    return rows


def _append(path: Path, rows: list[dict[str, Any]]) -> None:
    original = path.read_bytes() if path.exists() else b""
    prefix = b"\n" if original and not original.endswith(b"\n") else b""
    path.write_bytes(
        original
        + prefix
        + b"".join(
            (json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n").encode()
            for row in rows
        )
    )


def build_official_card_scores(
    input_bundle: Path, capture_path: Path, output_bundle: Path, *, year: int
) -> dict[str, Any]:
    """Create an auditable directory bundle after full source/identity validation."""
    source = input_bundle.resolve(strict=True)
    destination = output_bundle.resolve()
    if destination.exists():
        raise FileExistsError(destination)
    if (
        source == destination
        or source in destination.parents
        or destination in source.parents
    ):
        raise ValueError("Output must be separate from immutable input bundle")
    hashes = {
        str(p.relative_to(source)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in source.rglob("*")
        if p.is_file()
    }
    programs = _jsonl(source / "data/educational_programs.jsonl")
    if not programs or len(programs) > 1000:
        raise ValueError("Program catalog is empty or exceeds bounded coverage")
    sources = _jsonl(source / "source_artifacts.jsonl")
    by_key = {row["source_key"]: row for row in sources}
    capture = json.loads(capture_path.read_text(encoding="utf-8"))
    cards = capture.get("cards")
    if not isinstance(cards, list) or not 1 <= len(cards) <= MAX_CARDS:
        raise ValueError("Capture card count outside bounds")
    by_url = {row["url"]: row for row in cards}
    if len(by_url) != len(cards) or set(by_url) != {
        p.get("source_url") for p in programs
    }:
        raise ValueError(
            "Capture must cover every catalog program's exact source URL once"
        )
    additions: list[dict[str, Any]] = []
    artifacts: list[dict[str, Any]] = []
    for url, evidence in sorted(by_url.items()):
        raw_path = Path(evidence["path"])
        if not raw_path.is_absolute() and not raw_path.exists():
            raw_path = capture_path.parent / raw_path.name
        body = raw_path.read_bytes()
        digest = hashlib.sha256(body).hexdigest()
        if digest != evidence["sha256"]:
            raise ValueError("Captured official-card SHA-256 mismatch")
        timestamp = evidence["fetchedAt"]
        if datetime.fromisoformat(timestamp).tzinfo is None:
            raise ValueError("Capture timestamp must include timezone")
        selected = [p for p in programs if p["source_url"] == url]
        code = normalize_code(selected[0]["direction_code"])
        root = _read_card(body, code, url)
        profile_codes = {
            normalize_code(p.get("code"))
            for chair in root.get("chairs", {}).get("items", [])
            for p in chair.get("educationalProgram", {}).get("items", [])
        }
        for program in selected:
            old_source = by_key.get(program.get("source_artifact_key"), {})
            if (
                old_source.get("source_type") != "bmstu_program_card_api"
                or old_source.get("requested_url") != url
            ):
                raise ValueError("Program lacks exact official card source provenance")
            if (
                normalize_code(program["direction_code"]) != code
                or normalize_code(program["code"]) not in profile_codes
                or program.get("campus_scope") not in {"head_moscow", "unverified"}
            ):
                raise ValueError(
                    "Program profile/direction/campus disagrees with captured card"
                )
        artifact_key = f"source_artifact:official-card:{hashlib.sha256(url.encode()).hexdigest()}:{digest}"
        artifacts.append(
            {
                "source_key": artifact_key,
                "source_type": "bmstu_program_card_api",
                "requested_url": url,
                "final_url": url,
                "retrieved_at": timestamp,
                "status_code": 200,
                "content_type": "application/json",
                "sha256": digest,
                "byte_size": len(body),
                "raw_path": None,
                "storage_status": "omitted_by_user_request",
            }
        )
        for row in parse_official_card_scores(
            body, direction_code=code, source_url=url, year=year
        ):
            row.update(
                direction_key=selected[0]["direction_key"],
                source_artifact_key=artifact_key,
                source_sha256=digest,
                source_retrieved_at=timestamp,
            )
            additions.append(row)
    dataset = Path("data/historical_admission_statistics.jsonl")
    existing_keys = {r["external_key"] for r in _jsonl(source / dataset)}
    if len({r["external_key"] for r in additions}) != len(additions) or any(
        r["external_key"] in existing_keys for r in additions
    ):
        raise ValueError("Official-card score keys already exist or collide")
    if any(a["source_key"] in by_key for a in artifacts):
        raise ValueError("Content-bound source artifacts already exist")
    report = {
        "year": year,
        "kind": KIND,
        "covered_programs": len(programs),
        "covered_cards": len(cards),
        "added_scores": len(additions),
        "numeric_scores": sum(r["minimum_score"] is not None for r in additions),
        "unavailable_scores": sum(r["minimum_score"] is None for r in additions),
        "input_files_sha256": hashes,
    }
    shutil.copytree(source, destination)
    _append(destination / dataset, additions)
    _append(destination / "source_artifacts.jsonl", artifacts)
    validation_path = destination / "validation_report.json"
    if validation_path.exists():
        validation = json.loads(validation_path.read_text(encoding="utf-8"))
        if isinstance(validation.get("counts"), dict):
            counts = validation["counts"]
            counts["historical_admission_statistics"] = len(existing_keys) + len(
                additions
            )
            if isinstance(counts.get("jsonl_records_total"), int):
                counts["jsonl_records_total"] += len(additions)
        if isinstance(validation.get("dataset_counts"), dict):
            counts = validation["dataset_counts"]
            key = (
                dataset.name
                if dataset.name in counts
                else str(dataset).replace("\\", "/")
            )
            counts[key] = len(existing_keys) + len(additions)
        validation_path.write_text(
            json.dumps(validation, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
            encoding="utf-8",
        )
    (destination / "official_card_score_audit.json").write_text(
        json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )
    if hashes != {
        str(p.relative_to(source)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in source.rglob("*")
        if p.is_file()
    }:
        raise RuntimeError("Immutable input changed during bundle construction")
    logger.info(
        "[FIX:official-card-scores] cards=%d programs=%d numeric=%d unavailable=%d",
        len(cards),
        len(programs),
        report["numeric_scores"],
        report["unavailable_scores"],
    )
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--capture", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--year", type=int, required=True)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    print(
        json.dumps(
            build_official_card_scores(
                args.input, args.capture, args.output, year=args.year
            ),
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
