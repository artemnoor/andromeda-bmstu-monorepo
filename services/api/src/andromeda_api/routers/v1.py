"""Read-only academic data endpoints for API v1."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query

from andromeda_api.application.queries import AcademicDataQueries
from andromeda_contracts.api.v1.models import (
    AdmissionCampaignRecord,
    AdmissionExamRecord,
    AdmissionOfferingRecord,
    CampaignCalendarEventRecord,
    CurriculumItemRecord,
    DepartmentRecord,
    DirectionRecord,
    EducationalProgramRecord,
    HealthRecord,
    ManualReviewRecord,
    OfficialAdmissionStatisticRecord,
    PageResponse,
    PlaceQuotaRecord,
    ReleaseMetadataRecord,
    RequirementTreeRecord,
    StudyPlanRecord,
    TuitionRecord,
)
from andromeda_api.dependencies.queries import get_queries

router = APIRouter(prefix="/api/v1")


@router.get("/health")
def health(queries: AcademicDataQueries = Depends(get_queries)) -> HealthRecord:
    release = queries.release()
    return HealthRecord(
        status="ready",
        service="andromeda-academic-data",
        api_version="v1",
        active_release_key=release.release_key,
    )


@router.get("/release", response_model=ReleaseMetadataRecord)
def release(queries: AcademicDataQueries = Depends(get_queries)) -> ReleaseMetadataRecord:
    return queries.release()


@router.get("/directions", response_model=PageResponse[DirectionRecord])
def directions(
    limit: int = Query(default=50, ge=1, le=100),
    cursor: str | None = Query(default=None, min_length=1, max_length=1024),
    queries: AcademicDataQueries = Depends(get_queries),
) -> PageResponse[DirectionRecord]:
    return queries.directions(limit, cursor)


@router.get("/directions/{key:path}", response_model=DirectionRecord)
def direction(key: str, queries: AcademicDataQueries = Depends(get_queries)) -> DirectionRecord:
    return queries.direction(key)


@router.get("/departments", response_model=PageResponse[DepartmentRecord])
def departments(
    limit: int = Query(default=50, ge=1, le=100),
    cursor: str | None = Query(default=None, min_length=1, max_length=1024),
    queries: AcademicDataQueries = Depends(get_queries),
) -> PageResponse[DepartmentRecord]:
    return queries.departments(limit, cursor)


@router.get("/departments/{key:path}", response_model=DepartmentRecord)
def department(key: str, queries: AcademicDataQueries = Depends(get_queries)) -> DepartmentRecord:
    return queries.department(key)


@router.get("/programs", response_model=PageResponse[EducationalProgramRecord])
def programs(
    direction_key: str | None = Query(default=None, min_length=1, max_length=256),
    limit: int = Query(default=50, ge=1, le=100),
    cursor: str | None = Query(default=None, min_length=1, max_length=1024),
    queries: AcademicDataQueries = Depends(get_queries),
) -> PageResponse[EducationalProgramRecord]:
    return queries.programs(limit, cursor, direction_key=direction_key)


@router.get("/programs/{key:path}/study-plans", response_model=PageResponse[StudyPlanRecord])
def program_study_plans(
    key: str,
    limit: int = Query(default=50, ge=1, le=100),
    cursor: str | None = Query(default=None, min_length=1, max_length=1024),
    queries: AcademicDataQueries = Depends(get_queries),
) -> PageResponse[StudyPlanRecord]:
    return queries.study_plans(limit, cursor, program_key=key)


@router.get("/programs/{key:path}", response_model=EducationalProgramRecord)
def program(key: str, queries: AcademicDataQueries = Depends(get_queries)) -> EducationalProgramRecord:
    return queries.program(key)


@router.get("/study-plans", response_model=PageResponse[StudyPlanRecord])
def study_plans(
    program_key: str | None = Query(default=None, min_length=1, max_length=256),
    limit: int = Query(default=50, ge=1, le=100),
    cursor: str | None = Query(default=None, min_length=1, max_length=1024),
    queries: AcademicDataQueries = Depends(get_queries),
) -> PageResponse[StudyPlanRecord]:
    return queries.study_plans(limit, cursor, program_key=program_key)


@router.get("/study-plans/{key:path}/items", response_model=PageResponse[CurriculumItemRecord])
def study_plan_items(
    key: str,
    semester: int | None = Query(default=None, ge=1, le=20),
    limit: int = Query(default=50, ge=1, le=100),
    cursor: str | None = Query(default=None, min_length=1, max_length=1024),
    queries: AcademicDataQueries = Depends(get_queries),
) -> PageResponse[CurriculumItemRecord]:
    return queries.curriculum_items(key, limit, cursor, semester=semester)


@router.get("/study-plans/{key:path}", response_model=StudyPlanRecord)
def study_plan(key: str, queries: AcademicDataQueries = Depends(get_queries)) -> StudyPlanRecord:
    return queries.study_plan(key)


@router.get("/campaigns", response_model=PageResponse[AdmissionCampaignRecord])
def campaigns(
    year: int | None = Query(default=None, ge=1900, le=2200),
    education_level: str | None = Query(default=None, min_length=1, max_length=80),
    limit: int = Query(default=50, ge=1, le=100),
    cursor: str | None = Query(default=None, min_length=1, max_length=1024),
    queries: AcademicDataQueries = Depends(get_queries),
) -> PageResponse[AdmissionCampaignRecord]:
    return queries.campaigns(limit, cursor, year=year, education_level=education_level)


@router.get("/campaigns/{key:path}/offerings", response_model=PageResponse[AdmissionOfferingRecord])
def campaign_offerings(
    key: str,
    limit: int = Query(default=50, ge=1, le=100),
    cursor: str | None = Query(default=None, min_length=1, max_length=1024),
    queries: AcademicDataQueries = Depends(get_queries),
) -> PageResponse[AdmissionOfferingRecord]:
    return queries.campaign_offerings(key, limit, cursor)


@router.get("/campaigns/{key:path}/calendar", response_model=PageResponse[CampaignCalendarEventRecord])
def campaign_calendar(
    key: str,
    limit: int = Query(default=50, ge=1, le=100),
    cursor: str | None = Query(default=None, min_length=1, max_length=1024),
    queries: AcademicDataQueries = Depends(get_queries),
) -> PageResponse[CampaignCalendarEventRecord]:
    return queries.campaign_calendar(key, limit, cursor)


@router.get("/campaigns/{key:path}", response_model=AdmissionCampaignRecord)
def campaign(key: str, queries: AcademicDataQueries = Depends(get_queries)) -> AdmissionCampaignRecord:
    return queries.campaign(key)


@router.get("/requirements", response_model=PageResponse[RequirementTreeRecord])
def requirements(
    campaign_key: str | None = Query(default=None, min_length=1, max_length=256),
    limit: int = Query(default=50, ge=1, le=100),
    cursor: str | None = Query(default=None, min_length=1, max_length=1024),
    queries: AcademicDataQueries = Depends(get_queries),
) -> PageResponse[RequirementTreeRecord]:
    return queries.requirements(limit, cursor, campaign_key=campaign_key)


@router.get("/requirements/{key:path}", response_model=RequirementTreeRecord)
def requirement(key: str, queries: AcademicDataQueries = Depends(get_queries)) -> RequirementTreeRecord:
    return queries.requirement(key)


@router.get("/tuition", response_model=PageResponse[TuitionRecord])
def tuition(
    direction_code: str | None = Query(default=None, min_length=1, max_length=32),
    limit: int = Query(default=50, ge=1, le=100),
    cursor: str | None = Query(default=None, min_length=1, max_length=1024),
    queries: AcademicDataQueries = Depends(get_queries),
) -> PageResponse[TuitionRecord]:
    return queries.tuition(limit, cursor, direction_code=direction_code)


@router.get("/statistics", response_model=PageResponse[OfficialAdmissionStatisticRecord])
def statistics(
    kind: Literal["historical", "admission"] = "historical",
    year: int | None = Query(default=None, ge=1900, le=2200),
    direction_code: str | None = Query(default=None, min_length=1, max_length=32),
    limit: int = Query(default=50, ge=1, le=100),
    cursor: str | None = Query(default=None, min_length=1, max_length=1024),
    queries: AcademicDataQueries = Depends(get_queries),
) -> PageResponse[OfficialAdmissionStatisticRecord]:
    return queries.statistics(kind, limit, cursor, year=year, direction_code=direction_code)


@router.get("/exams", response_model=PageResponse[AdmissionExamRecord])
def exams(
    limit: int = Query(default=50, ge=1, le=100),
    cursor: str | None = Query(default=None, min_length=1, max_length=1024),
    queries: AcademicDataQueries = Depends(get_queries),
) -> PageResponse[AdmissionExamRecord]:
    return queries.exams(limit, cursor)


@router.get("/exams/{key:path}", response_model=AdmissionExamRecord)
def exam(key: str, queries: AcademicDataQueries = Depends(get_queries)) -> AdmissionExamRecord:
    return queries.exam(key)


@router.get("/place-quotas", response_model=PageResponse[PlaceQuotaRecord])
def place_quotas(
    campaign_key: str | None = Query(default=None, min_length=1, max_length=256),
    limit: int = Query(default=50, ge=1, le=100),
    cursor: str | None = Query(default=None, min_length=1, max_length=1024),
    queries: AcademicDataQueries = Depends(get_queries),
) -> PageResponse[PlaceQuotaRecord]:
    return queries.place_quotas(limit, cursor, campaign_key=campaign_key)


@router.get("/data-gaps", response_model=PageResponse[ManualReviewRecord])
def data_gaps(
    limit: int = Query(default=50, ge=1, le=100),
    cursor: str | None = Query(default=None, min_length=1, max_length=1024),
    queries: AcademicDataQueries = Depends(get_queries),
) -> PageResponse[ManualReviewRecord]:
    """List unresolved manual review items as recorded data gaps."""
    return queries.manual_reviews(limit, cursor, status="open")
