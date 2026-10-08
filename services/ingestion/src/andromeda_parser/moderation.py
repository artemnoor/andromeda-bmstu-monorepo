"""Exact-key candidate diffs and conservative review preparation."""

from __future__ import annotations

import csv
import hashlib
import json
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from andromeda_api.application.importer.bundle import BundleReader

from .bundle import (
    CANDIDATE_FILE,
    CANDIDATE_MANIFEST,
    OBSERVATION_DATASET,
    SOURCE_ARTIFACTS,
    _copy_import_bundle,
    _prepare_output,
    _read_json,
    _read_jsonl,
    _write_json,
    _write_jsonl,
    _validate_bundle,
)
from .ingest import IngestionError


PROVENANCE_FIELDS = frozenset(
    {
        "source_artifact_key",
        "source_artifact_keys",
        "source_sha256",
        "source_url",
        "source_retrieved_at",
    }
)
SAFE_BULK_FIELDS: dict[str, frozenset[str]] = {
    # These fields describe where/how a fact was observed; none changes academic meaning.
    "*": frozenset({"source_url", "source_retrieved_at", "source_locator"}),
    # A finality annotation is source metadata. Counts, scores, fees, dates,
    # places, requirements, program links, and curriculum values stay individual.
    "historical_admission_statistics.jsonl": frozenset({"finality_note"}),
    # Exact identity metadata is derived from an exact plan and exact source row;
    # a verified source artifact is still required for safe grouped review.
    "curriculum_items.jsonl": frozenset({"source_row"}),
}


def _rows_from_reader(reader: BundleReader, relative_path: str) -> list[dict[str, Any]]:
    if not reader.has_file(relative_path):
        return []
    try:
        text = reader.read_bytes(relative_path).decode("utf-8-sig")
        rows = [json.loads(line) for line in text.splitlines() if line.strip()]
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise IngestionError(f"invalid JSONL in bundle: {relative_path}") from error
    if not all(isinstance(row, dict) for row in rows):
        raise IngestionError(f"JSONL rows must be objects: {relative_path}")
    return rows


def _payload(candidate: dict[str, Any]) -> dict[str, Any]:
    encoded = candidate.get("payload_json")
    digest = candidate.get("payload_sha256")
    if not isinstance(encoded, str) or not isinstance(digest, str):
        raise IngestionError("candidate payload or digest is missing")
    if hashlib.sha256(encoded.encode("utf-8")).hexdigest() != digest:
        raise IngestionError("candidate payload digest does not match its contents")
    try:
        value = json.loads(encoded)
    except json.JSONDecodeError as error:
        raise IngestionError("candidate payload is not valid JSON") from error
    if not isinstance(value, dict):
        raise IngestionError("candidate payload must be an object")
    return value


def _semantic_fields(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in payload.items()
        if key != "external_key" and key not in PROVENANCE_FIELDS and value is not None
    }


def _source_artifact_index(rows: list[dict[str, Any]]) -> dict[str, str]:
    result: dict[str, str] = {}
    for row in rows:
        key, digest = row.get("source_key"), row.get("sha256")
        if isinstance(key, str) and isinstance(digest, str):
            result[key] = digest
    return result


def _conflicting_candidate_keys(candidates: list[dict[str, Any]]) -> set[str]:
    grouped: dict[tuple[str, str], list[tuple[str, dict[str, Any]]]] = defaultdict(list)
    for candidate in candidates:
        if candidate.get("candidate_type") != "typed_record":
            continue
        dataset = candidate.get("target_dataset")
        target_key = candidate.get("suggested_target")
        candidate_key = candidate.get("external_key")
        if not all(isinstance(value, str) and value for value in (dataset, target_key, candidate_key)):
            continue
        try:
            fields = _semantic_fields(_payload(candidate))
        except IngestionError:
            continue
        grouped[(dataset, target_key)].append((candidate_key, fields))

    conflicts: set[str] = set()
    for entries in grouped.values():
        if len(entries) < 2:
            continue
        values_by_field: dict[str, set[str]] = defaultdict(set)
        for _candidate_key, fields in entries:
            for field, value in fields.items():
                values_by_field[field].add(json.dumps(value, ensure_ascii=False, sort_keys=True))
        contested = {field for field, values in values_by_field.items() if len(values) > 1}
        if contested:
            conflicts.update(candidate_key for candidate_key, _ in entries)
    return conflicts


