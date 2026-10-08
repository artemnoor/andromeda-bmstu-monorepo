from __future__ import annotations

from typing import Self

from pydantic import HttpUrl, model_validator

from andromeda_ontology.ontology.program import validate_program_identity
from ....shared.contracts.base import ContractModel
from ....shared.contracts.ids import DirectionId, EducationYear, NonEmptyText, ProgramCode, ProgramId
from ....shared.contracts.provenance import SourceAttribution, SourceGapReference
from ...domain_validation import validate_domain


class Program(ContractModel):
    id: ProgramId
    direction_id: DirectionId
    code: ProgramCode
    name: NonEmptyText
    education_year: EducationYear
    study_plan_url: HttpUrl
    source_url: HttpUrl
    department_code: str | None = None
    department_name: str | None = None
    provenance: tuple[SourceAttribution, ...] = ()
    source_gaps: tuple[SourceGapReference, ...] = ()

    @model_validator(mode="after")
    def validate_identity(self) -> Self:
        validate_domain(
            "Program", validate_program_identity, self.id, self.direction_id, self.code
        )
        return self


__all__ = ["Program"]
