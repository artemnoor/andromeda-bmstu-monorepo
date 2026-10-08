from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Self

from andromeda.shared.contracts.base import ContractModel
from andromeda.shared.contracts.ids import (
    DepartmentId,
    EventId,
    NonEmptyText,
    ProgramId,
    UniversityId,
    VenueId,
)
from andromeda.shared.contracts.provenance import SourceAttribution
from andromeda_ontology.ontology.events import validate_event, validate_venue
from pydantic import Field, HttpUrl, model_validator

from ...domain_validation import validate_domain


class EventKind(StrEnum):
    ADDITIONAL_EDUCATION = "additional_education"
    OPEN_DAY = "open_day"
    LECTURE = "lecture"
    COMPETITION = "competition"
    CAREER = "career"
    OTHER = "other"


class EventFormat(StrEnum):
    OFFLINE = "offline"
    ONLINE = "online"
    HYBRID = "hybrid"


class Venue(ContractModel):
    id: VenueId
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

    @model_validator(mode="after")
    def validate_coordinates(self) -> Self:
        validate_domain(
            "Venue",
            validate_venue,
            self.latitude,
            self.longitude,
            entity_id=self.id,
        )
        return self


class Event(ContractModel):
    id: EventId
    title: NonEmptyText
    kind: EventKind
    format: EventFormat
    starts_at: datetime
    ends_at: datetime | None = None
    description: str | None = Field(default=None, min_length=1, max_length=10_000)
    registration_url: HttpUrl | None = None
    university_ids: tuple[UniversityId, ...] = Field(min_length=1)
    department_ids: tuple[DepartmentId, ...] = ()
    program_ids: tuple[ProgramId, ...] = ()
    venue: Venue | None = None
    provenance: tuple[SourceAttribution, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_semantics(self) -> Self:
        validate_domain(
            "Event",
            validate_event,
            starts_at=self.starts_at,
            ends_at=self.ends_at,
            university_ids=self.university_ids,
            department_ids=self.department_ids,
            program_ids=self.program_ids,
            venue_id=self.venue.id if self.venue is not None else None,
            entity_id=self.id,
        )
        return self


__all__ = ["Event", "EventFormat", "EventKind", "Venue"]
