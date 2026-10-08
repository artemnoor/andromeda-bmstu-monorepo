"""Reviewed, source-backed admission-cycle contracts."""

from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum
from typing import Annotated

from pydantic import Field, StringConstraints, field_validator, model_validator

from andromeda_ontology.ontology.admission import (
    admission_cycle_id as _admission_cycle_id,
    require_aware_utc,
    validate_admission_cycle,
    validate_inclusive_date_window,
)
from andromeda.modules.knowledge.contracts.evidence import EvidenceRef
from andromeda.shared.contracts.base import ContractModel
from andromeda.shared.contracts.ids import (
    AccountId,
    EducationYear,
    NonEmptyText,
    UniversityId,
)

AdmissionCycleId = Annotated[
    str,
    StringConstraints(pattern=r"^admission-cycle:[a-z0-9][a-z0-9-]{0,62}:(?:20[0-9]{2}|2100)$"),
]


class AdmissionCycleState(StrEnum):
    PLANNED = "planned"
    PUBLISHED = "published"
    APPLICATION_OPEN = "application_open"
    ENROLLMENT_OPEN = "enrollment_open"
    CLOSED = "closed"
    CANCELLED = "cancelled"
    UNKNOWN = "unknown"


class InclusiveDateWindow(ContractModel):
    """Civil-date range whose start and end dates are both included."""

    start_date: date
    end_date: date

    @model_validator(mode="after")
    def validate_order(self) -> InclusiveDateWindow:
        validate_inclusive_date_window(self.start_date, self.end_date)
        return self


class AdmissionCycle(ContractModel):
    """An immutable, approved revision of one university admission campaign."""

    cycle_id: AdmissionCycleId
    revision: int = Field(strict=True, ge=1, le=2_147_483_647)
    university_id: UniversityId
    admission_year: EducationYear
    academic_year: str = Field(pattern=r"^[0-9]{4}/[0-9]{4}$", min_length=9, max_length=9)
    application_period: InclusiveDateWindow | None = None
    enrollment_period: InclusiveDateWindow | None = None
    state: AdmissionCycleState
    evidence: tuple[EvidenceRef, ...] = Field(min_length=1, max_length=128)
    approved_by_account_id: AccountId
    approved_at: datetime
    approval_reason: NonEmptyText
    recorded_at: datetime

    @field_validator("approved_at", "recorded_at")
    @classmethod
    def require_aware_timestamps(cls, value: datetime) -> datetime:
        return require_aware_utc(value)

    @model_validator(mode="after")
    def validate_identity_and_audit(self) -> AdmissionCycle:
        evidence_keys = tuple(
            (item.source_observation_id, item.source_url, item.locator.model_dump_json())
            for item in self.evidence
        )
        validate_admission_cycle(
            self.cycle_id,
            self.university_id,
            self.admission_year,
            self.academic_year,
            self.approved_at,
            self.recorded_at,
            evidence_keys,
        )
        return self


class AdmissionCycleResolutionStatus(StrEnum):
    RESOLVED = "resolved"
    BLOCKED_BY_MISSING_DATA = "blocked_by_missing_data"


class AdmissionCycleResolution(ContractModel):
    status: AdmissionCycleResolutionStatus
    cycle: AdmissionCycle | None = None
    reason: str | None = Field(default=None, min_length=1, max_length=512)

    @model_validator(mode="after")
    def validate_status_payload(self) -> AdmissionCycleResolution:
        if self.status is AdmissionCycleResolutionStatus.RESOLVED:
            if self.cycle is None or self.reason is not None:
                raise ValueError("resolved cycle lookup requires a cycle and no blocker reason")
        elif self.cycle is not None or self.reason is None:
            raise ValueError("missing cycle lookup requires a reason and no cycle")
        return self


def admission_cycle_id(university_id: UniversityId, admission_year: EducationYear) -> AdmissionCycleId:
    return _admission_cycle_id(university_id, admission_year)


__all__ = [
    "AdmissionCycle",
    "AdmissionCycleId",
    "AdmissionCycleResolution",
    "AdmissionCycleResolutionStatus",
    "AdmissionCycleState",
    "InclusiveDateWindow",
    "admission_cycle_id",
]
