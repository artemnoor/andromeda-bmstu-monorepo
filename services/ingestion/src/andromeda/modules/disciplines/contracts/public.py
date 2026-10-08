"""Public discipline contracts; source name remains on curriculum items."""

from ..domain.areas import (
    DisciplineAreaCode,
    DisciplineAreaDefinition,
    DisciplineAreaSummary,
    DisciplineAreaWeight,
    area_catalog,
    area_definition,
    area_position,
)
from ..domain.entities import Discipline
from .classification import TAXONOMY_VERSION, ClassificationOutcome

__all__ = [
    "TAXONOMY_VERSION",
    "ClassificationOutcome",
    "Discipline",
    "DisciplineAreaCode",
    "DisciplineAreaDefinition",
    "DisciplineAreaSummary",
    "DisciplineAreaWeight",
    "area_catalog",
    "area_definition",
    "area_position",
]
