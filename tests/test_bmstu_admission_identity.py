from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from andromeda.ingestion.universities.bmstu.parser.campaign_2026.admissions.authority import (
    build_authoritative_intake_records,
)
from andromeda.ingestion.universities.bmstu.parser.campaign_2026.admissions.parser import (
    _direction_code_by_table_row,
)


def _build(
    title: str,
    profiles: list[tuple[str, str, str]],
    *,
    codes: list[str] | None = None,
    departments: list[str] | None = None,
) -> tuple[list[dict[str, Any]], ...]:
    codes = codes or ["09.03.04"]
    departments = departments or ["ИУ7"]
    locator = {"page": 2, "table": 1, "row": 9}
    return build_authoritative_intake_records(
        [{
            "external_key": "offering:test:shared",
            "direction_codes_in_document": codes,
            "department_code_in_document": departments[0],
            "department_rows_in_document": [{"department_code_in_document": code} for code in departments],
            "program_name_in_document": title,
            "budget_places_at_department": 100,
            "special_quota_places_at_offering": 10,
            "separate_quota_places_at_offering": 10,
            "source_locator": locator,
            "source_locators": [locator],
        }],
        [],
        directions=[{"code": code, "external_key": f"direction:{code}"} for code in codes + ["/".join(codes)]],
        departments=[{"code": code, "external_key": f"department:{code}"} for code in departments],
        programs=[{
            "external_key": f"program:{index}",
            "direction_code": direction,
            "department_code": department,
            "name": name,
            "campus_scope": "head_moscow",
        } for index, (direction, department, name) in enumerate(profiles)],
        campaign_key="campaign:bmstu:2026",
        source_url="local://test/appendix.pdf",
        source_artifact_key="source:test",
        source_retrieved_at="2026-10-19T00:00:00Z",
        source_sha256="a" * 64,
    )


def test_composite_pdf_code_does_not_inherit_previous_direction() -> None:
    table = SimpleNamespace(
        bbox=(0, 0, 100, 40),
        rows=[SimpleNamespace(cells=[None, (10, 0, 30, 40), None, (30, 0, 50, 40)])],
    )
    page = SimpleNamespace(
        edges=[],
        extract_words=lambda **_: [{"text": "40.05.03/40.05.01", "x0": 10, "x1": 30, "top": 10, "bottom": 20}],
    )
    by_row, carried = _direction_code_by_table_row(page, table, "38.03.05")
    assert by_row == {1: "40.05.03 / 40.05.01"}
    assert carried == "40.05.03 / 40.05.01"


def test_composite_catalog_identity_links_to_its_full_source_code_set() -> None:
    offers, *_ = _build(
        "Цифровая безопасность",
        [("40.05.03/40.05.01", "ЮР", "Цифровая безопасность")],
        codes=["40.05.03", "40.05.01"],
        departments=["ЮР"],
    )
    assert offers[0]["educational_program_key"] == "program:0"
    assert offers[0]["direction_code"] == "40.05.03/40.05.01"


def test_slash_list_links_all_exact_profiles_without_duplicating_seats() -> None:
    names = ["Разработка программно-информационных систем", "Программное обеспечение систем искусственного интеллекта", "Разработка высокоинтерактивных систем и компьютерных игр"]
    offers, pools, _, manual, relations = _build("/".join(names), [("09.03.04", "ИУ7", name) for name in names])
    links = [row for row in relations if row["relation_type"] == "offering_includes_catalog_program"]
    assert {row["target_key"] for row in links} == {"program:0", "program:1", "program:2"}
    assert all(row["source_key"] == offers[0]["external_key"] for row in links)
    assert all(row["evidence_kind"] == "explicit_appendix_8_1_profile_group" for row in links)
    assert all(row["source_locator"] == offers[0]["source_locator"] for row in links)
    assert offers[0]["educational_program_key"] is None
    assert offers[0]["catalog_join_status"] == "exact_explicit_profile_group"
    assert len([pool for pool in pools if pool["quota_type"] == "general_competition"]) == 1
    assert sum(pool["places"] for pool in pools if pool["quota_type"] == "general_competition") == 100
    assert not any(row["issue_type"] == "offering_to_catalog_profile_unresolved" for row in manual)


def test_explicit_department_rows_link_same_title_profiles_as_one_group() -> None:
    departments = ["ИБМ2", "ИБМ3", "ИБМ4", "ИБМ5", "ИБМ7"]
    title = "Управление промышленными инновациями"
    offers, pools, _, _, relations = _build(title, [("27.03.05", department, title) for department in departments], codes=["27.03.05"], departments=departments)
    assert offers[0]["educational_program_key"] is None
    assert len([row for row in relations if row["relation_type"] == "offering_includes_catalog_program"]) == 5
    assert sum(pool["places"] for pool in pools if pool["quota_type"] == "general_competition") == 100


def test_title_mismatch_does_not_link_by_department_alone() -> None:
    offers, _, _, _, relations = _build("Новое название", [("09.03.04", "ИУ7", "Другое название")])
    assert offers[0]["educational_program_key"] is None
    assert not any(row["relation_type"] == "offering_includes_catalog_program" for row in relations)


def test_partial_slash_group_does_not_become_a_single_profile_offer() -> None:
    offers, _, _, _, relations = _build("Первый профиль/Второй профиль", [("09.03.04", "ИУ7", "Первый профиль")])
    assert offers[0]["educational_program_key"] is None
    assert not any(row["relation_type"] == "offering_includes_catalog_program" for row in relations)


def test_duplicate_catalog_identity_does_not_verify_a_shared_group() -> None:
    title = "Управление промышленными инновациями"
    profiles = [("27.03.05", "ИБМ2", title), ("27.03.05", "ИБМ2", title), ("27.03.05", "ИБМ3", title)]
    offers, _, _, _, relations = _build(title, profiles, codes=["27.03.05"], departments=["ИБМ2", "ИБМ3"])
    assert offers[0]["educational_program_key"] is None
    assert not any(row["relation_type"] == "offering_includes_catalog_program" for row in relations)


def test_duplicate_identity_cannot_hide_behind_other_title_department_matches() -> None:
    profiles = [
        ("09.03.04", "ИУ7", "Первый"),
        ("09.03.04", "ИУ7", "Первый"),
        ("09.03.04", "ИУ8", "Первый"),
        ("09.03.04", "ИУ7", "Второй"),
    ]
    offers, _, _, _, relations = _build("Первый/Второй", profiles, departments=["ИУ7", "ИУ8"])
    assert offers[0]["educational_program_key"] is None
    assert offers[0]["catalog_join_status"] == "unresolved"
    assert not any(row["relation_type"] == "offering_includes_catalog_program" for row in relations)


def test_reviewed_literal_mt7_typo_links_only_with_exact_code_and_department() -> None:
    source = "Специализированые робототехнические комплексы для сварки и неразрушающего контроля"
    catalog = "Специализированные робототехнические комплексы для сварки и неразрушающего контроля"
    offers, *_ = _build(source, [("15.05.02", "МТ7", catalog)], codes=["15.05.02"], departments=["МТ7"])
    assert offers[0]["educational_program_key"] == "program:0"
    assert offers[0]["program_name_in_document"] == source
    other, *_ = _build(source, [("15.05.02", "МТ8", catalog)], codes=["15.05.02"], departments=["МТ8"])
    assert other[0]["educational_program_key"] is None
