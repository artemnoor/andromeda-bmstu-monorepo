"""Recheck missing plans and build an unpublished correction from exact PDF identities.

Run against an export of the active release. This command never writes to the
database and never accepts a direction-level PDF as a profile-specific plan.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import logging
import re
import shutil
import zipfile
from collections import Counter
from contextlib import closing
from hashlib import sha256
from html import unescape
from pathlib import Path

from andromeda.ingestion.universities.bmstu.capture import BmstuSource
from andromeda.ingestion.universities.bmstu.parser.campaign_2026.curricula.parser import (
    parse_curriculum_document,
)

from andromeda_parser.repair_admission_bundle import (
    _guard_paths,
    _jsonl,
    _read_rows,
    _tree_hashes,
)

logger = logging.getLogger(__name__)
READY = {
    "parsed_and_profile_identity_verified",
    "parsed_via_user_confirmed_catalog_link",
}


def _placeholder(body):
    if not body.startswith(b"PK\x03\x04"):
        return None
    try:
        with zipfile.ZipFile(io.BytesIO(body)) as archive:
            entry = archive.getinfo("word/document.xml")
            if entry.file_size > 1_000_000:
                return None
            text = unescape(
                re.sub(r"<[^>]+>", " ", archive.read(entry).decode("utf-8"))
            )
            text = " ".join(text.split())
            if text.casefold() == "учебный план появится позже":
                return text
    except (KeyError, ValueError, zipfile.BadZipFile, UnicodeDecodeError):
        pass
    return None


def _code(value):
    return (
        str(value or "")
        .replace("/", "-")
        .replace("–", "-")
        .replace("—", "-")
        .replace(" ", "")
    )


def repair_bundle(source: Path, destination: Path, *, capture=None):
    source, destination = _guard_paths(source.absolute(), destination.absolute())
    before = _tree_hashes(source)
    programs = {
        row["external_key"]: row
        for row in _read_rows(source, "data/educational_programs.jsonl")
    }
    plans = _read_rows(source, "data/study_plans.jsonl")
    items = _read_rows(source, "data/curriculum_items.jsonl")
    relations = _read_rows(source, "data/relationships.jsonl")
    artifacts = _read_rows(source, "source_artifacts.jsonl")
    artifacts_by_key = {row["source_key"]: row for row in artifacts}
    ready_keys = {row["external_key"] for row in plans if row.get("status") in READY}
    counts = Counter(row.get("curriculum_key") for row in items)
    targets = [
        row
        for row in plans
        if row["external_key"] not in ready_keys or not counts[row["external_key"]]
    ]
    cache = {}
    report = []
    updated = {}
    review_rows = []
    with closing(BmstuSource()) as source_client:
        fetch = capture or source_client._fetch_public_documents
        for plan in targets:
            program = programs[plan["program_key"]]
            url = program.get("study_plan_url") or plan.get("study_plan_url")
            if not url:
                report.append(
                    {
                        "program_key": program["external_key"],
                        "status": "catalog_link_missing",
                    }
                )
                continue
            if url not in cache:
                cache[url] = fetch(url)
            documents = [
                row
                for row in cache[url]
                if row.source_kind == "bmstu_curriculum_document"
            ]
            provenance = {}
            for snapshot in cache[url]:
                key = (
                    "source_artifact:study-plan-sha256:"
                    + sha256(
                        (url + "\0" + snapshot.content_sha256).encode()
                    ).hexdigest()
                )
                artifacts_by_key[key] = {
                    "source_key": key,
                    "source_type": "bmstu_profile_specific_study_plan_file"
                    if snapshot.source_kind == "bmstu_curriculum_document"
                    else "bmstu_curriculum_metadata",
                    "requested_url": url,
                    "final_url": str(snapshot.final_url),
                    "retrieved_at": snapshot.captured_at.isoformat(),
                    "sha256": snapshot.content_sha256,
                    "byte_size": len(snapshot.body),
                    "content_type": snapshot.content_type,
                    "status_code": snapshot.status_code,
                    "raw_path": None,
                    "storage_status": "omitted_by_user_request",
                }
                provenance = {
                    "source_artifact_key": key,
                    "source_url": url,
                    "source_sha256": snapshot.content_sha256,
                    "source_retrieved_at": snapshot.captured_at.isoformat(),
                }
            matches = []
            parsed_documents = []
            for snapshot in documents:
                if not snapshot.body.startswith(b"%PDF-"):
                    continue
                parsed = parse_curriculum_document(
                    snapshot.body,
                    content_type=snapshot.content_type,
                    final_url=str(snapshot.final_url),
                    share_url=url,
                    profile={
                        "code": program["code"],
                        "study_plan_external_key": plan["external_key"],
                    },
                    retrieved_at=snapshot.captured_at.isoformat(),
                )
                parsed_documents.append((parsed, snapshot))
                if (
                    parsed.get("header_profile_code")
                    and _code(parsed["header_profile_code"]) == _code(program["code"])
                    and parsed.get("items")
                    and not parsed.get("error")
                    and parsed.get("identity_status") == "exact"
                ):
                    matches.append((parsed, snapshot))
            # Identical file copies in a folder are one candidate, distinct PDFs
            # are ambiguous even when their printed profile codes agree.
            matches = list(
                {
                    snapshot.content_sha256: (parsed, snapshot)
                    for parsed, snapshot in matches
                }.values()
            )
            notices = [
                notice
                for snapshot in documents
                if (notice := _placeholder(snapshot.body))
            ]
            state = (
                "recovered"
                if len(matches) == 1
                else "multiple_matching_documents"
                if matches
                else "profile_mismatch"
                if parsed_documents
                else "source_placeholder"
                if notices
                else "unsupported_document"
                if documents
                else "no_downloadable_document"
            )
            entry = {
                "program_key": program["external_key"],
                "program_code": program["code"],
                "source_url": url,
                "status": state,
                "document_profiles": sorted(
                    {
                        p.get("header_profile_code") or "unknown"
                        for p, _ in parsed_documents
                    }
                ),
                "downloaded_documents": len(documents),
            }
            logger.info(
                "[FIX:study-plans] program=%s status=%s documents=%d",
                program["code"],
                state,
                len(documents),
            )
            if state != "recovered":
                # Refresh the diagnostic as well: a downloaded mismatching PDF
                # must no longer masquerade as an absent file.
                explanation = (
                    "The catalog links to PDF profiles: "
                    + ", ".join(entry["document_profiles"])
                    + "; expected "
                    + program["code"]
                    if parsed_documents
                    else "Официальный источник: «Учебный план появится позже»."
                    if notices
                    else "The linked resource is not a supported curriculum PDF."
                    if documents
                    else "No downloadable curriculum document was returned by the current public resource."
                )
                updated[plan["external_key"]] = {
                    **plan,
                    **provenance,
                    "error": explanation,
                }
                if parsed_documents:
                    updated[plan["external_key"]]["status"] = (
                        "linked_document_profile_mismatch"
                        if state == "profile_mismatch"
                        else "linked_documents_ambiguous"
                    )
                review_rows.append(
                    {
                        "record_key": plan["external_key"],
                        "issue_type": "study_plan_" + state,
                        "source_url": url,
                        "details": explanation,
                    }
                )
            else:
                parsed, snapshot = matches[0]
                digest = snapshot.content_sha256
                key = (
                    "source_artifact:study-plan-sha256:"
                    + sha256((url + "\0" + digest).encode()).hexdigest()
                )
                provenance = {
                    "source_artifact_key": key,
                    "source_url": url,
                    "source_sha256": digest,
                    "source_retrieved_at": snapshot.captured_at.isoformat(),
                }
                artifacts_by_key[key] = {
                    "source_key": key,
                    "source_type": "bmstu_profile_specific_study_plan_file",
                    "requested_url": url,
                    "final_url": str(snapshot.final_url),
                    "retrieved_at": snapshot.captured_at.isoformat(),
                    "sha256": digest,
                    "byte_size": len(snapshot.body),
                    "content_type": "application/pdf",
                    "status_code": snapshot.status_code,
                    "raw_path": None,
                    "storage_status": "omitted_by_user_request",
                }
                new_plan = {
                    **plan,
                    **{
                        k: v
                        for k, v in parsed.items()
                        if k not in {"items", "format", "identity_status"}
                    },
                    **provenance,
                    "document_url": url,
                    "status": "parsed_and_profile_identity_verified",
                }
                new_plan.pop("items", None)
                updated[plan["external_key"]] = new_plan
                # Do not replace existing rows/identities as a side effect of a
                # repair aimed at missing plans. Such cases require reconciliation.
                if counts[plan["external_key"]]:
                    raise ValueError(
                        "Refusing to overwrite a plan that already owns curriculum rows"
                    )
                items.extend(
                    {**item, **provenance, "program_key": program["external_key"]}
                    for item in parsed["items"]
                )
                relations.append(
                    {
                        "external_key": "relationship:recovered-profile-curriculum:"
                        + plan["external_key"],
                        "relation_type": "profile_has_profile_specific_curriculum",
                        "source_key": program["external_key"],
                        "target_key": plan["external_key"],
                        "evidence_kind": "exact_profile_card_plan_link_and_header_check",
                        **provenance,
                    }
                )
                entry.update(item_count=len(parsed["items"]), source_sha256=digest)
            report.append(entry)
    with (source / "manual_review.csv").open(
        encoding="utf-8-sig", newline=""
    ) as stream:
        reviews = list(csv.DictReader(stream))
    changed_keys = set(updated)
    reviews = [
        r
        for r in reviews
        if not (
            r.get("record_key") in changed_keys
            and (r.get("issue_type", "").startswith(("profile_plan_", "study_plan_")))
        )
    ]
    reviews.extend(review_rows)
    text = io.StringIO(newline="")
    writer = csv.DictWriter(
        text,
        fieldnames=["record_key", "issue_type", "source_url", "details"],
        lineterminator="\n",
    )
    writer.writeheader()
    writer.writerows(reviews)
    if _tree_hashes(source) != before:
        raise ValueError("Input release changed during study-plan repair")
    shutil.copytree(source, destination)
    for name, rows in {
        "data/study_plans.jsonl": [
            updated.get(row["external_key"], row) for row in plans
        ],
        "data/curriculum_items.jsonl": items,
        "data/relationships.jsonl": relations,
        "source_artifacts.jsonl": list(artifacts_by_key.values()),
    }.items():
        (destination / name).write_bytes(_jsonl(rows))
    (destination / "manual_review.csv").write_text(
        text.getvalue(), encoding="utf-8", newline=""
    )
    result = {
        "schema_version": 1,
        "checked_programs": len(targets),
        "unique_sources": len(cache),
        "statuses": dict(Counter(r["status"] for r in report)),
        "programs": report,
        "input_file_sha256": before,
        "output_file_sha256": _tree_hashes(destination),
    }
    destination.with_name(destination.name + "-repair-report.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    result = repair_bundle(args.input, args.output)
    print(
        json.dumps(
            {k: result[k] for k in ("checked_programs", "unique_sources", "statuses")},
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
