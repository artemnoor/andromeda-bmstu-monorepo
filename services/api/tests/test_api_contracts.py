from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, call

import pytest
from andromeda_api.application.importer.errors import BundleImportError
from andromeda_api.application.publication import PublicationApplicationService
from andromeda_api.application.queries import AcademicDataQueries, ApiReadError
from andromeda_api.dependencies.queries import get_queries
from andromeda_api.main import create_app
from andromeda_contracts.api.v1.models import (
    AdmissionCampaignRecord,
    CompetitionPoolRecord,
    DirectionRecord,
    IndividualAchievementRecord,
    PageResponse,
    PaginationMetadata,
    ReleaseMetadataRecord,
    RequirementTreeRecord,
    SubjectTaxonomyCategoryRecord,
    SubjectTaxonomyRecord,
)
from andromeda_db.repositories.release_publication import ReleasePublicationError
from andromeda_ontology.ports import InvalidCursorError, PageRows
from fastapi.testclient import TestClient


class _Queries:
    def release(self):
        return ReleaseMetadataRecord(
            release_key="fixture-release",
            source_bundle_sha256="a" * 64,
            mapper_version="fixture-mapper",
            activated_at="2026-10-07T00:00:00Z",
            reconciliation_status="passed",
            schema_revision="test-revision",
        )

    def directions(self, limit, cursor):
        return PageResponse[DirectionRecord](
            items=[],
            page=PaginationMetadata(
                limit=limit, next_cursor=None, total_count=0, release_key="fixture-release"
            ),
        )

    def direction(self, key):
        raise ApiReadError(404, "record_not_found", "The requested record was not found.")

    def campaigns(self, limit, cursor, year=None, education_level=None):
        return PageResponse[AdmissionCampaignRecord](
            items=[],
            page=PaginationMetadata(
                limit=limit, next_cursor=None, total_count=0, release_key="fixture-release"
            ),
        )


def _app_with_fixture_queries(queries=None):
    app = create_app()
    app.dependency_overrides[get_queries] = lambda: queries if queries is not None else _Queries()
    return app


def test_openapi_publishes_get_only_v1_contracts() -> None:
    schema = create_app().openapi()
    assert "/api/v1/health" in schema["paths"]
    assert "/api/v1/programs/{key}/study-plans" in schema["paths"]
    assert "/api/v1/requirements/{key}" in schema["paths"]
    assert "/api/v1/place-quotas" in schema["paths"]
    assert "/api/v1/individual-achievements" in schema["paths"]
    assert "/api/v1/competition-pools" in schema["paths"]
    assert "/api/v1/subject-taxonomies/{taxonomy_key}/{taxonomy_version}" in schema["paths"]
    requirement_parameters = schema["paths"]["/api/v1/requirements"]["get"]["parameters"]
    assert {parameter["name"] for parameter in requirement_parameters} >= {
        "campaign_key",
        "direction_key",
        "limit",
        "cursor",
    }
    assert all(
        set(path_item) <= {"get", "parameters", "summary", "description", "operationId", "responses", "deprecated", "security", "servers", "tags"}
        for path_item in schema["paths"].values()
    )


def test_http_errors_share_stable_envelope_and_request_id() -> None:
    with TestClient(_app_with_fixture_queries()) as client:
        missing = client.get("/api/v1/directions/missing", headers={"X-Request-ID": "api-test-17"})
        invalid = client.get("/api/v1/directions?limit=101")
        route_missing = client.get("/api/v1/unknown")

    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "record_not_found"
    assert missing.json()["error"]["request_id"] == "api-test-17"
    assert missing.headers["X-Request-ID"] == "api-test-17"
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "request_validation_failed"
    assert invalid.json()["error"]["field_issues"]
    assert route_missing.status_code == 404
    assert route_missing.json()["error"]["code"] == "route_not_found"


