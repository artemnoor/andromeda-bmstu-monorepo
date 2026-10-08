from __future__ import annotations

from typing import Self

from andromeda_ontology.ontology.university import validate_direction_identity
from pydantic import HttpUrl, model_validator

from ....shared.contracts.base import ContractModel
from ....shared.contracts.enums import EducationLevel
from ....shared.contracts.ids import (
    DirectionCode,
    DirectionId,
    NonEmptyText,
    ShortText,
    UniversityId,
)
from ...domain_validation import validate_domain


class University(ContractModel):
    id: UniversityId
    name: NonEmptyText
    city: ShortText
    official_site: HttpUrl
    address: NonEmptyText


class Direction(ContractModel):
    id: DirectionId
    university_id: UniversityId
    code: DirectionCode
    name: NonEmptyText
    education_level: EducationLevel

    @model_validator(mode="after")
    def validate_identity(self) -> Self:
        validate_domain(
            "Direction", validate_direction_identity, self.id, self.university_id, self.code
        )
        return self


__all__ = ["Direction", "University"]
