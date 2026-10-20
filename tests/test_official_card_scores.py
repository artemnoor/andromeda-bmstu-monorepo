import hashlib
import json

import pytest
from andromeda_parser.official_card_scores import (
    build_official_card_scores,
    parse_official_card_scores,
)

URL = "https://api.www.bmstu.ru/majors/test"


def body(budget=259, paid=193, code="09.03.04"):
    return json.dumps(
        {
            "additional": {
                "code": code,
                "oldPoints": {"2026": {"budget": budget, "paid": paid}},
            },
            "chairs": {
                "items": [{"educationalProgram": {"items": [{"code": "09.03.04–01"}]}}]
            },
        }
    ).encode()


def fixture(tmp_path):
    source = tmp_path / "source"
    (source / "data").mkdir(parents=True)
    program = {
        "external_key": "program:1",
        "code": "09.03.04-01",
        "direction_code": "09.03.04",
        "direction_key": "direction:1",
        "source_url": URL,
        "campus_scope": "head_moscow",
        "source_artifact_key": "source:old",
    }
    (source / "data/educational_programs.jsonl").write_text(json.dumps(program) + "\n")
    (source / "source_artifacts.jsonl").write_text(
        json.dumps(
            {
                "source_key": "source:old",
                "source_type": "bmstu_program_card_api",
                "requested_url": URL,
            }
        )
        + "\n"
    )
    (source / "data/historical_admission_statistics.jsonl").write_text("")
    raw = tmp_path / "card.json"
    raw.write_bytes(body())
    capture = tmp_path / "capture.json"
    capture.write_text(
        json.dumps(
            {
                "cards": [
                    {
                        "url": URL,
                        "path": str(raw),
                        "sha256": hashlib.sha256(raw.read_bytes()).hexdigest(),
                        "fetchedAt": "2026-10-20T00:00:00+00:00",
                    }
                ]
            }
        )
    )
    return source, capture


def test_zero_and_missing_are_distinct():
    rows = parse_official_card_scores(
        body(0, "—"), direction_code="09.03.04", source_url=URL, year=2026
    )
    assert [row["minimum_score"] for row in rows] == [0, None]
    assert all(row["admitted_count"] is None for row in rows)


@pytest.mark.parametrize("value", [True, -1, "БВИ", "wat", 1.5, 401, float("nan")])
def test_invalid_score_rejected(value):
    with pytest.raises(ValueError):
        parse_official_card_scores(
            body(value), direction_code="09.03.04", source_url=URL, year=2026
        )


def test_identity_and_year_are_exact():
    with pytest.raises(ValueError):
        parse_official_card_scores(
            body(code="01.03.02"), direction_code="09.03.04", source_url=URL, year=2026
        )
    with pytest.raises(ValueError):
        parse_official_card_scores(
            body(), direction_code="09.03.04", source_url=URL, year=2025
        )


def test_builder_deterministic_and_input_immutable(tmp_path):
    source, capture = fixture(tmp_path)
    (source / "validation_report.json").write_text(
        json.dumps(
            {"counts": {"historical_admission_statistics": 0, "jsonl_records_total": 1}}
        )
    )
    before = {
        str(p.relative_to(source)): p.read_bytes()
        for p in source.rglob("*")
        if p.is_file()
    }
    reports = [
        build_official_card_scores(source, capture, tmp_path / name, year=2026)
        for name in ("a", "b")
    ]
    assert reports[0] == reports[1]
    assert reports[0]["covered_programs"] == 1
    counts = json.loads((tmp_path / "a/validation_report.json").read_text())["counts"]
    assert counts == {"historical_admission_statistics": 2, "jsonl_records_total": 3}
    assert (tmp_path / "a/data/educational_programs.jsonl").read_bytes() == (
        source / "data/educational_programs.jsonl"
    ).read_bytes()
    assert before == {
        str(p.relative_to(source)): p.read_bytes()
        for p in source.rglob("*")
        if p.is_file()
    }
    assert (tmp_path / "a/data/historical_admission_statistics.jsonl").read_bytes() == (
        tmp_path / "b/data/historical_admission_statistics.jsonl"
    ).read_bytes()
    with pytest.raises(FileExistsError):
        build_official_card_scores(source, capture, tmp_path / "a", year=2026)


@pytest.mark.parametrize("failure", ["hash", "coverage", "profile", "type"])
def test_builder_rejects_bad_evidence_before_output(tmp_path, failure):
    source, capture = fixture(tmp_path)
    data = json.loads(capture.read_text())
    if failure == "hash":
        data["cards"][0]["sha256"] = "0" * 64
    elif failure == "coverage":
        data["cards"] = []
    elif failure == "profile":
        p = source / "data/educational_programs.jsonl"
        p.write_text(p.read_text().replace("09.03.04-01", "09.03.04-99"))
    else:
        p = source / "source_artifacts.jsonl"
        p.write_text(p.read_text().replace("bmstu_program_card_api", "other"))
    capture.write_text(json.dumps(data))
    with pytest.raises(ValueError):
        build_official_card_scores(source, capture, tmp_path / "result", year=2026)
    assert not (tmp_path / "result").exists()


def test_missing_field_stays_unknown_and_year_never_falls_back():
    card = json.loads(body())
    del card["additional"]["oldPoints"]["2026"]["paid"]
    rows = parse_official_card_scores(
        json.dumps(card).encode(), direction_code="09.03.04", source_url=URL, year=2026
    )
    assert rows[1]["minimum_score"] is None
    card["additional"]["oldPoints"] = {"2025": {"budget": 300, "paid": 250}}
    with pytest.raises(ValueError, match="requested admission year"):
        parse_official_card_scores(
            json.dumps(card).encode(),
            direction_code="09.03.04",
            source_url=URL,
            year=2026,
        )


@pytest.mark.parametrize(
    "campus", ["head_moscow", "unverified", "out_of_scope", "kaluga"]
)
def test_direction_card_scope_does_not_invent_program_campus(tmp_path, campus):
    source, capture = fixture(tmp_path)
    program_path = source / "data/educational_programs.jsonl"
    program = json.loads(program_path.read_text())
    program["campus_scope"] = campus
    program_path.write_text(json.dumps(program) + "\n")
    output = tmp_path / "result"
    if campus not in {"head_moscow", "unverified"}:
        with pytest.raises(ValueError, match="campus"):
            build_official_card_scores(source, capture, output, year=2026)
        assert not output.exists()
        return
    build_official_card_scores(source, capture, output, year=2026)
    rows = [
        json.loads(line)
        for line in (output / "data/historical_admission_statistics.jsonl")
        .read_text()
        .splitlines()
    ]
    assert all(row["campus_scope"] == "official_direction_card" for row in rows)
    assert all(row["scope_type"] == "direction" for row in rows)
    assert (
        program_path.read_bytes()
        == (output / "data/educational_programs.jsonl").read_bytes()
    )
