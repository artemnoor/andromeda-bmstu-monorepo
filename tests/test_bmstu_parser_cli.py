from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from andromeda_parser.cli import PARSER_NAMES, main

PROJECT_ROOT = Path(__file__).resolve().parents[1]
HTML_FIXTURE = PROJECT_ROOT / "tests" / "fixtures" / "bmstu" / "admission-information.html"


def test_parser_list_is_bmstu_only(capsys) -> None:
    assert main(["list"]) == 0
    output = capsys.readouterr().out
    assert "hse" not in output.casefold()
    assert tuple(output.splitlines()) == PARSER_NAMES


def test_ingestion_modules_and_local_parser_run_without_api_runtime() -> None:
    isolated_script = r"""
import importlib
import importlib.abc
import json
import pkgutil
import sys

class RuntimeBlocker(importlib.abc.MetaPathFinder):
    blocked = ("andromeda_api", "andromeda_db", "fastapi", "sqlalchemy")

    def find_spec(self, fullname, path=None, target=None):
        if any(fullname == name or fullname.startswith(name + ".") for name in self.blocked):
            raise ModuleNotFoundError("blocked optional runtime: " + fullname)
        return None

sys.meta_path.insert(0, RuntimeBlocker())
import andromeda
import andromeda.ingestion
import andromeda_parser
from andromeda_release_bundles import BundleReader, validate_bundle

for package in (andromeda.ingestion, andromeda_parser):
    for module in pkgutil.walk_packages(package.__path__, package.__name__ + "."):
        importlib.import_module(module.name)

from andromeda_parser.cli import main
assert main(["list"]) == 0
assert main([
    "parse", "admission-information", "--input", sys.argv[1],
    "--source-url", "https://course.bmstu.ru/edu/abiturient/",
]) == 0
"""
    completed = subprocess.run(
        [sys.executable, "-c", isolated_script, str(HTML_FIXTURE)],
        cwd=PROJECT_ROOT,
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )

    assert completed.returncode == 0, completed.stderr
    assert "admission-information" in completed.stdout
    assert '"historical_results"' in completed.stdout


def test_admission_information_parser_runs_on_local_fixture(tmp_path: Path) -> None:
    output = tmp_path / "parsed.json"
    result = main(
        [
            "parse",
            "admission-information",
            "--input",
            str(HTML_FIXTURE),
            "--source-url",
            "https://course.bmstu.ru/edu/abiturient/",
            "--output",
            str(output),
        ]
    )

    assert result == 0
    parsed = json.loads(output.read_text(encoding="utf-8"))
    assert len(parsed["historical_results"]) == 1
    assert parsed["historical_results"][0]["direction_code"] == "01.03.02"
    assert parsed["historical_results"][0]["admitted_count"] == 12


def test_parser_rejects_non_bmstu_source_url(capsys) -> None:
    try:
        main(
            [
                "parse",
                "admission-information",
                "--input",
                str(HTML_FIXTURE),
                "--source-url",
                "https://example.com/private?token=secret",
            ]
        )
    except SystemExit as error:
        assert error.code == 2
    else:
        raise AssertionError("non-BMSTU source URL was accepted")
    assert "clean HTTPS URL" in capsys.readouterr().err
