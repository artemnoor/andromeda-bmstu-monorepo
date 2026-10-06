"""Review-gated bridge from canonical BMSTU output to the existing importer."""

from __future__ import annotations

import csv
from datetime import datetime
import hashlib
import json
import logging
from pathlib import Path
import re
import shutil
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from andromeda_parser.ingest import IngestionError, _assert_safe_payload


logger = logging.getLogger("andromeda.ingestion.bundle")
CANDIDATE_FILE = "data/bmstu_ingestion_candidates.jsonl"
CANDIDATE_MANIFEST = "ingestion_candidate_manifest.json"
SOURCE_ARTIFACTS = "source_artifacts.jsonl"
OBSERVATION_DATASET = "data/admission_information_source_tables.jsonl"
REVIEW_HEADERS = ("record_key", "issue_type", "source_url", "details")


def _academic_importer() -> tuple[Any, Any]:
    try:
        from academic_data_service.importer.bundle import validate_bundle
        from academic_data_service.importer.persistence import run_bundle_import
    except ImportError as error:
        raise IngestionError(
            "bundle operations require the academic-data package; run `uv sync --all-packages`"
        ) from error
    return validate_bundle, run_bundle_import


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise IngestionError(f"invalid JSON input: {path.name}") from error
    if not isinstance(value, dict):
        raise IngestionError(f"JSON root must be an object: {path.name}")
    return value


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
        records = [json.loads(line) for line in lines if line.strip()]
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise IngestionError(f"invalid JSONL input: {path.name}") from error
    if not all(isinstance(row, dict) for row in records):
        raise IngestionError(f"JSONL records must be objects: {path.name}")
    return records


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )


def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.write_text(
        "".join(
            json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
            for row in rows
        ),
        encoding="utf-8",
    )


def _safe_source_url(value: Any) -> str:
    if not isinstance(value, str):
        raise IngestionError("candidate source URL is missing")
    parsed = urlsplit(value)
    host = (parsed.hostname or "").casefold().rstrip(".")
    allowed = (
        host == "bmstu.ru"
        or host.endswith(".bmstu.ru")
        or host in {"disk.yandex.ru", "clck.ru", "clck.su", "cloud-api.yandex.net"}
        or host.endswith(".yandex.ru")
        or host.endswith(".yandex.net")
    )
    if (
        parsed.scheme != "https"
        or not allowed
        or parsed.username
        or parsed.password
        or parsed.fragment
    ):
        raise IngestionError("candidate source URL is outside the approved HTTPS source hosts")
    secret_keys = {"token", "access_token", "auth", "authorization", "password", "signature", "sig", "secret", "key", "public_key"}
    if any(part.split("=", 1)[0].casefold() in secret_keys for part in parsed.query.split("&") if part):
        raise IngestionError("candidate source URL contains a credential-like query parameter")
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))


def _prepare_output(output_dir: Path) -> Path:
    target = output_dir.expanduser()
    if target.is_symlink():
        raise IngestionError("bundle output must not be a symbolic link")
    if target.exists():
        if not target.is_dir() or any(target.iterdir()):
            raise IngestionError("bundle output must be a new or empty directory")
    else:
        target.mkdir(parents=True, exist_ok=True)
    return target.resolve(strict=True)


def _base_validation(base_bundle: Path) -> tuple[Any, dict[str, Any]]:
    validate_bundle, _ = _academic_importer()
    report = validate_bundle(base_bundle)
    if not report.get("valid"):
        raise IngestionError("base BMSTU bundle is invalid; candidate staging stopped")
    return validate_bundle, report


