from __future__ import annotations

from typing import Self

from andromeda_ontology.ontology.discipline import (
    DisciplineAreaCode,
    primary_area,
    validate_discipline_identity,
)
from pydantic import Field, model_validator

from ....shared.contracts.base import ContractModel
from ....shared.contracts.ids import DisciplineId, ShortText
from ...domain_validation import validate_domain
from .areas import DisciplineAreaWeight, default_area_weights


class Discipline(ContractModel):
    id: DisciplineId
    name: str = Field(min_length=1, max_length=256)
    normalized_name: ShortText
    area_weights: tuple[DisciplineAreaWeight, ...] = Field(default_factory=default_area_weights, min_length=1)

    @model_validator(mode="after")
    def validate_identity(self) -> Self:
        validate_domain(
            "Discipline",
            validate_discipline_identity,
            self.id,
            self.normalized_name,
            tuple((str(weight.area), weight.weight) for weight in self.area_weights),
            entity_id=self.id,
        )
        return self

    @property
    def primary_area(self) -> DisciplineAreaCode:
        return primary_area(tuple((value.area, value.weight) for value in self.area_weights))


__all__ = ["Discipline"]
