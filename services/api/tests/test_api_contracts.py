from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from academic_data_service.application.queries import ApiReadError
from academic_data_service.contracts.v1.models import (
    AdmissionCampaignRecord,
    DirectionRecord,
    PageResponse,
    PaginationMetadata,
    ReleaseMetadataRecord,
)
from andromeda_api.dependencies.queries import get_queries
from andromeda_api.main import create_app


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


def _app_with_fixture_queries():
    app = create_app()
    app.dependency_overrides[get_queries] = lambda: _Queries()
    return app


def test_openapi_publishes_get_only_v1_contracts() -> None:
    schema = create_app().openapi()
    assert "/api/v1/health" in schema["paths"]
    assert "/api/v1/programs/{key}/study-plans" in schema["paths"]
    assert "/api/v1/requirements/{key}" in schema["paths"]
    assert "/api/v1/place-quotas" in schema["paths"]
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


def test_api_has_no_proposal_or_publication_write_routes() -> None:
    schema = create_app().openapi()
    paths = schema["paths"]
    assert not any("/admin/" in path for path in paths)
    assert all(set(item).intersection({"post", "put", "patch", "delete"}) == set() for item in paths.values())


def test_routers_delegate_without_sql_and_query_layer_stays_framework_independent() -> None:
    project_root = Path(__file__).resolve().parents[4]
    routers = project_root / "services" / "api" / "src" / "andromeda_api" / "routers"
    query_files = project_root / "academic-data" / "src" / "academic_data_service" / "application"
    router_sources = "\n".join(path.read_text(encoding="utf-8") for path in routers.glob("*.py"))
    query_sources = "\n".join(path.read_text(encoding="utf-8") for path in query_files.glob("*.py"))
    assert "sqlalchemy" not in router_sources
    assert "select(" not in router_sources.casefold()
    assert "fastapi" not in query_sources.casefold()