def test_requirements_route_forwards_optional_direction_key() -> None:
    class RequirementsQueries(_Queries):
        def __init__(self):
            self.calls = []

        def requirements(self, limit, cursor, campaign_key=None, direction_key=None):
            self.calls.append((limit, cursor, campaign_key, direction_key))
            return PageResponse[RequirementTreeRecord](
                items=[],
                page=PaginationMetadata(
                    limit=limit,
                    next_cursor=None,
                    total_count=0,
                    release_key="fixture-release",
                ),
            )

    queries = RequirementsQueries()
    with TestClient(_app_with_fixture_queries(queries)) as client:
        filtered = client.get(
            "/api/v1/requirements",
            params={
                "campaign_key": "campaign:bmstu:2026",
                "direction_key": "direction:bmstu:09.03.01",
                "limit": 20,
            },
        )
        legacy = client.get("/api/v1/requirements?limit=25")

    assert filtered.status_code == 200
    assert legacy.status_code == 200
    assert queries.calls == [
        (20, None, "campaign:bmstu:2026", "direction:bmstu:09.03.01"),
        (25, None, None, None),
    ]


def test_invalid_repository_cursor_is_mapped_at_the_http_boundary() -> None:
    class InvalidCursorQueries(_Queries):
        def directions(self, limit, cursor):
            raise InvalidCursorError("cursor is not a valid encoded external key")

    with TestClient(_app_with_fixture_queries(InvalidCursorQueries())) as client:
        response = client.get("/api/v1/directions?cursor=invalid")

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_cursor"


def test_frontend_academic_read_routes_use_existing_typed_query_models() -> None:
    class FrontendQueries(_Queries):
        def __init__(self):
            self.calls = []

        def achievements(self, limit, cursor, campaign_key=None):
            self.calls.append(("achievements", limit, cursor, campaign_key))
            return PageResponse[IndividualAchievementRecord](
                items=[
                    IndividualAchievementRecord(
                        external_key="achievement:2026:olympiad",
                        campaign_key=campaign_key,
                        name="Победитель олимпиады",
                        points=10,
                        ingested_at="2026-10-08T00:00:00Z",
                    )
                ],
                page=PaginationMetadata(
                    limit=limit, next_cursor=None, total_count=1, release_key="fixture-release"
                ),
            )

        def competition_pools(self, limit, cursor, campaign_key=None, direction_code=None):
            self.calls.append(("competition_pools", limit, cursor, campaign_key, direction_code))
            return PageResponse[CompetitionPoolRecord](
                items=[
                    CompetitionPoolRecord(
                        external_key="pool:2026:budget",
                        campaign_key=campaign_key,
                        direction_code="09.03.01",
                        department_status="verified",
                        target_organization="Тестовая организация",
                        target_organization_inn="0123456789",
                        target_organization_kpp="012345678",
                        target_organization_ogrn="0123456789012",
                        target_region="Калужская область",
                        campus_label_in_document="Калужский филиал",
                        places=10,
                        ingested_at="2026-10-08T00:00:00Z",
                    )
                ],
                page=PaginationMetadata(
                    limit=limit, next_cursor=None, total_count=1, release_key="fixture-release"
                ),
            )

        def subject_taxonomy(self, taxonomy_key, taxonomy_version):
            self.calls.append(("subject_taxonomy", taxonomy_key, taxonomy_version))
            return SubjectTaxonomyRecord(
                taxonomy_key=taxonomy_key,
                taxonomy_version=taxonomy_version,
                name="Предметные области учебных планов",
                description="Fixture taxonomy",
                categories=[
                    SubjectTaxonomyCategoryRecord(
                        category_code="01",
                        ordinal=1,
                        name="Математика",
                        definition="Математические дисциплины",
                    )
                ],
            )

    queries = FrontendQueries()
    with TestClient(_app_with_fixture_queries(queries)) as client:
        achievements = client.get(
            "/api/v1/individual-achievements?campaign_key=campaign%3Abmstu%3A2026&limit=20"
        )
        pools = client.get(
            "/api/v1/competition-pools?campaign_key=campaign%3Abmstu%3A2026&direction_code=09.03.01&limit=30"
        )
        taxonomy = client.get(
            "/api/v1/subject-taxonomies/bmstu-subject-domain-16/v1"
        )

    assert achievements.status_code == 200
    assert achievements.json()["items"][0]["name"] == "Победитель олимпиады"
    assert achievements.json()["items"][0]["campaign_key"] == "campaign:bmstu:2026"
    assert achievements.json()["page"]["release_key"] == "fixture-release"
    assert pools.status_code == 200
    assert pools.json()["items"][0]["direction_code"] == "09.03.01"
    assert pools.json()["items"][0]["places"] == 10
    pool = pools.json()["items"][0]
    assert pool["target_organization"] == "Тестовая организация"
    assert pool["target_organization_inn"] == "0123456789"
    assert pool["target_organization_kpp"] == "012345678"
    assert pool["target_organization_ogrn"] == "0123456789012"
    assert pool["target_region"] == "Калужская область"
    assert pool["campus_label_in_document"] == "Калужский филиал"
    assert isinstance(pool["target_organization_inn"], str)
    assert taxonomy.status_code == 200
    assert taxonomy.json()["taxonomy_key"] == "bmstu-subject-domain-16"
    assert taxonomy.json()["categories"][0]["category_code"] == "01"
    assert queries.calls == [
        ("achievements", 20, None, "campaign:bmstu:2026"),
        ("competition_pools", 30, None, "campaign:bmstu:2026", "09.03.01"),
        ("subject_taxonomy", "bmstu-subject-domain-16", "v1"),
    ]


