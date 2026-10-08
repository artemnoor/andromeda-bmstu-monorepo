"""Pydantic boundary types for the domain-owned discipline area taxonomy."""

from __future__ import annotations

from decimal import Decimal

from andromeda_ontology.ontology.discipline import (
    AreaVector,
    DisciplineAreaCode,
    area_position,
    area_vector,
)
from andromeda_ontology.ontology.discipline import (
    area_catalog as _area_catalog,
)
from andromeda_ontology.ontology.discipline import (
    area_definition as _area_definition,
)
from pydantic import Field

from ....shared.contracts.base import ContractModel
from ....shared.contracts.ids import ShortText


class DisciplineAreaDefinition(ContractModel):
    code: DisciplineAreaCode
    name: ShortText
    description: ShortText
    position: int = Field(strict=True, ge=1, le=22)


class DisciplineAreaWeight(ContractModel):
    area: DisciplineAreaCode
    weight: Decimal = Field(
        strict=True,
        gt=Decimal(0),
        le=Decimal(1),
        max_digits=5,
        decimal_places=4,
    )


class DisciplineAreaSummary(ContractModel):
    area: DisciplineAreaCode
    share: Decimal = Field(
        strict=True,
        ge=Decimal(0),
        le=Decimal(1),
        max_digits=5,
        decimal_places=4,
    )


def area_catalog() -> tuple[DisciplineAreaDefinition, ...]:
    return tuple(
        DisciplineAreaDefinition(
            code=definition.code,
            name=definition.name,
            description=definition.description,
            position=definition.position,
        )
        for definition in _area_catalog()
    )


def area_definition(code: DisciplineAreaCode) -> DisciplineAreaDefinition:
    definition = _area_definition(code)
    return DisciplineAreaDefinition(
        code=definition.code,
        name=definition.name,
        description=definition.description,
        position=definition.position,
    )


def default_area_weights() -> tuple[DisciplineAreaWeight, ...]:
    return (
        DisciplineAreaWeight(
            area=DisciplineAreaCode.UNIVERSAL_INTERDISCIPLINARY,
            weight=Decimal("1.0000"),
        ),
    )


__all__ = [
    "AreaVector",
    "DisciplineAreaCode",
    "DisciplineAreaDefinition",
    "DisciplineAreaSummary",
    "DisciplineAreaWeight",
    "area_catalog",
    "area_definition",
    "area_position",
    "area_vector",
    "default_area_weights",
]