def build_candidate_bundle(
    *,
    base_bundle: Path,
    parse_report_path: Path,
    output_dir: Path,
) -> dict[str, Any]:
    """Copy the safe base and add one unreviewed candidate that import mapping rejects."""

    base = base_bundle.expanduser().resolve(strict=True)
    report_path = parse_report_path.expanduser().resolve(strict=True)
    validate_bundle, base_report = _base_validation(base)
    report = _read_json(report_path)
    if report.get("schema_version") != 1:
        raise IngestionError("unsupported parser report schema version")
    capture_digest = report.get("source_capture_digest")
    if not isinstance(capture_digest, str) or not re.fullmatch(r"[0-9a-f]{64}", capture_digest):
        raise IngestionError("parser report has no valid capture digest")
    normalized = report.get("normalized")
    sources = report.get("sources")
    if not isinstance(normalized, dict) or not isinstance(sources, list) or not sources:
        raise IngestionError("parser report must include normalized data and source artifacts")
    _assert_safe_payload(normalized)
    normalized_json = json.dumps(normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    if re.search(r"(?i)olymp|олимп", normalized_json):
        raise IngestionError("olympiad content is not publishable in the BMSTU bundle")
    safe_sources: list[dict[str, Any]] = []
    artifacts: list[dict[str, Any]] = []
    for source in sources:
        if not isinstance(source, dict):
            raise IngestionError("parser report source entries must be objects")
        source_kind = source.get("source_kind")
        source_hash = source.get("sha256")
        size = source.get("byte_size")
        status = source.get("status_code")
        captured_at = source.get("captured_at")
        if not isinstance(source_kind, str) or not source_kind.startswith("bmstu_"):
            raise IngestionError("only BMSTU source artifacts can be staged")
        if not isinstance(source_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", source_hash):
            raise IngestionError("source artifact has an invalid SHA-256")
        if isinstance(size, bool) or not isinstance(size, int) or size < 0:
            raise IngestionError("source artifact byte size must be a non-negative integer")
        if isinstance(status, bool) or not isinstance(status, int) or not 200 <= status < 400:
            raise IngestionError("only successful source artifacts can be staged")
        try:
            captured = datetime.fromisoformat(str(captured_at).replace("Z", "+00:00"))
        except ValueError as error:
            raise IngestionError("source artifact timestamp is invalid") from error
        if captured.tzinfo is None:
            raise IngestionError("source artifact timestamp must include a timezone")
        requested = _safe_source_url(source.get("requested_url"))
        final = _safe_source_url(source.get("final_url"))
        source_identity = hashlib.sha256(
            f"{source_kind}\0{requested}\0{source_hash}".encode("utf-8")
        ).hexdigest()
        artifact_key = f"source_artifact:bmstu_capture:{source_identity}"
        safe_source = {
            "source_kind": source_kind,
            "requested_url": requested,
            "final_url": final,
            "captured_at": captured.isoformat(),
            "status_code": status,
            "content_type": source.get("content_type"),
            "sha256": source_hash,
            "byte_size": size,
            "source_artifact_key": artifact_key,
        }
        safe_sources.append(safe_source)
        artifacts.append(
            {
                "source_key": artifact_key,
                "source_type": source_kind,
                "requested_url": requested,
                "final_url": final,
                "retrieved_at": captured.isoformat(),
                "sha256": source_hash,
                "content_type": source.get("content_type"),
                "byte_size": size,
                "status_code": status,
                "raw_path": None,
                "storage_status": "omitted_by_user_request",
                "note": "Raw source body remains in the local ignored capture workspace.",
            }
        )
    candidate_key = f"bmstu_ingestion_candidate:{capture_digest}"
    candidate = {
        "external_key": candidate_key,
        "candidate_type": "canonical_snapshot",
        "source_capture_digest": capture_digest,
        "source_artifact_key": safe_sources[0]["source_artifact_key"],
        "source_artifact_keys": [source["source_artifact_key"] for source in safe_sources],
        "source_count": len(safe_sources),
        "review_state": "pending",
        "payload_json": normalized_json,
        "payload_sha256": hashlib.sha256(normalized_json.encode("utf-8")).hexdigest(),
    }
    _assert_safe_payload(candidate)

    target = _prepare_output(output_dir)
    shutil.copytree(base, target, dirs_exist_ok=True)
    artifacts_path = target / SOURCE_ARTIFACTS
    existing_artifacts = _read_jsonl(artifacts_path)
    existing_keys = {row.get("source_key") for row in existing_artifacts}
    additions = [row for row in artifacts if row["source_key"] not in existing_keys]
    _write_jsonl(artifacts_path, [*existing_artifacts, *additions])
    candidate_path = target / CANDIDATE_FILE
    if candidate_path.exists():
        raise IngestionError("base bundle already contains an ingestion candidate dataset")
    candidate_path.parent.mkdir(parents=True, exist_ok=True)
    _write_jsonl(candidate_path, [candidate])

    review_path = target / "manual_review.csv"
    with review_path.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if reader.fieldnames is None or not set(REVIEW_HEADERS) <= set(reader.fieldnames):
            raise IngestionError("base manual-review CSV has invalid headers")
        fields = list(reader.fieldnames)
        review_rows = list(reader)
    review_rows.append(
        {
            "record_key": candidate_key,
            "issue_type": "bmstu_ingestion_candidate_pending_review",
            "source_url": safe_sources[0]["requested_url"],
            "details": "Canonical parser output requires explicit review before importer mapping.",
        }
    )
    with review_path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(review_rows)

    candidate_manifest = {
        "schema_version": 1,
        "base_digest": base_report["input"]["digest"],
        "capture_digest": capture_digest,
        "candidate_keys": [candidate_key],
        "added_source_artifact_keys": [row["source_key"] for row in additions],
    }
    _write_json(target / CANDIDATE_MANIFEST, candidate_manifest)

    exported = _read_json(target / "validation_report.json")
    validation = exported.setdefault("validation", {})
    validation["normalized_records"] = int(validation.get("normalized_records", 0)) + 1
    validation["jsonl_datasets"] = int(validation.get("jsonl_datasets", 0)) + 1
    validation["source_artifacts"] = int(validation.get("source_artifacts", 0)) + len(additions)
    validation["source_keys_unique"] = True
    exported.setdefault("notes", []).append(
        "An ingestion candidate is pending manual review; it is not importer-mappable until materialized."
    )
    _write_json(target / "validation_report.json", exported)
    with (target / "report.md").open("a", encoding="utf-8") as stream:
        stream.write(
            "\n\n## Pending BMSTU ingestion candidate\n\n"
            f"Capture digest: `{capture_digest}`; source artifacts: {len(safe_sources)}. "
            "The candidate dataset is review-only and cannot be mapped by the importer. "
            "Raw bodies were not copied into this bundle.\n"
        )

    candidate_validation = validate_bundle(target)
    if not candidate_validation.get("valid"):
        raise IngestionError("staged candidate failed bundle validation")
    logger.debug(
        "candidate bundle staged base_digest=%s capture_digest=%s candidate=%s artifacts=%d",
        base_report["input"]["digest"],
        capture_digest,
        candidate_key,
        len(additions),
    )
    return {
        "output_dir": str(target),
        "base_digest": base_report["input"]["digest"],
        "capture_digest": capture_digest,
        "candidate_key": candidate_key,
        "source_artifact_count": len(additions),
        "validation": candidate_validation,
    }


def materialize_reviewed_bundle(
    *,
    candidate_dir: Path,
    decisions_path: Path,
    output_dir: Path,
) -> dict[str, Any]:
    """Turn explicitly accepted candidates into observation rows the importer maps."""

    candidate = candidate_dir.expanduser().resolve(strict=True)
    decisions_file = decisions_path.expanduser().resolve(strict=True)
    validate_bundle, _ = _academic_importer()
    candidate_validation = validate_bundle(candidate)
    if not candidate_validation.get("valid"):
        raise IngestionError("candidate bundle is invalid; review materialization stopped")
    candidate_manifest = _read_json(candidate / CANDIDATE_MANIFEST)
    if candidate_manifest.get("schema_version") != 1:
        raise IngestionError("unsupported ingestion candidate manifest version")
    candidate_path = candidate / CANDIDATE_FILE
    if not candidate_path.is_file():
        raise IngestionError("review input contains no pending candidate dataset")
    candidates = _read_jsonl(candidate_path)
    if not candidates:
        raise IngestionError("candidate dataset is empty")

    try:
        with decisions_file.open("r", encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream)
            if reader.fieldnames is None or not {"external_key", "decision", "reviewed_at"} <= set(reader.fieldnames):
                raise IngestionError("review CSV requires external_key, decision, and reviewed_at headers")
            decisions = list(reader)
    except (OSError, UnicodeDecodeError, csv.Error) as error:
        raise IngestionError("review decisions CSV cannot be read") from error
    if len(decisions) != len({row.get("external_key") for row in decisions}):
        raise IngestionError("review decisions contain duplicate candidate keys")
    candidate_keys = {row.get("external_key") for row in candidates}
    if {row.get("external_key") for row in decisions} != candidate_keys:
        raise IngestionError("each candidate must have exactly one explicit review decision")
    decisions_by_key: dict[str, dict[str, str]] = {}
    for row in decisions:
        key = row.get("external_key") or ""
        decision = row.get("decision") or ""
        if decision not in {"accept_observation", "reject"}:
            raise IngestionError(f"unsupported review decision for {key[:80]}")
        try:
            reviewed = datetime.fromisoformat((row.get("reviewed_at") or "").replace("Z", "+00:00"))
        except ValueError as error:
            raise IngestionError("reviewed_at must be an ISO timestamp") from error
        if reviewed.tzinfo is None:
            raise IngestionError("reviewed_at must include a timezone")
        decisions_by_key[key] = {"decision": decision, "reviewed_at": reviewed.isoformat()}

    target = _prepare_output(output_dir)
    shutil.copytree(candidate, target, dirs_exist_ok=True)
    current_rows = _read_jsonl(target / CANDIDATE_FILE)
    existing_observations = _read_jsonl(target / OBSERVATION_DATASET)
    existing_keys = {row.get("external_key") for row in existing_observations}
    accepted: list[dict[str, Any]] = []
    accepted_source_keys: set[str] = set()
    for row in current_rows:
        key = str(row["external_key"])
        decision = decisions_by_key[key]
        if decision["decision"] == "reject":
            continue
        if key in existing_keys:
            raise IngestionError("candidate key already exists in the source observation dataset")
        payload_json = row.get("payload_json")
        payload_sha256 = row.get("payload_sha256")
        if not isinstance(payload_json, str) or not isinstance(payload_sha256, str):
            raise IngestionError("reviewed candidate payload is missing its serialized content hash")
        if hashlib.sha256(payload_json.encode("utf-8")).hexdigest() != payload_sha256:
            raise IngestionError("reviewed candidate payload hash does not match its contents")
        if re.search(r"(?i)olymp|олимп", payload_json):
            raise IngestionError("olympiad content is not publishable in the BMSTU bundle")
        accepted_source_keys.update(str(value) for value in row.get("source_artifact_keys", []))
        accepted.append(
            {
                "external_key": key,
                "candidate_type": row.get("candidate_type"),
                "source_capture_digest": row.get("source_capture_digest"),
                "source_artifact_key": row.get("source_artifact_key"),
                "source_artifact_keys": row.get("source_artifact_keys", []),
                "source_count": row.get("source_count"),
                "review_decision": "accept_observation",
                "reviewed_at": decision["reviewed_at"],
                "payload_json": payload_json,
                "payload_sha256": payload_sha256,
            }
        )
    _write_jsonl(target / OBSERVATION_DATASET, [*existing_observations, *accepted])
    (target / CANDIDATE_FILE).unlink()

    decisions_manifest = [
        {
            "external_key": row["external_key"],
            "decision": decisions_by_key[str(row["external_key"])]["decision"],
            "reviewed_at": decisions_by_key[str(row["external_key"])]["reviewed_at"],
        }
        for row in current_rows
    ]
    _write_jsonl(target / "review_decisions.jsonl", decisions_manifest)

    manifest_path = target / SOURCE_ARTIFACTS
    all_artifacts = _read_jsonl(manifest_path)
    added_keys = set(candidate_manifest.get("added_source_artifact_keys", []))
    retained_keys = set(existing_keys)
    retained_keys.update(accepted_source_keys)
    retained_artifacts = [
        row
        for row in all_artifacts
        if row.get("source_key") not in added_keys or row.get("source_key") in retained_keys
    ]
    _write_jsonl(manifest_path, retained_artifacts)

    review_path = target / "manual_review.csv"
    with review_path.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        fields = list(reader.fieldnames or REVIEW_HEADERS)
        review_rows = [row for row in reader if row.get("record_key") not in candidate_keys]
    with review_path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(review_rows)

    exported = _read_json(target / "validation_report.json")
    validation = exported.setdefault("validation", {})
    validation["normalized_records"] = (
        int(validation.get("normalized_records", 0)) - len(candidates) + len(accepted)
    )
    validation["jsonl_datasets"] = max(1, int(validation.get("jsonl_datasets", 1)) - 1)
    validation["source_artifacts"] = len(retained_artifacts)
    exported.setdefault("notes", []).append(
        f"Review materialization accepted {len(accepted)} candidate observation(s); rejected candidates were not imported."
    )
    _write_json(target / "validation_report.json", exported)
    with (target / "report.md").open("a", encoding="utf-8") as stream:
        stream.write(
            "\n\n## Reviewed BMSTU source observations\n\n"
            f"Accepted observation candidates: {len(accepted)}; rejected candidates: "
            f"{len(candidates) - len(accepted)}. No existing academic fact was overwritten.\n"
        )

    reviewed_validation = validate_bundle(target)
    if not reviewed_validation.get("valid"):
        raise IngestionError("reviewed bundle failed validation")
    logger.debug(
        "candidate review materialized candidates=%d accepted=%d rejected=%d digest=%s",
        len(candidates),
        len(accepted),
        len(candidates) - len(accepted),
        reviewed_validation["input"]["digest"],
    )
    return {
        "output_dir": str(target),
        "accepted": len(accepted),
        "rejected": len(candidates) - len(accepted),
        "validation": reviewed_validation,
    }


def validate_import_bundle(input_dir: Path) -> dict[str, Any]:
    validate_bundle, _ = _academic_importer()
    if (input_dir / CANDIDATE_FILE).exists():
        raise IngestionError("unreviewed candidate bundle is not importer-mappable")
    report = validate_bundle(input_dir)
    if not report.get("valid"):
        raise IngestionError("import bundle validation failed")
    return report


def dry_run_import(input_dir: Path) -> dict[str, Any]:
    validate_import_bundle(input_dir)
    _, run_bundle_import = _academic_importer()
    return run_bundle_import(str(input_dir), commit=False)


def commit_import(input_dir: Path) -> dict[str, Any]:
    validate_import_bundle(input_dir)
    _, run_bundle_import = _academic_importer()
    return run_bundle_import(str(input_dir), commit=True)


def _summary(report: dict[str, Any]) -> dict[str, Any]:
    counts = report.get("counts", {})
    return {
        "valid": report.get("valid"),
        "digest": report.get("input", {}).get("digest"),
        "normalized_records": counts.get("normalized_records"),
        "source_artifacts": counts.get("source_artifacts"),
        "errors": len(report.get("errors", [])),
        "warnings": len(report.get("warnings", [])),
    }


def run_bundle_command(args: Any, parser: Any) -> int:
    from andromeda_parser.ingest import configure_verbose_logging

    configure_verbose_logging(args.log_level)
    try:
        if args.ingest_command == "stage":
            result = build_candidate_bundle(
                base_bundle=args.base,
                parse_report_path=args.parse_report,
                output_dir=args.output,
            )
            output = {
                "output_dir": result["output_dir"],
                "base_digest": result["base_digest"],
                "capture_digest": result["capture_digest"],
                "candidate_key": result["candidate_key"],
                "source_artifact_count": result["source_artifact_count"],
                "validation": _summary(result["validation"]),
            }
        elif args.ingest_command == "review":
            result = materialize_reviewed_bundle(
                candidate_dir=args.input,
                decisions_path=args.decisions,
                output_dir=args.output,
            )
            output = {
                "output_dir": result["output_dir"],
                "accepted": result["accepted"],
                "rejected": result["rejected"],
                "validation": _summary(result["validation"]),
            }
        elif args.ingest_command == "validate":
            output = _summary(validate_import_bundle(args.input))
        elif args.ingest_command == "dry-run":
            output = dry_run_import(args.input)
        elif args.ingest_command == "commit":
            output = commit_import(args.input)
        else:
            parser.error(f"unsupported ingestion action: {args.ingest_command}")
            return 2
    except Exception as error:
        if isinstance(error, (IngestionError, ValueError, OSError)):
            parser.error(f"{args.ingest_command} failed: {type(error).__name__}: {error}")
        parser.error(f"{args.ingest_command} failed: {type(error).__name__}; see verbose logs")
        return 2

    serialized = json.dumps(output, ensure_ascii=False, indent=2, default=str) + "\n"
    if args.output is not None and args.ingest_command in {"validate", "dry-run", "commit"}:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized, encoding="utf-8")
    else:
        print(serialized, end="")
    return 0
