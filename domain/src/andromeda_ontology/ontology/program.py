"""Educational program identity invariants."""

from __future__ import annotations

from andromeda_ontology.ontology.errors import DomainValidationError


def validate_program_identity(program_id: str, direction_id: str, program_code: str) -> None:
    """Validate a current or legacy program ID and its direction prefix."""

    university_slug = (
        direction_id.removeprefix("direction:").split(":", 1)[0]
        if direction_id.count(":") == 2
        else None
    )
    expected = f"program:{university_slug}:{program_code}" if university_slug else f"program:{program_code}"
    legacy = f"program:{program_code}"
    if program_id not in {expected, legacy}:
        raise DomainValidationError(
            "program id must equal program:<university>:<code>", field="id"
        )
    direction_code = direction_id.rsplit(":", 1)[-1]
    if not program_code.startswith(direction_code + "-"):
        raise DomainValidationError("program code must belong to its direction", field="direction_id")
