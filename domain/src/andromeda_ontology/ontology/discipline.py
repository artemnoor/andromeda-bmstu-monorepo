"""Discipline identity and subject-area ontology semantics."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum
from hashlib import sha256
from typing import TypeAlias

from andromeda_ontology.ontology.errors import DomainValidationError


class DisciplineAreaCode(StrEnum):
    MATHEMATICS_STATISTICS = "mathematics_statistics"
    COMPUTER_SCIENCE_DATA = "computer_science_data"
    PHYSICS_ASTRONOMY = "physics_astronomy"
    CHEMISTRY_MATERIALS = "chemistry_materials"
    BIOLOGY_BIOTECHNOLOGY = "biology_biotechnology"
    EARTH_ENVIRONMENT = "earth_environment"
    ENGINEERING_TECHNOLOGY = "engineering_technology"
    ARCHITECTURE_CONSTRUCTION = "architecture_construction"
    AGRICULTURE_VETERINARY = "agriculture_veterinary"
    MEDICINE_HEALTH = "medicine_health"
    PSYCHOLOGY_COGNITIVE = "psychology_cognitive"
    SOCIETY_SOCIAL_SCIENCES = "society_social_sciences"
    ECONOMICS_FINANCE = "economics_finance"
    BUSINESS_MANAGEMENT = "business_management"
    LAW_POLICY_PUBLIC_ADMINISTRATION = "law_policy_public_administration"
    LANGUAGES_LINGUISTICS_LITERATURE = "languages_linguistics_literature"
    HISTORY_PHILOSOPHY_HUMANITIES = "history_philosophy_humanities"
    ART_DESIGN_MEDIA = "art_design_media"
    EDUCATION_PEDAGOGY = "education_pedagogy"
    SPORT_TOURISM_HOSPITALITY = "sport_tourism_hospitality"
    SAFETY_DEFENSE_TRANSPORT = "safety_defense_transport"
    UNIVERSAL_INTERDISCIPLINARY = "universal_interdisciplinary"


@dataclass(frozen=True, slots=True)
class DisciplineAreaDefinition:
    code: DisciplineAreaCode
    name: str
    description: str
    position: int


AreaVector: TypeAlias = tuple[tuple[DisciplineAreaCode, Decimal], ...]

_AREA_DEFINITIONS: tuple[DisciplineAreaDefinition, ...] = (
    DisciplineAreaDefinition(DisciplineAreaCode.MATHEMATICS_STATISTICS, "Математика и статистика", "Математический аппарат, статистика, оптимизация и исследование операций", 1),
    DisciplineAreaDefinition(DisciplineAreaCode.COMPUTER_SCIENCE_DATA, "Компьютерные науки и данные", "Программирование, данные, информационные системы, AI и кибербезопасность", 2),
    DisciplineAreaDefinition(DisciplineAreaCode.PHYSICS_ASTRONOMY, "Физика и астрономия", "Физические законы, механика, оптика, электричество и астрофизика", 3),
    DisciplineAreaDefinition(DisciplineAreaCode.CHEMISTRY_MATERIALS, "Химия и материаловедение", "Химические процессы, полимеры и материалы", 4),
    DisciplineAreaDefinition(DisciplineAreaCode.BIOLOGY_BIOTECHNOLOGY, "Биология и биотехнологии", "Живые системы, генетика, биохимия и биотехнологии", 5),
    DisciplineAreaDefinition(DisciplineAreaCode.EARTH_ENVIRONMENT, "Земля, экология и окружающая среда", "Земные системы, экология, климат и природопользование", 6),
    DisciplineAreaDefinition(DisciplineAreaCode.ENGINEERING_TECHNOLOGY, "Инженерия и технологии", "Инженерные методы, электроника, механика, робототехника и производство", 7),
    DisciplineAreaDefinition(DisciplineAreaCode.ARCHITECTURE_CONSTRUCTION, "Архитектура, строительство и урбанистика", "Архитектура, здания, конструкции, BIM и городская среда", 8),
    DisciplineAreaDefinition(DisciplineAreaCode.AGRICULTURE_VETERINARY, "Сельское хозяйство и ветеринария", "Агрономия, лесное хозяйство, животные и ветеринария", 9),
    DisciplineAreaDefinition(DisciplineAreaCode.MEDICINE_HEALTH, "Медицина и здоровье", "Медицина, фармация, диагностика и общественное здоровье", 10),
    DisciplineAreaDefinition(DisciplineAreaCode.PSYCHOLOGY_COGNITIVE, "Психология и когнитивные науки", "Психология, когнитивистика, психодиагностика и поведение", 11),
    DisciplineAreaDefinition(DisciplineAreaCode.SOCIETY_SOCIAL_SCIENCES, "Общество и социальные науки", "Социология, антропология, демография и социальные процессы", 12),
    DisciplineAreaDefinition(DisciplineAreaCode.ECONOMICS_FINANCE, "Экономика и финансы", "Экономика, эконометрика, финансы и инвестиции", 13),
    DisciplineAreaDefinition(DisciplineAreaCode.BUSINESS_MANAGEMENT, "Бизнес, управление и предпринимательство", "Менеджмент, маркетинг, бизнес-процессы и предпринимательство", 14),
    DisciplineAreaDefinition(DisciplineAreaCode.LAW_POLICY_PUBLIC_ADMINISTRATION, "Право, политика и государственное управление", "Право, политика, государственное управление и дипломатия", 15),
    DisciplineAreaDefinition(DisciplineAreaCode.LANGUAGES_LINGUISTICS_LITERATURE, "Языки, лингвистика и литература", "Языки, перевод, лингвистика, филология и литература", 16),
    DisciplineAreaDefinition(DisciplineAreaCode.HISTORY_PHILOSOPHY_HUMANITIES, "История, философия и гуманитарные науки", "История, философия, этика, культура и религиоведение", 17),
    DisciplineAreaDefinition(DisciplineAreaCode.ART_DESIGN_MEDIA, "Искусство, дизайн, медиа и коммуникации", "Искусство, дизайн, мультимедиа, журналистика и реклама", 18),
    DisciplineAreaDefinition(DisciplineAreaCode.EDUCATION_PEDAGOGY, "Образование и педагогика", "Педагогика, методики обучения и образовательные технологии", 19),
    DisciplineAreaDefinition(DisciplineAreaCode.SPORT_TOURISM_HOSPITALITY, "Спорт, туризм и индустрия гостеприимства", "Физкультура, спорт, туризм, гостиничное и ресторанное дело", 20),
    DisciplineAreaDefinition(DisciplineAreaCode.SAFETY_DEFENSE_TRANSPORT, "Безопасность, оборона и транспортные системы", "Безопасность, защита населения, оборона, транспорт и навигация", 21),
    DisciplineAreaDefinition(DisciplineAreaCode.UNIVERSAL_INTERDISCIPLINARY, "Универсальные и междисциплинарные дисциплины", "Проектная деятельность, практики, вводные и исследовательские дисциплины без одного домена", 22),
)


def normalize_discipline_name(source_name: str) -> str:
    """Apply lossless whitespace and case normalization for stable identity."""

    normalized = " ".join(
        unicodedata.normalize("NFKC", source_name.replace("\xa0", " ")).casefold().split()
    )
    if not normalized:
        raise DomainValidationError("discipline source name must be non-empty", field="source_name")
    return normalized


def normalize_classification_name(source_name: str) -> str:
    """Fold safe spelling variants for taxonomy matching only."""

    normalized = normalize_discipline_name(source_name)
    normalized = normalized.replace("ё", "е")
    normalized = re.sub(r"[‐‑‒–—―]", "-", normalized)
    return " ".join(normalized.split())


def discipline_id_for(normalized_name: str) -> str:
    return f"discipline:{sha256(normalized_name.encode('utf-8')).hexdigest()[:16]}"


def validate_discipline_identity(
    discipline_id: str,
    normalized_name: str,
    area_weights: tuple[tuple[str, Decimal], ...],
) -> None:
    """Validate the stable ID and normalized area-weight vector."""

    if discipline_id != discipline_id_for(normalized_name):
        raise DomainValidationError(
            "discipline id must derive from normalized_name", field="id"
        )
    areas = tuple(area for area, _weight in area_weights)
    if len(areas) != len(set(areas)):
        raise DomainValidationError(
            "discipline area weights must not contain duplicate areas", field="area_weights"
        )
    if sum((weight for _area, weight in area_weights), Decimal("0")) != Decimal("1"):
        raise DomainValidationError(
            "discipline area weights must sum to one", field="area_weights"
        )


def area_catalog() -> tuple[DisciplineAreaDefinition, ...]:
    return _AREA_DEFINITIONS


def area_definition(code: DisciplineAreaCode) -> DisciplineAreaDefinition:
    for definition in _AREA_DEFINITIONS:
        if definition.code is code:
            return definition
    raise KeyError(code)


def area_position(code: DisciplineAreaCode) -> int:
    return area_definition(code).position


def area_vector(*entries: tuple[DisciplineAreaCode, str | Decimal]) -> AreaVector:
    vector = tuple(
        (code, value if isinstance(value, Decimal) else Decimal(value))
        for code, value in entries
    )
    if (
        not vector
        or len({code for code, _weight in vector}) != len(vector)
        or sum((weight for _code, weight in vector), Decimal("0")) != Decimal("1")
    ):
        raise DomainValidationError(
            "discipline area vector must contain unique areas whose weights sum to one",
            field="area_weights",
        )
    return vector


def primary_area(area_weights: tuple[tuple[DisciplineAreaCode, Decimal], ...]) -> DisciplineAreaCode:
    return max(area_weights, key=lambda value: (value[1], -area_position(value[0])))[0]


__all__ = [
    "AreaVector",
    "DisciplineAreaCode",
    "DisciplineAreaDefinition",
    "area_catalog",
    "area_definition",
    "area_position",
    "area_vector",
    "discipline_id_for",
    "normalize_classification_name",
    "normalize_discipline_name",
    "primary_area",
    "validate_discipline_identity",
]
