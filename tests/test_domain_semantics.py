from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from andromeda_ontology.ontology.admission import (
    validate_admission_offering,
    validate_exam_choice_metadata,
    validate_passing_score_status,
)
from andromeda_ontology.ontology.curriculum import (
    validate_curriculum_identity,
    validate_curriculum_item,
)
from andromeda_ontology.ontology.discipline import (
    DisciplineAreaCode,
    area_vector,
    discipline_id_for,
    normalize_classification_name,
    normalize_discipline_name,
    validate_discipline_identity,
)
from andromeda_ontology.ontology.errors import DomainValidationError
from andromeda_ontology.ontology.program import validate_program_identity
from andromeda_ontology.ontology.university import validate_direction_identity
from andromeda_ontology.policies.rules import (
    AmbiguousRuleScopeError,
    RuleScope,
    RuleVersionCandidate,
    RuleVersionNotFoundError,
    resolve_rule_pack_version,
)


def test_direction_and_program_identity_accept_current_and_legacy_keys() -> None:
    validate_direction_identity("direction:bmstu:01.03.02", "university:bmstu", "01.03.02")
    validate_direction_identity("direction:01.03.02", "university:bmstu", "01.03.02")
    validate_program_identity(
        "program:bmstu:01.03.02-01", "direction:bmstu:01.03.02", "01.03.02-01"
    )
    validate_program_identity("program:01.03.02-01", "direction:01.03.02", "01.03.02-01")

    with pytest.raises(DomainValidationError, match="program code must belong to its direction"):
        validate_program_identity(
            "program:bmstu:02.03.02-01", "direction:bmstu:01.03.02", "02.03.02-01"
        )


def test_curriculum_identity_preserves_legacy_keys_and_ambiguous_duplicates() -> None:
    validate_curriculum_item(
        "curriculum-item:program:bmstu:01:discipline:abc:1:row:2",
        "discipline:abc",
        1,
        2,
        ("exam",),
    )
    validate_curriculum_identity(
        "curriculum:bmstu:01-2026",
        "program:bmstu:01",
        2026,
        (("discipline:abc", 1, "ambiguous"), ("discipline:abc", 1, "ambiguous")),
    )
    with pytest.raises(DomainValidationError, match="duplicate discipline/semester"):
        validate_curriculum_identity(
            "curriculum:bmstu:01-2026",
            "program:bmstu:01",
            2026,
            (("discipline:abc", 1, "exact"), ("discipline:abc", 1, "ambiguous")),
        )


def test_discipline_identity_normalization_and_area_vector_are_stable() -> None:
    assert normalize_discipline_name("  Ёлка\u00a0	 в лесу ") == "ёлка в лесу"
    assert normalize_classification_name("  Ёлка — в лесу ") == "елка - в лесу"
    normalized = normalize_discipline_name("Математический анализ")
    assert discipline_id_for(normalized) == "discipline:c389ca7e6430d6a2"
    validate_discipline_identity(
        discipline_id_for(normalized),
        normalized,
        ((DisciplineAreaCode.MATHEMATICS_STATISTICS, Decimal("1.0000")),),
    )
    assert area_vector(
        (DisciplineAreaCode.MATHEMATICS_STATISTICS, "0.7"),
        (DisciplineAreaCode.COMPUTER_SCIENCE_DATA, Decimal("0.3")),
    )[-1][1] == Decimal("0.3")


def test_admission_choice_and_passing_score_invariants() -> None:
    with pytest.raises(DomainValidationError, match="requires a choice group"):
        validate_exam_choice_metadata(
            choice_group_id=None,
            choice_group_min=1,
            choice_group_max=None,
            is_choice=True,
        )
    with pytest.raises(DomainValidationError, match="must use a BVI or quota"):
        validate_passing_score_status(status="bvi", score=None, competition_type="general")
    with pytest.raises(DomainValidationError, match="budget offering cannot contain tuition"):
        validate_admission_offering(
            offering_id="admission-offering:bmstu:2026:program:01",
            funding_type="budget",
            places=10,
            tuition_present=True,
            exams=(),
        )


def _candidate(
    key: str,
    scope: RuleScope,
    *,
    valid_from: date = date(2026, 1, 1),
    valid_to: date | None = None,
) -> RuleVersionCandidate:
    return RuleVersionCandidate(
        rule_pack_version_key=key,
        version=1,
        status="published",
        scope=scope,
        checksum="a" * 64,
        valid_from=valid_from,
        valid_to=valid_to,
        body={"key": key},
    )


def test_policy_resolution_uses_wildcards_specificity_and_half_open_dates() -> None:
    request = RuleScope(
        "request",
        university_key="university:bmstu",
        campaign_year=2026,
        education_level_code="bachelor",
    )
    global_scope = RuleScope("global")
    university_scope = RuleScope("university", university_key="university:bmstu")
    resolved = resolve_rule_pack_version(
        [
            _candidate("global-v1", global_scope),
            _candidate("university-v1", university_scope),
        ],
        request,
        date(2026, 1, 1),
    )
    assert resolved.rule_pack_version_key == "university-v1"
    with pytest.raises(RuleVersionNotFoundError):
        resolve_rule_pack_version(
            [_candidate("bounded", university_scope, valid_to=date(2026, 3, 1))],
            request,
            date(2026, 3, 1),
        )


def test_policy_resolution_reports_equal_specificity_ambiguity_and_no_match() -> None:
    request = RuleScope(
        "request",
        university_key="university:bmstu",
        campaign_year=2026,
        audience_code="applicant",
    )
    scopes = [
        RuleScope("university-year", university_key="university:bmstu", campaign_year=2026),
        RuleScope("university-audience", university_key="university:bmstu", audience_code="applicant"),
    ]
    with pytest.raises(AmbiguousRuleScopeError) as error:
        resolve_rule_pack_version(
            [_candidate("first", scopes[0]), _candidate("second", scopes[1])],
            request,
            date(2026, 1, 1),
        )
    assert error.value.scope_keys == ("university-audience", "university-year")
    with pytest.raises(RuleVersionNotFoundError):
        resolve_rule_pack_version([], request, date(2026, 1, 1))
