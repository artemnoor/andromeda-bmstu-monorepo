"""Map-agnostic campus read projections.

The point identity is deliberately the existing ``VenueId``.  These models
describe the data a future map consumer may read; they do not describe a map
scene, visual placement, or a route graph.
"""

from __future__ import annotations

from decimal import Decimal
from enum import StrEnum
from typing import Self

from andromeda.modules.programs.contracts.public import Program
from andromeda.modules.universities.contracts.public import University
from andromeda.shared.contracts.base import ContractModel
from andromeda.shared.contracts.ids import (
    DepartmentId,
    DirectionId,
    EducationYear,
    NonEmptyText,
    ProgramCode,
    ProgramId,
    ShortText,
    UniversityId,
    VenueId,
)
from andromeda.shared.contracts.provenance import SourceAttribution
from andromeda_ontology.ontology.campus import (
    validate_campus_point,
    validate_campus_point_detail,
)
from pydantic import Field, HttpUrl, model_validator

from ...domain_validation import validate_domain


class CampusPointType(StrEnum):
    """Stable semantic categories understood by external campus consumers."""

    BUILDING = "building"
    ROOM_ZONE = "room_zone"
    EVENT_VENUE = "event_venue"
    ENTRANCE = "entrance"
    OTHER = "other"


class CampusUniversityReference(ContractModel):
    """Card-safe projection of the existing university contract."""

    id: UniversityId
    name: NonEmptyText
    city: ShortText
    address: NonEmptyText
    official_site: HttpUrl

    @classmethod
    def from_contract(cls, university: University) -> CampusUniversityReference:
        return cls.model_validate(university.model_dump(mode="python"))


class CampusProgramReference(ContractModel):
    """Card-safe projection of the existing program contract."""

    id: ProgramId
    direction_id: DirectionId
    code: ProgramCode
    name: NonEmptyText
    education_year: EducationYear
    study_plan_url: HttpUrl
    source_url: HttpUrl

    @classmethod
    def from_contract(cls, program: Program) -> CampusProgramReference:
        return cls.model_validate(program.model_dump(mode="python"))


class CampusDepartmentReference(ContractModel):
    """Canonical department reference; department is not duplicated here."""

    id: DepartmentId


class CampusPoint(ContractModel):
    """A physical university point projected from the existing venue storage."""

    id: VenueId
    point_type: CampusPointType
    name: NonEmptyText
    address: NonEmptyText | None = None
    latitude: Decimal | None = Field(
        default=None,
        strict=True,
        ge=Decimal(-90),
        le=Decimal(90),
        max_digits=9,
        decimal_places=6,
    )
    longitude: Decimal | None = Field(
        default=None,
        strict=True,
        ge=Decimal(-180),
        le=Decimal(180),
        max_digits=9,
        decimal_places=6,
    )
    university_ids: tuple[UniversityId, ...] = Field(min_length=1)
    department_ids: tuple[DepartmentId, ...] = ()
    program_ids: tuple[ProgramId, ...] = ()
    event_count: int = Field(default=0, strict=True, ge=0)
    provenance: tuple[SourceAttribution, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_semantics(self) -> Self:
        validate_domain(
            "CampusPoint",
            validate_campus_point,
            self.id,
            self.latitude,
            self.longitude,
            self.university_ids,
            self.department_ids,
            self.program_ids,
            entity_id=self.id,
        )
        return self


class CampusPointDetail(CampusPoint):
    """Point data plus existing catalog references needed for a selection card."""

    universities: tuple[CampusUniversityReference, ...] = ()
    departments: tuple[CampusDepartmentReference, ...] = ()
    programs: tuple[CampusProgramReference, ...] = ()

    @model_validator(mode="after")
    def validate_references(self) -> Self:
        validate_domain(
            "CampusPointDetail",
            validate_campus_point_detail,
            self.university_ids,
            self.department_ids,
            self.program_ids,
            tuple(item.id for item in self.universities),
            tuple(item.id for item in self.departments),
            tuple(item.id for item in self.programs),
            entity_id=self.id,
        )
        return self


__all__ = [
    "CampusDepartmentReference",
    "CampusPoint",
    "CampusPointDetail",
    "CampusPointType",
    "CampusProgramReference",
    "CampusUniversityReference",
]