def compare_candidate_bundle(candidate_dir: Path) -> dict[str, Any]:
    """Compare staged parser candidates against the exact release copied into the bundle."""

    candidate_root = candidate_dir.expanduser().resolve(strict=True)
    candidate_manifest = _read_json(candidate_root / CANDIDATE_MANIFEST)
    if candidate_manifest.get("schema_version") != 1:
        raise IngestionError("unsupported candidate manifest version")
    candidate_rows = _read_jsonl(candidate_root / CANDIDATE_FILE)
    with BundleReader(candidate_root) as reader:
        current_rows_by_dataset: dict[str, dict[str, dict[str, Any]]] = {}
        for item in reader.files:
            if not item.relative_path.startswith("data/") or not item.relative_path.endswith(".jsonl"):
                continue
            name = item.relative_path.removeprefix("data/")
            rows = _rows_from_reader(reader, item.relative_path)
            by_key: dict[str, dict[str, Any]] = {}
            for row in rows:
                external_key = row.get("external_key")
                if isinstance(external_key, str) and external_key:
                    if external_key in by_key:
                        raise IngestionError(
                            f"base bundle has duplicate exact external key in {name}"
                        )
                    by_key[external_key] = row
            current_rows_by_dataset[name] = by_key
        artifact_rows = _rows_from_reader(reader, "source_artifacts.jsonl")

    artifact_hashes = _source_artifact_index(artifact_rows)
    conflicts = _conflicting_candidate_keys(candidate_rows)
    results: list[dict[str, Any]] = []
    for candidate in candidate_rows:
        candidate_key = candidate.get("external_key")
        if not isinstance(candidate_key, str):
            raise IngestionError("candidate has no external key")
        if candidate.get("candidate_type") == "canonical_snapshot":
            existing = current_rows_by_dataset.get(
                Path(OBSERVATION_DATASET).name, {}
            ).get(candidate_key)
            if existing is None:
                classification = "unreviewed"
                provenance_verified = False
                reason = "canonical observation requires explicit individual review"
            else:
                candidate_artifacts = sorted(
                    key for key in candidate.get("source_artifact_keys", []) if isinstance(key, str)
                )
                existing_artifacts = sorted(
                    key for key in existing.get("source_artifact_keys", []) if isinstance(key, str)
                )
                if existing.get("source_artifact_key") and existing["source_artifact_key"] not in existing_artifacts:
                    existing_artifacts.append(existing["source_artifact_key"])
                    existing_artifacts.sort()
                same_snapshot = (
                    existing.get("source_capture_digest") == candidate.get("source_capture_digest")
                    and existing.get("payload_sha256") == candidate.get("payload_sha256")
                    and existing_artifacts == candidate_artifacts
                )
                provenance_verified = bool(candidate_artifacts) and all(
                    key in artifact_hashes for key in candidate_artifacts
                )
                classification = "unchanged" if same_snapshot and provenance_verified else "conflicting"
                reason = (
                    "identical accepted source snapshot and exact artifacts are already in this release"
                    if classification == "unchanged"
                    else "an observation with this capture identity exists but its payload or provenance differs"
                )
            results.append(
                {
                    "candidate_key": candidate_key,
                    "candidate_type": "canonical_snapshot",
                    "classification": classification,
                    "moderation_state": "accepted" if classification == "unchanged" else candidate.get("review_state", "pending"),
                    "target_dataset": None,
                    "target_external_key": None,
                    "changed_fields": [],
                    "bulk_eligible": False,
                    "provenance_verified": provenance_verified,
                    "reason": reason,
                }
            )
            continue

        dataset = candidate.get("target_dataset")
        target_key = candidate.get("suggested_target")
        if (
            not isinstance(dataset, str)
            or Path(dataset).name != dataset
            or not dataset.endswith(".jsonl")
            or not isinstance(target_key, str)
            or not target_key
            or target_key.strip() != target_key
        ):
            results.append(
                {
                    "candidate_key": candidate_key,
                    "candidate_type": "typed_record",
                    "classification": "conflicting",
                    "moderation_state": candidate.get("review_state", "pending"),
                    "target_dataset": dataset,
                    "target_external_key": target_key,
                    "changed_fields": [],
                    "bulk_eligible": False,
                    "provenance_verified": False,
                    "reason": "target dataset or exact key is malformed",
                }
            )
            continue

        try:
            proposed = _payload(candidate)
        except IngestionError as error:
            results.append(
                {
                    "candidate_key": candidate_key,
                    "candidate_type": "typed_record",
                    "classification": "conflicting",
                    "moderation_state": candidate.get("review_state", "pending"),
                    "target_dataset": dataset,
                    "target_external_key": target_key,
                    "changed_fields": [],
                    "bulk_eligible": False,
                    "provenance_verified": False,
                    "reason": str(error),
                }
            )
            continue

        if candidate_key in conflicts:
            classification = "conflicting"
            current = current_rows_by_dataset.get(dataset, {}).get(target_key)
            changed_fields = sorted(
                field
                for field, value in _semantic_fields(proposed).items()
                if current is None or current.get(field) != value
            )
            reason = "multiple source candidates propose different values for this exact target key"
        elif proposed.get("external_key") != target_key:
            classification = "conflicting"
            changed_fields = []
            reason = "payload external key differs from the candidate target key"
        elif candidate.get("identity_status") == "ambiguous":
            classification = "ambiguous"
            current = None
            changed_fields = sorted(_semantic_fields(proposed))
            reason = candidate.get("identity_reason") or "curriculum row identity requires an individual exact-key review"
        else:
            current = current_rows_by_dataset.get(dataset, {}).get(target_key)
            if current is None:
                classification = "new"
                changed_fields = sorted(_semantic_fields(proposed))
                reason = "exact target key is absent from the base release"
            else:
                changed_fields = sorted(
                    field
                    for field, value in _semantic_fields(proposed).items()
                    if current.get(field) != value
                )
                classification = "changed" if changed_fields else "unchanged"
                reason = (
                    "candidate changes one or more values at the exact target key"
                    if changed_fields
                    else "source-backed academic values already match the base release"
                )

        source_key = candidate.get("source_artifact_key")
        source_hash = proposed.get("source_sha256")
        has_provenance = (
            isinstance(source_key, str)
            and isinstance(source_hash, str)
            and artifact_hashes.get(source_key) == source_hash
        )
        allowed = set(SAFE_BULK_FIELDS.get("*", ())) | set(SAFE_BULK_FIELDS.get(dataset, ()))
        has_candidate_ref = "$candidate_ref" in json.dumps(proposed, ensure_ascii=False)
        eligible = (
            classification == "changed"
            and has_provenance
            and bool(changed_fields)
            and set(changed_fields) <= allowed
            and not has_candidate_ref
        )
        results.append(
            {
                "candidate_key": candidate_key,
                "candidate_type": "typed_record",
                "classification": classification,
                "moderation_state": candidate.get("review_state", "pending"),
                "target_dataset": dataset,
                "target_external_key": target_key,
                "source_identity": candidate.get("source_identity"),
                "identity_status": candidate.get("identity_status"),
                "suggested_existing_keys": candidate.get("suggested_existing_keys", []),
                "source_artifact_key": source_key,
                "source_sha256": source_hash,
                "payload_sha256": candidate.get("payload_sha256"),
                "changed_fields": changed_fields,
                "bulk_eligible": eligible,
                "provenance_verified": has_provenance,
                "reason": reason
                if eligible or classification != "changed"
                else "changed facts require individual review (critical field, unresolved reference, or provenance gap)",
            }
        )

    counts: dict[str, int] = defaultdict(int)
    for row in results:
        counts[str(row["classification"])] += 1
    complete_datasets = candidate_manifest.get("complete_datasets", [])
    if not isinstance(complete_datasets, list) or not all(
        isinstance(item, str) and Path(item).name == item and item.endswith(".jsonl")
        for item in complete_datasets
    ):
        raise IngestionError("candidate manifest complete_datasets must be a list of dataset filenames")
    complete_scopes = candidate_manifest.get("complete_scopes", [])
    if not isinstance(complete_scopes, list) or not all(
        isinstance(scope, dict)
        and scope.get("dataset") == "curriculum_items.jsonl"
        and scope.get("field") == "curriculum_key"
        and isinstance(scope.get("value"), str)
        and bool(scope.get("value"))
        for scope in complete_scopes
    ):
        raise IngestionError("candidate manifest complete_scopes contains an invalid curriculum scope")
    candidate_targets = {
        (row.get("target_dataset"), row.get("target_external_key"))
        for row in results
        if row.get("target_dataset") is not None
    }
    protected_by_ambiguous: set[tuple[str, str]] = {
        ("curriculum_items.jsonl", key)
        for row in results
        if row.get("classification") == "ambiguous"
        for key in row.get("suggested_existing_keys", [])
        if isinstance(key, str)
    }
    with BundleReader(candidate_root) as reader:
        for dataset in complete_datasets:
            for external_key, _row in current_rows_by_dataset.get(dataset, {}).items():
                if (dataset, external_key) not in candidate_targets:
                    results.append(
                        {
                            "candidate_key": None,
                            "candidate_type": "current_record",
                            "classification": "potentially_removed",
                            "moderation_state": "needs_individual_review",
                            "target_dataset": dataset,
                            "target_external_key": external_key,
                            "changed_fields": [],
                            "bulk_eligible": False,
                            "reason": "declared complete source scope omits this exact key; no deletion is automatic",
                        }
                    )
                    counts["potentially_removed"] += 1
        for scope in complete_scopes:
            for external_key, row in current_rows_by_dataset.get("curriculum_items.jsonl", {}).items():
                if row.get("curriculum_key") != scope["value"]:
                    continue
                target = ("curriculum_items.jsonl", external_key)
                if target in candidate_targets or target in protected_by_ambiguous:
                    continue
                results.append(
                    {
                        "candidate_key": None,
                        "candidate_type": "current_record",
                        "classification": "potentially_removed",
                        "moderation_state": "needs_individual_review",
                        "target_dataset": "curriculum_items.jsonl",
                        "target_external_key": external_key,
                        "changed_fields": [],
                        "bulk_eligible": False,
                        "reason": "complete exact study-plan PDF scope omits this key; no deletion is automatic",
                    }
                )
                counts["potentially_removed"] += 1

    context = {}
    context_path = candidate_root / "release_context.json"
    if context_path.is_file():
        context = _read_json(context_path)
    return {
        "schema_version": 1,
        "base_release_id": context.get("base_release_id"),
        "base_source_bundle_sha256": context.get("base_source_bundle_sha256"),
        "candidate_manifest_digest": candidate_manifest.get("capture_digest"),
        "coverage": "omissions are checked only for explicitly declared complete_datasets or exact complete_scopes; all others are unobserved_partial",
        "counts": dict(sorted(counts.items())),
        "bulk_eligible_count": sum(row.get("bulk_eligible") is True for row in results),
        "records": sorted(
            results,
            key=lambda row: (
                str(row.get("classification")),
                str(row.get("target_dataset")),
                str(row.get("target_external_key")),
                str(row.get("candidate_key")),
            ),
        ),
    }


