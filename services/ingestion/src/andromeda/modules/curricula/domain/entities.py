from __future__ import annotations

from datetime import datetime
from typing import Literal, Self

from andromeda_ontology.ontology.curriculum import (
    validate_curriculum_identity,
    validate_curriculum_item,
)
from pydantic import Field, HttpUrl, model_validator

from ....shared.contracts.base import ContractModel
from ....shared.contracts.enums import AssessmentType
from ....shared.contracts.ids import (
    Credits,
    CurriculumId,
    CurriculumItemId,
    DisciplineId,
    EducationYear,
    HourCount,
    ProgramId,
    Semester,
    SourcePosition,
)
from ....shared.contracts.provenance import SourceAttribution, SourceGapReference
from ...domain_validation import validate_domain


class CurriculumItem(ContractModel):
    id: CurriculumItemId
    discipline_id: DisciplineId
    source_name: str = Field(min_length=1, max_length=256)
    semester: Semester | None = None
    hours: HourCount
    credits: Credits | None = None
    assessment_types: tuple[AssessmentType, ...] | None = None
    source_position: SourcePosition | None = None
    parsed_position: int | None = Field(default=None, strict=True, ge=1, le=100_000)
    source_page: int | None = Field(default=None, strict=True, ge=1, le=10_000)
    printed_row_no: int | None = Field(default=None, strict=True, ge=1, le=10_000)
    chair_code: str | None = Field(default=None, min_length=1, max_length=128)
    source_part: str | None = Field(default=None, min_length=1, max_length=128)
    identity_status: Literal["exact", "ambiguous"] = "exact"
    lecture_hours: HourCount | None = None
    practice_hours: HourCount | None = None
    lab_hours: HourCount | None = None
    self_study_hours: HourCount | None = None
    is_elective: bool | None = None
    course_block: str | None = Field(default=None, min_length=1, max_length=128)
    practice_type: str | None = Field(default=None, min_length=1, max_length=128)
    provenance: tuple[SourceAttribution, ...] = Field(default=(), max_length=20)

    @model_validator(mode="after")
    def validate_item(self) -> Self:
        validate_domain(
            "CurriculumItem",
            validate_curriculum_item,
            self.id,
            self.discipline_id,
            self.semester,
            self.parsed_position,
            self.assessment_types,
            entity_id=self.id,
        )
        return self


class Curriculum(ContractModel):
    id: CurriculumId
    program_id: ProgramId
    education_year: EducationYear
    source_url: HttpUrl
    captured_at: datetime
    items: tuple[CurriculumItem, ...] = Field(min_length=1)
    provenance: tuple[SourceAttribution, ...] = ()
    source_gaps: tuple[SourceGapReference, ...] = ()

    @model_validator(mode="after")
    def validate_identity(self) -> Self:
        validate_domain(
            "Curriculum",
            validate_curriculum_identity,
            self.id,
            self.program_id,
            self.education_year,
            tuple(
                (item.discipline_id, item.semester, item.identity_status)
                for item in self.items
            ),
            entity_id=self.id,
        )
        return self


__all__ = ["Curriculum", "CurriculumItem"]
