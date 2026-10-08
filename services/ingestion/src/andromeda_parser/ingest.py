"""Fixture-first BMSTU capture and normalization pipeline."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import logging
from pathlib import Path
import re
import sys
from typing import Any, Literal
from urllib.parse import urlsplit, urlunsplit

from andromeda.ingestion.universities.bmstu.capture import BmstuSource, write_fixture
from andromeda.ingestion.contracts.source import CapturedSources
from andromeda.ingestion.universities.bmstu.fetch import FetchConfig, Fetcher
from andromeda.ingestion.universities.bmstu.adapter import BmstuUniversityAdapter


logger = logging.getLogger("andromeda.ingestion.pipeline")
CaptureMode = Literal["fixture", "live"]
SECRET_QUERY_KEYS = frozenset(
    {"token", "access_token", "auth", "authorization", "password", "signature", "sig", "secret", "key", "public_key"}
)
PERSONAL_FIELD_NAMES = frozenset(
    {
        "applicantid",
        "applicantname",
        "applicantfullname",
        "firstname",
        "lastname",
        "surname",
        "birthdate",
        "dateofbirth",
        "snils",
        "passport",
        "passportnumber",
        "email",
        "phone",
    }
)


class _RedactingFilter(logging.Filter):
    _url = re.compile(r"https?://[^\s\]\[()<>\"']+")
    _secret = re.compile(
        r"(?i)(\b(?:token|access_token|authorization|password|secret|api[_-]?key)\b\s*[=:]\s*)[^\s,;&]+"
    )

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        message = self._url.sub(lambda match: _redact_url(match.group(0)), message)
        record.msg = self._secret.sub(r"\1[REDACTED]", message)
        record.args = ()
        # This upstream event fires once per model instance and overwhelms the
        # useful stage-level DEBUG log for curriculum-heavy fixtures.
        if record.name == "andromeda.contracts.validation" and "contract_boundary model=" in message:
            return False
        return True


class IngestionError(ValueError):
    """A source capture or normalized report is unsafe or invalid."""


@dataclass(frozen=True, slots=True)
class CaptureReport:
    capture_dir: Path
    mode: CaptureMode
    snapshot_count: int
    capture_digest: str
    manifest_path: Path


@dataclass(frozen=True, slots=True)
class ParseReport:
    source_capture_digest: str
    normalized: dict[str, Any]
    sources: tuple[dict[str, Any], ...]
    source_gaps: tuple[dict[str, Any], ...]


def configure_verbose_logging(level: str = "DEBUG") -> None:
    """Configure verbose logs while stripping URL queries and secret-like values."""

    selected = getattr(logging, level.upper(), None)
    if not isinstance(selected, int):
        raise IngestionError("log level must be DEBUG, INFO, WARNING, or ERROR")

    root = logging.getLogger()
    root.setLevel(selected)
    if not root.handlers:
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
        )
        root.addHandler(handler)
    for handler in root.handlers:
        if not any(isinstance(item, _RedactingFilter) for item in handler.filters):
            handler.addFilter(_RedactingFilter())


def _redact_url(value: str) -> str:
    try:
        parsed = urlsplit(value.rstrip(".,;"))
        query_pairs = [part.split("=", 1)[0].casefold() for part in parsed.query.split("&") if part]
        if any(key in SECRET_QUERY_KEYS for key in query_pairs):
            return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "[REDACTED]", ""))
        return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))
    except ValueError:
        return "[REDACTED_URL]"


def _capture_digest(snapshots: tuple[Any, ...]) -> str:
    digest = hashlib.sha256()
    for snapshot in sorted(
        snapshots,
        key=lambda item: (item.source_kind, str(item.requested_url), item.content_sha256),
    ):
        digest.update(snapshot.source_kind.encode("utf-8"))
        digest.update(b"\0")
        digest.update(str(snapshot.requested_url).encode("utf-8"))
        digest.update(b"\0")
        digest.update(snapshot.content_sha256.encode("ascii"))
        digest.update(b"\n")
    return digest.hexdigest()


def _check_capture_directory(path: Path) -> Path:
    if path.is_symlink():
        raise IngestionError("capture directory must not be a symbolic link")
    if not path.is_dir():
        raise IngestionError("capture input must be an existing directory")
    manifest = path / "source_manifest.json"
    if manifest.is_symlink() or not manifest.is_file():
        raise IngestionError("capture directory has no regular source_manifest.json")
    return path.resolve(strict=True)


def capture_sources(
    *,
    mode: CaptureMode = "fixture",
    fixture_dir: Path | None = None,
    output_dir: Path,
    timeout_seconds: float = 30.0,
    retries: int = 2,
    request_interval_seconds: float = 1.0,
    max_body_bytes: int = 30_000_000,
) -> CaptureReport:
    """Capture fixture/live sources into a local directory with hashes."""

    if mode not in {"fixture", "live"}:
        raise IngestionError("capture mode must be fixture or live")
    if mode == "fixture" and fixture_dir is None:
        raise IngestionError("fixture mode requires --fixture-dir")
    if mode == "live" and fixture_dir is not None:
        raise IngestionError("--fixture-dir cannot be combined with live mode")

    target = output_dir.expanduser()
    if target.exists():
        if target.is_symlink() or not target.is_dir() or any(target.iterdir()):
            raise IngestionError("capture output must be a new or empty regular directory")
    else:
        target.mkdir(parents=True, exist_ok=True)
    target = target.resolve(strict=True)

    logger.debug(
        "capture started mode=%s fixture=%s timeout_seconds=%s retries=%s request_interval_seconds=%s",
        mode,
        bool(fixture_dir),
        timeout_seconds,
        retries,
        request_interval_seconds,
    )
    fetcher = Fetcher(
        FetchConfig(
            timeout_seconds=timeout_seconds,
            retries=retries,
            browser_mode="never",
            request_interval_seconds=request_interval_seconds,
            max_body_bytes=max_body_bytes,
        )
    )
    source = BmstuSource(fetcher=fetcher)
    try:
        captured = source.capture(
            mode=mode,
            fixture_dir=fixture_dir,
        )
        if not captured.snapshots:
            raise IngestionError("capture returned no source snapshots")
        write_fixture(captured, target)
        digest = _capture_digest(captured.snapshots)
        metadata = {
            "schema_version": 1,
            "mode": mode,
            "capture_digest": digest,
            "snapshot_count": len(captured.snapshots),
            "source_gaps": [gap.model_dump(mode="json") for gap in captured.source_gaps],
        }
        (target / "capture_metadata.json").write_text(
            json.dumps(metadata, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
            encoding="utf-8",
        )
        logger.debug(
            "capture completed mode=%s snapshots=%d digest=%s gaps=%d",
            mode,
            len(captured.snapshots),
            digest,
            len(captured.source_gaps),
        )
        return CaptureReport(
            capture_dir=target,
            mode=mode,
            snapshot_count=len(captured.snapshots),
            capture_digest=digest,
            manifest_path=target / "source_manifest.json",
        )
    finally:
        source.close()
        fetcher.close()


def _assert_safe_payload(value: Any, path: str = "payload") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = re.sub(r"[^a-z0-9]", "", str(key).casefold())
            if normalized in PERSONAL_FIELD_NAMES:
                raise IngestionError(f"personal field is forbidden in candidate output: {path}.{key}")
            if "olymp" in normalized:
                raise IngestionError(f"olympiad fields are not publishable: {path}.{key}")
            _assert_safe_payload(child, f"{path}.{key}")
    elif isinstance(value, list | tuple):
        for index, child in enumerate(value):
            _assert_safe_payload(child, f"{path}[{index}]")


def parse_capture(capture_dir: Path) -> ParseReport:
    """Parse a frozen capture directory; this function performs no network IO."""

    capture_path = _check_capture_directory(capture_dir.expanduser())
    captured = BmstuSource._load_fixture(capture_path)
    digest = _capture_digest(captured.snapshots)
    aggregate_snapshots = captured.by_kind("bmstu_admission_information")
    if len(aggregate_snapshots) > 1:
        raise IngestionError("capture contains more than one aggregate admission-information page")
    parser_snapshots = tuple(
        snapshot for snapshot in captured.snapshots
        if snapshot.source_kind != "bmstu_admission_information"
    )
    adapter = BmstuUniversityAdapter()
    try:
        _raw, canonical = adapter.parse(
            CapturedSources(snapshots=parser_snapshots, source_gaps=captured.source_gaps)
        )
    finally:
        adapter.close()

    normalized = canonical.model_dump(
        mode="json",
        exclude={"admission_benefits", "events", "campus_points"},
    )
    if aggregate_snapshots:
        from andromeda.ingestion.universities.bmstu.parser.campaign_2026.admission_information.parser import (
            parse_admission_information,
        )

        aggregate = aggregate_snapshots[0]
        parsed_aggregate = parse_admission_information(
            aggregate.body,
            str(aggregate.requested_url),
        )
        # Only aggregate typed rows cross the parser boundary; raw tables and page text
        # stay in the local capture and never enter the candidate bundle.
        normalized["historical_results"] = parsed_aggregate["historical_results"]
    _assert_safe_payload(normalized)
    sources = tuple(
        {
            "source_kind": snapshot.source_kind,
            "requested_url": str(snapshot.requested_url),
            "final_url": str(snapshot.final_url),
            "captured_at": snapshot.captured_at.isoformat(),
            "status_code": snapshot.status_code,
            "content_type": snapshot.content_type,
            "sha256": snapshot.content_sha256,
            "byte_size": len(snapshot.body),
        }
        for snapshot in captured.snapshots
    )
    gaps = tuple(gap.model_dump(mode="json") for gap in canonical.source_gaps)
    logger.debug(
        "parse completed capture_digest=%s sources=%d programs=%d curricula=%d gaps=%d",
        digest,
        len(sources),
        len(canonical.programs),
        len(canonical.curricula),
        len(gaps),
    )
    return ParseReport(
        source_capture_digest=digest,
        normalized=normalized,
        sources=sources,
        source_gaps=gaps,
    )


def write_parse_report(report: ParseReport, output_path: Path) -> Path:
    """Write deterministic sanitized normalized JSON outside the source tree."""

    target = output_path.expanduser()
    if target.is_symlink():
        raise IngestionError("parse output must not be a symbolic link")
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": 1,
        "source_capture_digest": report.source_capture_digest,
        "sources": list(report.sources),
        "source_gaps": list(report.source_gaps),
        "normalized": report.normalized,
    }
    _assert_safe_payload(payload)
    target.write_text(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )
    logger.debug(
        "parse report written path=%s capture_digest=%s",
        target.name,
        report.source_capture_digest,
    )
    return target.resolve(strict=True)


def run_capture_command(args: Any, parser: Any) -> int:
    configure_verbose_logging(args.log_level)
    target = args.output
    if target is None:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        target = Path("artifacts") / "bmstu-ingestion" / "captures" / f"{stamp}-{args.mode}"
    try:
        report = capture_sources(
            mode=args.mode,
            fixture_dir=args.fixture_dir,
            output_dir=target,
            timeout_seconds=args.timeout,
            retries=args.retries,
            request_interval_seconds=args.request_interval,
            max_body_bytes=args.max_body_bytes,
        )
    except (OSError, ValueError) as error:
        parser.error(f"capture failed: {type(error).__name__}: {error}")
    print(
        json.dumps(
            {
                "capture_dir": str(report.capture_dir),
                "mode": report.mode,
                "snapshot_count": report.snapshot_count,
                "capture_digest": report.capture_digest,
                "manifest": str(report.manifest_path),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


def run_parse_command(args: Any, parser: Any) -> int:
    configure_verbose_logging(args.log_level)
    try:
        report = parse_capture(args.input)
        target = args.output or (args.input / "parsed.json")
        written = write_parse_report(report, target)
    except (OSError, ValueError) as error:
        parser.error(f"parse failed: {type(error).__name__}: {error}")
    print(
        json.dumps(
            {
                "output": str(written),
                "capture_digest": report.source_capture_digest,
                "sources": len(report.sources),
                "source_gaps": len(report.source_gaps),
                "programs": len(report.normalized.get("programs", [])),
                "curricula": len(report.normalized.get("curricula", [])),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


def run_parse_admission_plan_command(args: Any, parser: Any) -> int:
    """Parse a user-provided, aggregate-only Appendix 8.1 PDF offline."""

    configure_verbose_logging(args.log_level)
    try:
        source_path = args.input.expanduser()
        if source_path.is_symlink() or not source_path.is_file():
            raise IngestionError("admission-plan input must be an existing regular local file")
        body = source_path.read_bytes()
        if len(body) > 30_000_000:
            raise IngestionError("admission-plan PDF exceeds the 30 MB parser limit")
        if not body.startswith(b"%PDF-"):
            raise IngestionError("admission-plan input is not a PDF document")
        digest = hashlib.sha256(body).hexdigest()
        if args.captured_at:
            captured_at = datetime.fromisoformat(args.captured_at.replace("Z", "+00:00"))
            if captured_at.tzinfo is None:
                raise IngestionError("--captured-at must include a timezone")
        else:
            captured_at = datetime.now(timezone.utc)
        captured_at_text = captured_at.isoformat()

        from andromeda.ingestion.universities.bmstu.parser.campaign_2026.admissions import (
            parse_intake_plan_pdf,
        )
        from andromeda.ingestion.universities.bmstu.parser.campaign_2026.admissions.authority import (
            AUTHORITATIVE_PLAN_REFERENCE,
        )

        offers, source_rows = parse_intake_plan_pdf(body, AUTHORITATIVE_PLAN_REFERENCE)
        # Keep only parsed aggregate fields and PDF locators. The absolute local
        # path and the local:// pseudo-reference are never written to the report.
        for row in [*offers, *source_rows]:
            row.pop("source_url", None)
        source_kind = "bmstu_user_provided_authoritative_admission_plan"
        capture_digest = hashlib.sha256(f"{source_kind}\0{digest}".encode("utf-8")).hexdigest()
        normalized = {
            "authoritative_admission_plan": {
                "campaign_year": 2026,
                "source_sha256": digest,
                "source_retrieved_at": captured_at_text,
                "source_offers": offers,
                "source_rows": source_rows,
            }
        }
        source = {
            "source_kind": source_kind,
            "requested_url": None,
            "final_url": None,
            "captured_at": captured_at_text,
            "status_code": 200,
            "content_type": "application/pdf",
            "sha256": digest,
            "byte_size": len(body),
            "local_attachment": True,
        }
        _assert_safe_payload({"normalized": normalized, "source": source})
        report = ParseReport(
            source_capture_digest=capture_digest,
            normalized=normalized,
            sources=(source,),
            source_gaps=(),
        )
        written = write_parse_report(report, args.output)
    except (OSError, ValueError) as error:
        parser.error(f"admission-plan parse failed: {type(error).__name__}: {error}")
    print(
        json.dumps(
            {
                "output": str(written),
                "capture_digest": report.source_capture_digest,
                "source_sha256": digest,
                "source_rows": len(source_rows),
                "moscow_offerings": len(offers),
                "network_requests": 0,
            },
            ensure_ascii=True,
            indent=2,
        )
    )
    return 0