def write_diff_report(report: dict[str, Any], *, json_path: Path, csv_path: Path | None = None) -> None:
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(
        json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )
    if csv_path is None:
        return
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    fields = (
        "classification",
        "moderation_state",
        "candidate_key",
        "target_dataset",
        "target_external_key",
        "changed_fields",
        "bulk_eligible",
        "reason",
        "source_artifact_key",
        "source_sha256",
        "source_identity",
        "candidate_type",
        "identity_status",
        "suggested_existing_keys",
        "payload_sha256",
        "provenance_verified",
    )
    with csv_path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for row in report["records"]:
            flattened = {**row, "changed_fields": ";".join(row.get("changed_fields", []))}
            for field, value in flattened.items():
                if isinstance(value, (dict, list)):
                    flattened[field] = json.dumps(value, ensure_ascii=False, sort_keys=True)
            writer.writerow({field: flattened.get(field) for field in fields})


def write_review_template(
    candidate_dir: Path,
    output_path: Path,
    *,
    actor: str,
    reviewed_at: datetime | None = None,
) -> dict[str, int]:
    """Skip unchanged verified facts and prefill only safe changed fields."""

    root = candidate_dir.expanduser().resolve(strict=True)
    report = compare_candidate_bundle(root)
    candidates = _read_jsonl(root / CANDIDATE_FILE)
    by_key = {str(row["external_key"]): row for row in candidates}
    now = (reviewed_at or datetime.now(UTC)).astimezone(UTC).isoformat()
    selected_actor = actor.strip()
    if not selected_actor or len(selected_actor) > 256:
        raise IngestionError("review actor must contain 1 to 256 characters")
    decisions_by_key: dict[str, str] = {}
    unchanged_skipped: set[str] = set()
    for item in report["records"]:
        key = item.get("candidate_key")
        if not isinstance(key, str) or key not in by_key:
            continue
        if by_key[key].get("prior_rejection_event_ids"):
            continue
        if item["classification"] == "unchanged" and item.get("provenance_verified"):
            unchanged_skipped.add(key)
        elif item.get("bulk_eligible") is True:
            decisions_by_key[key] = "accept_typed_fact"

    if output_path.is_symlink() or output_path.exists():
        raise IngestionError("review template output must be a new regular file")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fields = ("external_key", "decision", "reviewed_at", "target_external_key", "reviewed_by")
    with output_path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for candidate in candidates:
            key = str(candidate["external_key"])
            if key in unchanged_skipped:
                continue
            decision = decisions_by_key.get(key, "")
            target = candidate.get("suggested_target") if decision == "accept_typed_fact" else ""
            if candidate.get("candidate_type") == "canonical_snapshot" and decision:
                decision = "accept_observation"
            writer.writerow(
                {
                    "external_key": key,
                    "decision": decision,
                    "reviewed_at": now if decision else "",
                    "target_external_key": target or "",
                    "reviewed_by": selected_actor if decision else "",
                }
            )
    return {
        "candidates": len(candidates) - len(unchanged_skipped),
        "prefilled_safe": len(decisions_by_key),
        "individual_review_required": len(candidates) - len(unchanged_skipped) - len(decisions_by_key),
        "unchanged_skipped": len(unchanged_skipped),
    }


