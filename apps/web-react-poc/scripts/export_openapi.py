"""Export the FastAPI application's OpenAPI document deterministically.

Run from the repository root with the API workspace environment, for example:

    uv run --package andromeda-api python apps/web-react-poc/scripts/export_openapi.py
    uv run --package andromeda-api python apps/web-react-poc/scripts/export_openapi.py --check

The document is generated from the app object and does not connect to PostgreSQL.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_OUTPUT = REPOSITORY_ROOT / "apps" / "web-react-poc" / "openapi.json"


def canonical_openapi_bytes() -> bytes:
    # Import lazily so --help and path validation do not import the API stack.
    from andromeda_api.main import create_app

    document = create_app().openapi()
    return (json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode(
        "utf-8"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="OpenAPI output path (default: apps/web-react-poc/openapi.json)",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail if the checked-in artifact differs from the current FastAPI schema",
    )
    args = parser.parse_args(argv)
    output_path = args.output if args.output.is_absolute() else Path.cwd() / args.output

    try:
        generated = canonical_openapi_bytes()
    except ImportError as error:
        parser.error(
            "could not import the FastAPI application; run with the andromeda-api workspace "
            f"environment (original error: {error})"
        )

    if args.check:
        try:
            checked_in = output_path.read_bytes()
        except FileNotFoundError:
            print(f"OpenAPI artifact is missing: {output_path}", file=sys.stderr)
            return 1
        if checked_in != generated:
            print(
                "OpenAPI artifact is stale. Regenerate it with "
                "`uv run --package andromeda-api python "
                "apps/web-react-poc/scripts/export_openapi.py`.",
                file=sys.stderr,
            )
            return 1
        print(f"OpenAPI artifact is current: {output_path}")
        return 0

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(generated)
    print(f"Wrote {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
