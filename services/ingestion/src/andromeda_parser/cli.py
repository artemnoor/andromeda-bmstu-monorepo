"""Run local BMSTU parsers and the explicit fixture-first ingestion pipeline."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

PARSER_NAMES = (
    "catalog-html",
    "catalog-api",
    "program-card",
    "admission-information",
    "tuition",
)


def _official_source_url(value: str | None, parser: argparse.ArgumentParser) -> str:
    if not value:
        parser.error("--source-url is required for this parser")
    parsed = urlsplit(value)
    host = (parsed.hostname or "").casefold().rstrip(".")
    if (
        parsed.scheme != "https"
        or not (host == "bmstu.ru" or host.endswith(".bmstu.ru"))
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        parser.error("--source-url must be a clean HTTPS URL on bmstu.ru or a subdomain")
    return value


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="andromeda-bmstu")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("list", help="list parsers included in the active build")
    run = commands.add_parser("parse", help="parse one local capture without network access")
    run.add_argument("parser", choices=PARSER_NAMES)
    run.add_argument("--input", required=True, type=Path, help="local HTML or JSON capture")
    run.add_argument("--source-url", help="clean official BMSTU URL used as provenance")
    run.add_argument("--direction-code", help="required by program-card")
    run.add_argument("--output", type=Path, help="JSON output path; stdout when omitted")
    ingestion = commands.add_parser("ingest", help="capture, parse, review, and publish BMSTU data")
    ingestion_actions = ingestion.add_subparsers(dest="ingest_command", required=True)
    capture = ingestion_actions.add_parser("capture", help="capture local fixtures or opt-in live sources")
    capture.add_argument("--mode", choices=("fixture", "live"), default="fixture")
    capture.add_argument("--fixture-dir", type=Path, help="local source capture directory for fixture mode")
    capture.add_argument("--output", type=Path, help="local ignored capture directory")
    capture.add_argument("--timeout", type=float, default=30.0)
    capture.add_argument("--retries", type=int, default=2)
    capture.add_argument("--request-interval", type=float, default=1.0)
    capture.add_argument("--max-body-bytes", type=int, default=30_000_000)
    capture.add_argument("--log-level", choices=("DEBUG", "INFO", "WARNING", "ERROR"), default="DEBUG")
    parse_capture = ingestion_actions.add_parser("parse", help="parse a frozen local capture without network access")
    parse_capture.add_argument("--input", required=True, type=Path, help="capture directory with source_manifest.json")
    parse_capture.add_argument("--output", type=Path, help="sanitized parser report path")
    parse_capture.add_argument("--log-level", choices=("DEBUG", "INFO", "WARNING", "ERROR"), default="DEBUG")
    parse_admission_plan = ingestion_actions.add_parser(
        "parse-admission-plan",
        help="parse a locally supplied BMSTU 2026 Appendix 8.1 PDF without network access",
    )
    parse_admission_plan.add_argument("--input", required=True, type=Path, help="local PDF attachment")
    parse_admission_plan.add_argument("--output", required=True, type=Path, help="sanitized parser report path")
    parse_admission_plan.add_argument(
        "--captured-at",
        help="original source capture timestamp (ISO 8601); defaults to the local parse time",
    )
    parse_admission_plan.add_argument("--log-level", choices=("DEBUG", "INFO", "WARNING", "ERROR"), default="DEBUG")
    stage = ingestion_actions.add_parser("stage", help="stage parser output as a review-only bundle")
    stage.add_argument("--base", type=Path, help="explicit seed bundle used only with --bootstrap")
    stage.add_argument(
        "--bootstrap",
        action="store_true",
        help="create the first release from an explicit seed only when no active release exists",
    )
    stage.add_argument("--parse-report", required=True, type=Path)
    stage.add_argument("--output", required=True, type=Path)
    stage.add_argument("--log-level", choices=("DEBUG", "INFO", "WARNING", "ERROR"), default="DEBUG")
    diff = ingestion_actions.add_parser(
        "diff", help="classify staged facts against the exact active-release base"
    )
    diff.add_argument("--input", required=True, type=Path, help="staged candidate bundle")
    diff.add_argument("--json-output", required=True, type=Path)
    diff.add_argument("--csv-output", type=Path)
    diff.add_argument("--log-level", choices=("DEBUG", "INFO", "WARNING", "ERROR"), default="DEBUG")
    probe = ingestion_actions.add_parser(
        "probe", help="perform a bounded, read-only live check of selected official BMSTU sources"
    )
    probe.add_argument("--compare-bundle", required=True, type=Path, help="local export of the release to compare")
    probe.add_argument("--release-id", help="release identity shown in the report")
    probe.add_argument("--output", required=True, type=Path, help="new JSON report path; no source bodies are saved")
    probe.add_argument("--log-level", choices=("DEBUG", "INFO", "WARNING", "ERROR"), default="DEBUG")
    template = ingestion_actions.add_parser(
        "review-template", help="prepare a review CSV with only safe group decisions filled in"
    )
    template.add_argument("--input", required=True, type=Path, help="staged candidate bundle")
    template.add_argument("--output", required=True, type=Path)
    template.add_argument("--actor", help="reviewer identity; defaults to the current OS account")
    template.add_argument("--log-level", choices=("DEBUG", "INFO", "WARNING", "ERROR"), default="DEBUG")
    remoderate = ingestion_actions.add_parser(
        "remoderate", help="reopen selected rejected candidate payloads for a new individual decision"
    )
    remoderate.add_argument("--input", required=True, type=Path, help="reviewed bundle retaining rejected candidates")
    remoderate.add_argument("--output", required=True, type=Path)
    remoderate.add_argument("--key", action="append", dest="candidate_keys", help="exact candidate key; repeat to select multiple")
    remoderate.add_argument("--log-level", choices=("DEBUG", "INFO", "WARNING", "ERROR"), default="DEBUG")
    review = ingestion_actions.add_parser("review", help="materialize explicit candidate review decisions")
    review.add_argument("--input", required=True, type=Path, help="candidate bundle directory")
    review.add_argument("--decisions", required=True, type=Path, help="CSV with external_key, decision, reviewed_at")
    review.add_argument("--output", required=True, type=Path)
    review.add_argument("--actor", help="reviewer identity for rows without reviewed_by")
    review.add_argument("--log-level", choices=("DEBUG", "INFO", "WARNING", "ERROR"), default="DEBUG")
    for action, description in (
        ("validate", "validate an importer-mappable reviewed bundle"),
        ("dry-run", "map a reviewed bundle without opening a database"),
        ("commit", "commit a reviewed bundle through the guarded academic importer"),
    ):
        command = ingestion_actions.add_parser(action, help=description)
        command.add_argument("--input", required=True, type=Path)
        command.add_argument("--output", type=Path, help="optional JSON report path")
        command.add_argument("--log-level", choices=("DEBUG", "INFO", "WARNING", "ERROR"), default="DEBUG")
    return parser


def _run_parser(name: str, body: bytes, args: argparse.Namespace, parser: argparse.ArgumentParser) -> Any:
    if name == "catalog-html":
        from andromeda.ingestion.universities.bmstu.parser.campaign_2026.catalog.parser import (
            parse_catalog_html,
        )

        return parse_catalog_html(body)
    if name == "catalog-api":
        from andromeda.ingestion.universities.bmstu.parser.campaign_2026.catalog.parser import (
            parse_catalog_api,
        )

        return parse_catalog_api(body)

    source_url = _official_source_url(args.source_url, parser)
    if name == "program-card":
        if not args.direction_code:
            parser.error("--direction-code is required for program-card")
        from andromeda.ingestion.universities.bmstu.parser.campaign_2026.program_cards.parser import (
            parse_program_card,
        )

        return parse_program_card(body, args.direction_code, source_url)
    if name == "admission-information":
        from andromeda.ingestion.universities.bmstu.parser.campaign_2026.admission_information.parser import (
            parse_admission_information,
        )

        return parse_admission_information(body, source_url)
    if name == "tuition":
        from andromeda.ingestion.universities.bmstu.parser.campaign_2026.tuition.parser import (
            parse_cost_page,
        )

        return parse_cost_page(body, source_url)
    parser.error(f"unsupported parser: {name}")
    raise AssertionError("argparse.error must exit")


def main(argv: list[str] | None = None, *, application: Any | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    if args.command == "list":
        print("\n".join(PARSER_NAMES))
        return 0
    if args.command == "ingest":
        from andromeda_parser.bundle import run_bundle_command
        from andromeda_parser.ingest import (
            run_capture_command,
            run_parse_admission_plan_command,
            run_parse_command,
        )

        if args.ingest_command == "capture":
            return run_capture_command(args, parser)
        if args.ingest_command == "parse":
            return run_parse_command(args, parser)
        if args.ingest_command == "parse-admission-plan":
            return run_parse_admission_plan_command(args, parser)
        return run_bundle_command(args, parser, application=application)

    try:
        if args.input.is_symlink() or not args.input.is_file():
            parser.error("--input must be an existing regular local file")
        body = args.input.read_bytes()
        if len(body) > 30_000_000:
            parser.error("--input exceeds the 30 MB parser limit")
        result = _run_parser(args.parser, body, args, parser)
        serialized = json.dumps(result, ensure_ascii=False, indent=2, default=str) + "\n"
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(serialized, encoding="utf-8")
        else:
            sys.stdout.write(serialized)
        return 0
    except OSError as error:
        parser.error(f"could not read or write a parser file: {error}")
    except ValueError as error:
        parser.error(str(error))
    return 2
