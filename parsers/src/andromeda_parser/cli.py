"""Run a selected BMSTU parser on a local capture; this CLI never fetches URLs."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Callable
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


def main(argv: list[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    if args.command == "list":
        print("\n".join(PARSER_NAMES))
        return 0

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