def prepare_rejected_candidates(
    reviewed_bundle: Path,
    output_dir: Path,
    *,
    candidate_keys: set[str] | None = None,
) -> dict[str, Any]:
    """Restore rejected source payloads as pending candidates for an explicit second review."""

    source = reviewed_bundle.expanduser().resolve(strict=True)
    target = _prepare_output(output_dir)
    validate_bundle = _validate_bundle()
    source_validation = validate_bundle(source)
    if not source_validation.get("valid"):
        raise IngestionError("reviewed bundle is invalid; rejected candidates were not restored")
    with BundleReader(source) as reader:
        rejected = _rows_from_reader(reader, "data/bmstu_rejected_candidates.jsonl")
    if not rejected:
        raise IngestionError("reviewed bundle has no rejected candidates to re-review")
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rejected:
        key = row.get("candidate_reference")
        if isinstance(key, str) and key:
            grouped[key].append(row)
    if candidate_keys is not None:
        unknown = candidate_keys - set(grouped)
        if unknown:
            raise IngestionError(f"requested rejected candidate key was not found: {sorted(unknown)[0]}")
        selected = candidate_keys
    else:
        selected = set(grouped)
    restored: list[dict[str, Any]] = []
    for key in sorted(selected):
        history = sorted(
            grouped[key],
            key=lambda row: (str(row.get("reviewed_at", "")), str(row.get("rejection_event_id", ""))),
        )
        latest = dict(history[-1])
        rejection_events = [str(row["rejection_event_id"]) for row in history if row.get("rejection_event_id")]
        latest.pop("candidate_reference", None)
        latest.pop("rejection_event_id", None)
        latest.pop("reviewed_at", None)
        latest.pop("reviewed_by", None)
        latest["external_key"] = key
        latest["review_state"] = "pending"
        latest["prior_rejection_event_ids"] = rejection_events
        _payload(latest)
        restored.append(latest)
    if not restored:
        raise IngestionError("no rejected candidates matched the re-review request")

    _copy_import_bundle(source, target)
    _write_jsonl(target / CANDIDATE_FILE, restored)
    with BundleReader(source) as reader:
        source_digest = reader.input_digest
    context_path = target / "release_context.json"
    context = _read_json(context_path) if context_path.is_file() else {}
    capture_digests = sorted(
        {str(row.get("source_capture_digest")) for row in restored if row.get("source_capture_digest")}
    )
    manifest = {
        "schema_version": 1,
        "base_digest": source_digest,
        "base_release_id": context.get("base_release_id"),
        "base_source_bundle_sha256": context.get("base_source_bundle_sha256"),
        "capture_digest": capture_digests[0] if len(capture_digests) == 1 else None,
        "source_gaps": [],
        "complete_datasets": [],
        "coverage": "partial",
        "candidate_keys": [row["external_key"] for row in restored],
        "typed_candidate_count": sum(row.get("candidate_type") == "typed_record" for row in restored),
        "added_source_artifact_keys": [],
        "re_moderation": True,
        "prior_rejection_event_ids": sorted(
            {event for row in restored for event in row.get("prior_rejection_event_ids", [])}
        ),
    }
    _write_json(target / CANDIDATE_MANIFEST, manifest)

    artifact_rows = _read_jsonl(target / SOURCE_ARTIFACTS)
    artifacts = {row.get("source_key"): row for row in artifact_rows}
    review_path = target / "manual_review.csv"
    with review_path.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        fields = list(reader.fieldnames or ("record_key", "issue_type", "source_url", "details"))
        reviews = list(reader)
    existing_review_keys = {row.get("record_key") for row in reviews}
    for row in restored:
        if row["external_key"] in existing_review_keys:
            continue
        payload = _payload(row)
        artifact = artifacts.get(row.get("source_artifact_key"), {})
        reviews.append(
            {
                "record_key": row["external_key"],
                "issue_type": "bmstu_rejected_candidate_reopened",
                "source_url": artifact.get("requested_url", payload.get("source_url", "")),
                "details": "Previously rejected exact source payload reopened for explicit individual review.",
            }
        )
    with review_path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(reviews)

    template_path = target / "review_decisions.csv"
    with template_path.open("w", encoding="utf-8", newline="") as stream:
        fields = ("external_key", "decision", "reviewed_at", "target_external_key", "reviewed_by")
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for row in restored:
            writer.writerow(
                {
                    "external_key": row["external_key"],
                    "decision": "",
                    "reviewed_at": "",
                    "target_external_key": "",
                    "reviewed_by": "",
                }
            )
    validation = validate_bundle(target)
    if not validation.get("valid"):
        raise IngestionError("re-moderation candidate bundle failed validation")
    return {
        "output_dir": str(target),
        "reopened_candidates": len(restored),
        "candidate_keys": [row["external_key"] for row in restored],
        "input_digest": source_digest,
    }
