"""Admission fact invariants shared by source adapters and applications."""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Iterable

from andromeda_ontology.ontology.errors import DomainValidationError


def validate_inclusive_date_window(start_date: date, end_date: date) -> None:
    if start_date > end_date:
        raise DomainValidationError("date window start_date cannot follow end_date", field="start_date")


def require_aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise DomainValidationError(
            "admission cycle audit timestamps must be timezone-aware", field="timestamp"
        )
    return value.astimezone(UTC)


def admission_cycle_id(university_id: str, admission_year: int) -> str:
    slug = university_id.removeprefix("university:")
    return f"admission-cycle:{slug}:{admission_year}"


def validate_admission_cycle(
    cycle_id: str,
    university_id: str,
    admission_year: int,
    academic_year: str,
    approved_at: datetime,
    recorded_at: datetime,
    evidence_keys: Iterable[tuple[str, str, str]],
) -> None:
    year_start, year_end = (int(part) for part in academic_year.split("/"))
    if year_end != year_start + 1:
        raise DomainValidationError(
            "academic_year must contain consecutive calendar years", field="academic_year"
        )
    if cycle_id != admission_cycle_id(university_id, admission_year):
        raise DomainValidationError(
            "cycle_id must match its university and admission year", field="cycle_id"
        )
    if recorded_at < approved_at:
        raise DomainValidationError("recorded_at cannot precede approval", field="recorded_at")
    unique_keys = tuple(evidence_keys)
    if len(unique_keys) != len(set(unique_keys)):
        raise DomainValidationError(
            "admission cycle evidence references must be unique", field="evidence"
        )


def validate_exam_choice_metadata(
    *,
    choice_group_id: str | None,
    choice_group_min: int | None,
    choice_group_max: int | None,
    is_choice: bool,
) -> None:
    if choice_group_id is None and (choice_group_min is not None or choice_group_max is not None):
        raise DomainValidationError("exam choice cardinality requires a choice group", field="choice_group_id")
    if (
        choice_group_min is not None
        and choice_group_max is not None
        and choice_group_min > choice_group_max
    ):
        raise DomainValidationError(
            "exam choice group minimum cannot exceed its maximum", field="choice_group_min"
        )
    if choice_group_id is not None and not is_choice:
        raise DomainValidationError(
            "exam choice group members must be marked as choices", field="is_choice"
        )


def validate_passing_score_status(
    *, status: str, score: Decimal | None, competition_type: str
) -> None:
    if status not in {"numeric", "bvi"}:
        raise DomainValidationError("unsupported passing score status", field="status")
    if status == "numeric" and score is None:
        raise DomainValidationError("numeric passing score must contain score", field="score")
    if status == "bvi":
        if score is not None:
            raise DomainValidationError("BVI passing score must not contain score", field="score")
        if competition_type not in {
            "bvi",
            "special_quota",
            "separate_quota",
            "targeted",
        }:
            raise DomainValidationError(
                "BVI passing score must use a BVI or quota competition type",
                field="competition_type",
            )


def validate_admission_offering(
    *,
    offering_id: str,
    funding_type: str | None,
    places: int | None,
    tuition_present: bool,
    exams: Iterable[tuple[str | None, int | None, int | None]],
) -> None:
    if not offering_id.startswith("admission-offering:"):
        raise DomainValidationError(
            "admission offering id must use the admission-offering namespace", field="id"
        )
    if funding_type == "budget" and tuition_present:
        raise DomainValidationError("budget offering cannot contain tuition costs", field="tuition")
    if funding_type == "paid" and places is not None and places < 0:
        raise DomainValidationError("paid offering places cannot be negative", field="places")

    choice_groups: dict[str, list[tuple[int | None, int | None]]] = {}
    for group_id, minimum, maximum in exams:
        if group_id is not None:
            choice_groups.setdefault(group_id, []).append((minimum, maximum))
    for group_id, members in choice_groups.items():
        cardinalities = set(members)
        if len(cardinalities) != 1:
            raise DomainValidationError(
                f"choice group {group_id} has inconsistent cardinality", field="exams"
            )
        minimum, maximum = next(iter(cardinalities))
        if minimum is not None and maximum is not None and maximum > len(members):
            raise DomainValidationError(
                f"choice group {group_id} exceeds its member count", field="exams"
            )


def validate_program_admissions(program_id: str, offerings: Iterable[tuple[str, str]]) -> None:
    identities = tuple(offerings)
    if any(offering_program_id != program_id for _offering_id, offering_program_id in identities):
        raise DomainValidationError(
            "all admission offerings must belong to the envelope program", field="offerings"
        )
    ids = tuple(offering_id for offering_id, _offering_program_id in identities)
    if len(ids) != len(set(ids)):
        raise DomainValidationError("admission offerings must have unique ids", field="offerings")


__all__ = [
    "admission_cycle_id",
    "require_aware_utc",
    "validate_admission_cycle",
    "validate_admission_offering",
    "validate_exam_choice_metadata",
    "validate_inclusive_date_window",
    "validate_passing_score_status",
    "validate_program_admissions",
]
