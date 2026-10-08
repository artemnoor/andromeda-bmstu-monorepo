"""University and direction identity invariants."""

from __future__ import annotations

from andromeda_ontology.ontology.errors import DomainValidationError


def validate_direction_identity(
    direction_id: str,
    university_id: str,
    direction_code: str,
) -> None:
    """Accept the current and legacy stable direction identifiers."""

    expected = f"direction:{university_id.removeprefix('university:')}:{direction_code}"
    legacy = f"direction:{direction_code}"
    if direction_id not in {expected, legacy}:
        raise DomainValidationError(
            "direction id must equal direction:<university>:<code>", field="id"
        )
