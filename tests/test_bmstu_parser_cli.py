from __future__ import annotations

import json
import importlib
import pkgutil
from pathlib import Path

import academic_data_service
import andromeda.ingestion
import andromeda_parser
from andromeda_parser.cli import PARSER_NAMES, main


PROJECT_ROOT = Path(__file__).resolve().parents[1]
HTML_FIXTURE = PROJECT_ROOT / "tests" / "fixtures" / "bmstu" / "admission-information.html"


def test_parser_list_is_bmstu_only(capsys) -> None:
    assert main(["list"]) == 0
    output = capsys.readouterr().out
    assert "hse" not in output.casefold()
    assert tuple(output.splitlines()) == PARSER_NAMES


def test_all_active_python_modules_import() -> None:
    packages = (academic_data_service, andromeda.ingestion, andromeda_parser)
    for package in packages:
        for module in pkgutil.walk_packages(package.__path__, package.__name__ + "."):
            importlib.import_module(module.name)


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
