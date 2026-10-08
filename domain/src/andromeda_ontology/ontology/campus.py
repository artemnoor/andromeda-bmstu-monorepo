"""Campus projection invariants."""

from __future__ import annotations

from collections.abc import Iterable
from decimal import Decimal

from andromeda_ontology.ontology.errors import DomainValidationError


def validate_coordinates(latitude: Decimal | None, longitude: Decimal | None) -> None:
    if (latitude is None) != (longitude is None):
        raise DomainValidationError(
            "latitude and longitude must be provided together", field="coordinates"
        )


def validate_campus_point(
    point_id: str,
    latitude: Decimal | None,
    longitude: Decimal | None,
    university_ids: Iterable[str],
    department_ids: Iterable[str],
    program_ids: Iterable[str],
) -> None:
    validate_coordinates(latitude, longitude)
    identity_groups = (
        ("university_ids", tuple(university_ids)),
        ("department_ids", tuple(department_ids)),
        ("program_ids", tuple(program_ids)),
    )
    for field_name, values in identity_groups:
        if len(values) != len(set(values)):
            raise DomainValidationError(
                f"campus point {field_name} must contain unique canonical IDs",
                field=field_name,
            )
    university_values = identity_groups[0][1]
    if not any(
        point_id.startswith(f"venue:{university.removeprefix('university:')}:")
        for university in university_values
    ):
        raise DomainValidationError(
            "campus point id must belong to one of its university IDs", field="id"
        )


def validate_campus_point_detail(
    university_ids: Iterable[str],
    department_ids: Iterable[str],
    program_ids: Iterable[str],
    university_reference_ids: Iterable[str],
    department_reference_ids: Iterable[str],
    program_reference_ids: Iterable[str],
) -> None:
    expected = (
        ("universities", set(university_ids), set(university_reference_ids)),
        ("departments", set(department_ids), set(department_reference_ids)),
        ("programs", set(program_ids), set(program_reference_ids)),
    )
    labels = {
        "universities": "university",
        "departments": "department",
        "programs": "program",
    }
    for field_name, identity_ids, reference_ids in expected:
        if identity_ids != reference_ids:
            label = labels[field_name]
            raise DomainValidationError(
                f"point detail {label} references must match {label}_ids",
                field=field_name,
            )


__all__ = ["validate_campus_point", "validate_campus_point_detail", "validate_coordinates"]