def test_competition_pool_direction_filter_is_applied_by_the_read_query() -> None:
    repository = Mock()
    repository.active_release_key = "fixture-release"
    repository.page.return_value = PageRows(items=[], next_cursor=None, total_count=0)

    result = AcademicDataQueries(repository).competition_pools(
        30, None, direction_code="09.03.01"
    )
    assert result.items == []
    repository.page.assert_called_once_with(
        "competition_pools",
        filters={"direction_code": "09.03.01"},
        limit=30,
        cursor=None,
    )


def test_requirements_query_filters_by_campaign_and_resolved_direction_key() -> None:
    repository = Mock()
    repository.active_release_key = "fixture-release"
    repository.get.side_effect = lambda table, key: {
        ("admission_campaigns", "campaign:bmstu:2026"): {"id": "campaign-id"},
        ("directions", "direction:bmstu:09.03.01"): {"id": "direction-id"},
    }.get((table, key))
    repository.page.return_value = PageRows(items=[], next_cursor=None, total_count=0)

    result = AcademicDataQueries(repository).requirements(
        25,
        None,
        campaign_key="campaign:bmstu:2026",
        direction_key="direction:bmstu:09.03.01",
    )

    assert result.items == []
    assert repository.get.call_args_list == [
        call("admission_campaigns", "campaign:bmstu:2026"),
        call("directions", "direction:bmstu:09.03.01"),
    ]
    repository.page.assert_called_once_with(
        "admission_requirement_sets",
        filters={"campaign_id": "campaign-id", "direction_id": "direction-id"},
        limit=25,
        cursor=None,
    )


def test_requirements_query_without_filters_preserves_unfiltered_behavior() -> None:
    repository = Mock()
    repository.active_release_key = "fixture-release"
    repository.page.return_value = PageRows(items=[], next_cursor=None, total_count=0)

    AcademicDataQueries(repository).requirements(50, None)

    repository.get.assert_not_called()
    repository.page.assert_called_once_with(
        "admission_requirement_sets",
        filters={},
        limit=50,
        cursor=None,
    )


def test_requirements_query_rejects_unknown_direction_key_before_paging() -> None:
    repository = Mock()
    repository.active_release_key = "fixture-release"
    repository.get.side_effect = lambda table, _key: (
        {"id": "campaign-id"} if table == "admission_campaigns" else None
    )

    with pytest.raises(ApiReadError) as error:
        AcademicDataQueries(repository).requirements(
            50,
            None,
            campaign_key="campaign:bmstu:2026",
            direction_key="direction:missing",
        )

    assert error.value.status_code == 404
    assert error.value.code == "record_not_found"
    assert repository.get.call_args_list[-1].args == ("directions", "direction:missing")
    repository.page.assert_not_called()


