"""Event and venue invariants."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime
from decimal import Decimal

from andromeda_ontology.ontology.campus import validate_coordinates
from andromeda_ontology.ontology.errors import DomainValidationError


def validate_venue(latitude: Decimal | None, longitude: Decimal | None) -> None:
    validate_coordinates(latitude, longitude)


def validate_event(
    *,
    starts_at: datetime,
    ends_at: datetime | None,
    university_ids: Iterable[str],
    department_ids: Iterable[str],
    program_ids: Iterable[str],
    venue_id: str | None,
) -> None:
    university_values = tuple(university_ids)
    department_values = tuple(department_ids)
    program_values = tuple(program_ids)
    if starts_at.tzinfo is None or starts_at.utcoffset() is None:
        raise DomainValidationError("event starts_at must be timezone-aware", field="starts_at")
    if ends_at is not None:
        if ends_at.tzinfo is None or ends_at.utcoffset() is None:
            raise DomainValidationError("event ends_at must be timezone-aware", field="ends_at")
        if ends_at <= starts_at:
            raise DomainValidationError("event ends_at must be after starts_at", field="ends_at")
    for field_name, values in (
        ("university_ids", university_values),
        ("department_ids", department_values),
        ("program_ids", program_values),
    ):
        if len(values) != len(set(values)):
            raise DomainValidationError(
                f"event {field_name} must contain unique canonical IDs", field=field_name
            )
    if venue_id is not None and not any(
        venue_id.startswith(f"venue:{university.removeprefix('university:')}:")
        for university in university_values
    ):
        raise DomainValidationError(
            "venue must belong to one of the event universities", field="venue"
        )


__all__ = ["validate_event", "validate_venue"]
