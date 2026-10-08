"""Stable contracts shared by the admissions module and its adapters."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Self

from andromeda.shared.contracts.base import ContractModel
from andromeda.shared.contracts.ids import (
    AdmissionCampusId,
    AdmissionExamChoiceGroupId,
    EducationYear,
    NonEmptyText,
    ProgramId,
    ShortText,
    SourceHash,
)
from andromeda_ontology.ontology.admission import (
    validate_admission_offering,
    validate_exam_choice_metadata,
    validate_passing_score_status,
    validate_program_admissions,
)
from pydantic import Field, HttpUrl, model_validator

from .admission_cycles import (
    AdmissionCycle,
    AdmissionCycleId,
    AdmissionCycleResolution,
    AdmissionCycleResolutionStatus,
    AdmissionCycleState,
    InclusiveDateWindow,
    admission_cycle_id,
)

ZERO = Decimal(0)


class StudyForm(StrEnum):
    FULL_TIME = "full_time"
    PART_TIME = "part_time"
    EVENING = "evening"
    ONLINE = "online"
    UNKNOWN = "unknown"


class FundingType(StrEnum):
    BUDGET = "budget"
    PAID = "paid"
    TARGETED = "targeted"
    UNKNOWN = "unknown"


class AdmissionScope(StrEnum):
    PROGRAM = "program"
    DIRECTION = "direction"


class QuotaType(StrEnum):
    SPECIAL = "special"
    SEPARATE = "separate"
    TARGETED = "targeted"
    OTHER = "other"


class PassingScoreType(StrEnum):
    BUDGET = "budget"
    PAID = "paid"
    AVERAGE = "average"
    OTHER = "other"


class AdmissionCompetitionType(StrEnum):
    GENERAL = "general"
    SPECIAL_QUOTA = "special_quota"
    SEPARATE_QUOTA = "separate_quota"
    TARGETED = "targeted"
    BVI = "bvi"
    OTHER = "other"


class PassingScoreStatus(StrEnum):
    NUMERIC = "numeric"
    BVI = "bvi"


class AdmissionProvenance(ContractModel):
    source_kind: ShortText
    source_url: HttpUrl
    captured_at: datetime
    content_sha256: SourceHash
    locator: ShortText | None = None
    source_name: NonEmptyText | None = None
    university_id: str | None = None
    run_id: str | None = None
    field: ShortText | None = None
    record_key: ShortText | None = None
    inferred: bool = False


class ExamRequirement(ContractModel):
    subject: NonEmptyText
    source_name: NonEmptyText
    minimum_score: Decimal | None = Field(default=None, strict=True, ge=ZERO, le=Decimal(100), max_digits=5, decimal_places=2)
    is_choice: bool = False
    is_required: bool = True
    choice_group_id: AdmissionExamChoiceGroupId | None = None
    choice_group_min: int | None = Field(default=None, strict=True, ge=1, le=20)
    choice_group_max: int | None = Field(default=None, strict=True, ge=1, le=20)
    provenance: AdmissionProvenance

    @model_validator(mode="after")
    def validate_choice_metadata(self) -> ExamRequirement:
        validate_exam_choice_metadata(
            choice_group_id=self.choice_group_id,
            choice_group_min=self.choice_group_min,
            choice_group_max=self.choice_group_max,
            is_choice=self.is_choice,
        )
        return self


class Quota(ContractModel):
    quota_type: QuotaType
    source_name: NonEmptyText
    places: int = Field(strict=True, ge=0, le=100_000)
    provenance: AdmissionProvenance


class PassingScore(ContractModel):
    score_type: PassingScoreType
    competition_type: AdmissionCompetitionType = AdmissionCompetitionType.GENERAL
    status: PassingScoreStatus = PassingScoreStatus.NUMERIC
    score: Decimal | None = Field(default=None, strict=True, ge=ZERO, le=Decimal(400), max_digits=6, decimal_places=2)
    provenance: AdmissionProvenance

    @model_validator(mode="after")
    def validate_status(self) -> Self:
        validate_passing_score_status(
            status=self.status,
            score=self.score,
            competition_type=self.competition_type,
        )
        return self


class TuitionCost(ContractModel):
    amount: Decimal = Field(strict=True, ge=ZERO, max_digits=12, decimal_places=2)
    currency: ShortText
    academic_year: str | None = Field(default=None, min_length=4, max_length=32)
    period: NonEmptyText | None = None
    study_form: StudyForm | None = None
    is_discounted: bool = False
    provenance: AdmissionProvenance


class AdmissionOffering(ContractModel):
    id: NonEmptyText
    program_id: ProgramId
    admission_year: EducationYear
    study_form: StudyForm | None = None
    funding_type: FundingType | None = None
    campus_id: AdmissionCampusId | None = None
    scope: AdmissionScope
    places: int | None = Field(default=None, strict=True, ge=0, le=100_000)
    exams: tuple[ExamRequirement, ...] = ()
    quotas: tuple[Quota, ...] = ()
    passing_scores: tuple[PassingScore, ...] = ()
    tuition: tuple[TuitionCost, ...] = ()
    provenance: tuple[AdmissionProvenance, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_identity(self) -> Self:
        validate_admission_offering(
            offering_id=self.id,
            funding_type=self.funding_type,
            places=self.places,
            tuition_present=bool(self.tuition),
            exams=tuple(
                (exam.choice_group_id, exam.choice_group_min, exam.choice_group_max)
                for exam in self.exams
            ),
        )
        return self


class ProgramAdmissions(ContractModel):
    """All source-backed admission facts currently known for one program."""

    program_id: ProgramId
    offerings: tuple[AdmissionOffering, ...] = ()

    @model_validator(mode="after")
    def validate_program_identity(self) -> Self:
        validate_program_admissions(
            self.program_id,
            tuple((offering.id, offering.program_id) for offering in self.offerings),
        )
        return self


__all__ = [
    "AdmissionCampusId",
    "AdmissionCompetitionType",
    "AdmissionCycle",
    "AdmissionCycleId",
    "AdmissionCycleResolution",
    "AdmissionCycleResolutionStatus",
    "AdmissionCycleState",
    "AdmissionExamChoiceGroupId",
    "AdmissionOffering",
    "AdmissionProvenance",
    "AdmissionScope",
    "ExamRequirement",
    "FundingType",
    "InclusiveDateWindow",
    "PassingScore",
    "PassingScoreStatus",
    "PassingScoreType",
    "ProgramAdmissions",
    "Quota",
    "QuotaType",
    "StudyForm",
    "TuitionCost",
    "admission_cycle_id",
]