def test_competition_pool_projection_preserves_target_metadata_and_unresolved_department() -> None:
    repository = Mock()
    repository.get_by_id.side_effect = lambda table, record_id: (
        {"external_key": "campaign:bmstu:2026"}
        if table == "admission_campaigns"
        else None
    )
    repository.related.return_value = []
    repository.evidence_for.return_value = []
    repository.manual_reviews_for.return_value = []
    queries = AcademicDataQueries(repository)

    result = queries._competition_pool(
        {
            "id": "pool-id",
            "external_key": "competition_pool:fixture:targeted",
            "campaign_id": "campaign-id",
            "direction_id": None,
            "department_id": None,
            "direction_code": "09.03.01",
            "department_code": "UNMAPPED-CHAIR",
            "funding_type_id": None,
            "quota_type_id": None,
            "scope_level": "direction_and_target_organization",
            "target_organization": "Тестовая организация",
            "target_organization_inn": "0123456789",
            "target_organization_kpp": "012345678",
            "target_organization_ogrn": "0123456789012",
            "target_region": "Калужская область",
            "campus_label_in_document": "Калужский филиал",
            "places": 1,
            "places_by_source_row": None,
            "valid_from": None,
            "valid_to": None,
            "observed_at": None,
            "ingested_at": "2026-10-08T00:00:00Z",
        }
    )

    assert result.department_status == "unresolved"
    assert result.target_organization == "Тестовая организация"
    assert result.target_organization_inn == "0123456789"
    assert result.target_organization_kpp == "012345678"
    assert result.target_organization_ogrn == "0123456789012"
    assert result.target_region == "Калужская область"
    assert result.campus_label_in_document == "Калужский филиал"


def test_curriculum_query_preserves_explicit_zero_hours_and_falls_back_only_for_nulls() -> None:
    repository = Mock()
    repository.get_by_id.return_value = {"external_key": "study-plan:fixture"}
    repository.evidence_for.return_value = []
    repository.manual_reviews_for.return_value = []
    queries = AcademicDataQueries(repository)

    item = queries._curriculum_item(
        {
            "id": "curriculum-item-id",
            "external_key": "curriculum-item:fixture",
            "study_plan_id": "study-plan-id",
            "ordinal": 1,
            "discipline_name": "Fixture discipline",
            "semester": 1,
            "credits": None,
            "total_hours": 0,
            "hours": 72,
            "total_lecture_hours": 0,
            "lecture_hours": 18,
            "total_practice_hours": None,
            "practice_hours": 24,
            "total_lab_hours": 0,
            "lab_hours": 6,
            "total_self_study_hours": None,
            "self_study_hours": 24,
            "assessment_type": None,
            "department_name": None,
            "faculty_name": None,
            "chair_name": None,
        }
    )

    assert item.hours == 0
    assert item.total_hours == 0
    assert item.lecture_hours == 0
    assert item.practice_hours == 24
    assert item.lab_hours == 0
    assert item.self_study_hours == 24


def test_publication_service_maps_database_failures_to_application_error(monkeypatch) -> None:
    from andromeda_api.application import publication

    engine = Mock()
    monkeypatch.setattr(publication, "create_service_engine", lambda _settings: engine)

    def reject_publication(*_args, **_kwargs):
        raise ReleasePublicationError("candidate base is stale")

    monkeypatch.setattr(publication, "publish_projection", reject_publication)
    prepared = SimpleNamespace(
        release_archive_bytes=b"prepared archive",
        release_context_present=False,
    )

    with pytest.raises(BundleImportError, match="candidate base is stale"):
        PublicationApplicationService(settings=object()).publish_bundle(prepared)

    engine.dispose.assert_called_once_with()


def test_api_has_no_proposal_or_publication_write_routes() -> None:
    schema = create_app().openapi()
    paths = schema["paths"]
    assert not any("/admin/" in path for path in paths)
    assert all(set(item).intersection({"post", "put", "patch", "delete"}) == set() for item in paths.values())


def test_routers_delegate_without_sql_and_query_layer_stays_framework_independent() -> None:
    project_root = Path(__file__).resolve().parents[4]
    routers = project_root / "services" / "api" / "src" / "andromeda_api" / "routers"
    query_files = project_root / "services" / "api" / "src" / "andromeda_api" / "application"
    router_sources = "\n".join(path.read_text(encoding="utf-8") for path in routers.glob("*.py"))
    query_sources = "\n".join(path.read_text(encoding="utf-8") for path in query_files.glob("*.py"))
    assert "sqlalchemy" not in router_sources
    assert "select(" not in router_sources.casefold()
    assert "fastapi" not in query_sources.casefold()
