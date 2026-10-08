"""Curriculum identity and ambiguity invariants."""

from __future__ import annotations

from collections.abc import Iterable

from andromeda_ontology.ontology.errors import DomainValidationError


def validate_curriculum_item(
    item_id: str,
    discipline_id: str,
    semester: int | None,
    parsed_position: int | None,
    assessment_types: tuple[object, ...] | None,
) -> None:
    """Validate item identity and assessment-type collection semantics."""

    expected_suffix = f":{discipline_id}:{semester if semester is not None else 'unassigned'}"
    if not item_id.startswith("curriculum-item:program:") or not (
        item_id.endswith(expected_suffix)
        or item_id.endswith(f"{expected_suffix}:row:{parsed_position}")
    ):
        raise DomainValidationError(
            "curriculum item id must derive from its discipline and semester", field="id"
        )
    if assessment_types is not None and not assessment_types:
        raise DomainValidationError("assessment_types must be non-empty when present", field="assessment_types")
    if assessment_types is not None and len(set(assessment_types)) != len(assessment_types):
        raise DomainValidationError("assessment_types must not contain duplicates", field="assessment_types")


def validate_curriculum_identity(
    curriculum_id: str,
    program_id: str,
    education_year: int,
    item_identities: Iterable[tuple[str, int | None, str]],
) -> None:
    """Validate curriculum identity and require duplicate rows to be ambiguous."""

    program_identity = program_id.removeprefix("program:")
    expected = f"curriculum:{program_identity}-{education_year}"
    legacy = f"curriculum:{program_identity.split(':', 1)[-1]}-{education_year}"
    if curriculum_id not in {expected, legacy}:
        raise DomainValidationError(
            "curriculum id must derive from program and education year", field="id"
        )

    identities = tuple(item_identities)
    seen: set[tuple[str, int | None]] = set()
    duplicated: set[tuple[str, int | None]] = set()
    for discipline_id, semester, _identity_status in identities:
        identity = (discipline_id, semester)
        if identity in seen:
            duplicated.add(identity)
        seen.add(identity)
    if any(
        identity_status != "ambiguous"
        for discipline_id, semester, identity_status in identities
        if (discipline_id, semester) in duplicated
    ):
        raise DomainValidationError(
            "curriculum cannot contain duplicate discipline/semester items", field="items"
        )
