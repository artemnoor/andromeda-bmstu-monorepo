from __future__ import annotations

import pytest
from andromeda.ingestion.universities.bmstu.source_metadata import (
    BmstuOrderCompetition,
    classify_competition_heading,
)


@pytest.mark.parametrize(
    "heading",
    [
        # Public section heading, without applicant records:
        # https://priem.bmstu.ru/lists/upload/orders/first_msk_main.pdf
        (
            "1. Перечень зачисленных с 1 сентября 2026 г. на специальность 01.03.03 "
            "«Механика и математическое моделирование» на места в рамках КЦП текущего года:"
        ),
        "Перечень зачисленных на места в рамках\nКЦП текущего года:",
    ],
)
def test_current_year_control_figures_heading_is_general_competition(heading: str) -> None:
    assert classify_competition_heading(heading) == (BmstuOrderCompetition.GENERAL, None)


@pytest.mark.parametrize(
    ("qualifier", "expected"),
    [
        ("без вступительных испытаний", BmstuOrderCompetition.BVI),
        ("имеющих особые права", BmstuOrderCompetition.SPECIAL_QUOTA),
        ("в пределах особой квоты", BmstuOrderCompetition.SPECIAL_QUOTA),
        ("в пределах отдельной квоты", BmstuOrderCompetition.SEPARATE_QUOTA),
        ("в пределах целевой квоты", BmstuOrderCompetition.TARGETED),
    ],
)
def test_explicit_competition_qualifier_precedes_control_figures_heading(
    qualifier: str, expected: BmstuOrderCompetition,
) -> None:
    heading = f"Перечень зачисленных {qualifier} на места в рамках КЦП текущего года:"
    assert classify_competition_heading(heading) == (expected, None)


def test_unspecified_budget_places_do_not_prove_general_competition() -> None:
    assert classify_competition_heading("Перечень зачисленных на бюджетные места") == (
        BmstuOrderCompetition.OTHER,
        "competition_heading_unknown",
    )
