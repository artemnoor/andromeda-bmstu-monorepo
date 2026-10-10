"""Read-only API profile against the isolated, seeded PostgreSQL 16 database."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from time import perf_counter_ns
from typing import Any
from urllib.parse import quote

import pytest
from andromeda_api.application.queries import AcademicDataQueries
from andromeda_api.application.settings import load_settings
from andromeda_api.main import create_app
from andromeda_db.connection import verify_server_identity
from andromeda_db.repositories.read_repository import (
    SQLAlchemyAcademicDataReadRepository,
)
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine

PROFILED_TABLES = (
    "educational_programs",
    "educational_program_departments",
    "study_plans",
    "catalog_courses",
    "program_offerings",
    "directions",
    "departments",
    "direction_departments",
    "program_evidence",
    "direction_evidence",
    "department_evidence",
    "program_department_evidence",
    "curriculum_items",
    "curriculum_evidence",
    "source_evidence",
    "source_artifacts",
    "manual_review_items",
    "subject_classifications",
    "subject_classification_runs",
    "subject_taxonomy_categories",
)
BATCH_METHODS = {
    "get_by_ids",
    "related_many",
    "related_count",
    "related_counts",
    "evidence_for_many",
    "manual_reviews_for_many",
}


class _WithoutBatchReads:
    """Expose the original per-row repository port for in-release parity checks."""

    def __init__(self, repository: SQLAlchemyAcademicDataReadRepository) -> None:
        self._repository = repository

    def __getattr__(self, name: str) -> Any:
        if name in BATCH_METHODS:
            raise AttributeError(name)
        return getattr(self._repository, name)


def _server_timing(header: str) -> dict[str, float | int | None]:
    app_ms = re.search(r"(?:^|,)\s*app;dur=([0-9.]+)", header)
    sql_ms = re.search(r"(?:^|,)\s*sql;dur=([0-9.]+)", header)
    query_count = re.search(r"queries=(\d+)", header)
    return {
        "app_duration_ms": float(app_ms.group(1)) if app_ms else None,
        "sql_duration_ms": float(sql_ms.group(1)) if sql_ms else None,
        "sql_query_count": int(query_count.group(1)) if query_count else None,
    }


def _profile_get(
    client: TestClient, engine: Engine, path: str
) -> tuple[Any, dict[str, Any], list[tuple[str, Any]]]:
    counters: dict[str, Any] = {"count": 0, "duration_ns": 0, "statements": []}

    def before_cursor_execute(
        connection, cursor, statement, parameters, context, executemany
    ):
        context._andromeda_test_profile_started_ns = perf_counter_ns()
        counters["statements"].append((statement, parameters))

    def after_cursor_execute(
        connection, cursor, statement, parameters, context, executemany
    ):
        started = getattr(context, "_andromeda_test_profile_started_ns", None)
        if started is not None:
            counters["count"] += 1
            counters["duration_ns"] += perf_counter_ns() - started

    event.listen(engine, "before_cursor_execute", before_cursor_execute)
    event.listen(engine, "after_cursor_execute", after_cursor_execute)
    started = perf_counter_ns()
    try:
        response = client.get(path)
    finally:
        elapsed_ns = perf_counter_ns() - started
        event.remove(engine, "before_cursor_execute", before_cursor_execute)
        event.remove(engine, "after_cursor_execute", after_cursor_execute)

    assert response.status_code == 200, response.text
    header = _server_timing(response.headers.get("server-timing", ""))
    assert header["sql_query_count"] == counters["count"]
    statements = counters["statements"]
    return response, {
        "http_client_duration_ms": round(elapsed_ns / 1_000_000, 2),
        "app_duration_ms": header["app_duration_ms"],
        "sql_duration_ms": header["sql_duration_ms"],
        "sql_query_count": counters["count"],
        "sql_duration_event_ms": round(counters["duration_ns"] / 1_000_000, 2),
        "response_bytes": len(response.content),
        "table_statement_counts": {
            table: sum(table in statement.casefold() for statement, _ in statements)
            for table in PROFILED_TABLES
            if any(table in statement.casefold() for statement, _ in statements)
        },
    }, statements


def _explain_queries(
    engine: Engine, statements: list[tuple[str, Any]], table_name: str
) -> list[dict[str, Any]]:
    candidates = {
        statement: parameters
        for statement, parameters in statements
        if table_name in statement.casefold()
    }
    results = []
    for statement, parameters in candidates.items():
        with engine.connect() as connection:
            raw_plan = connection.exec_driver_sql(
                f"EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {statement}", parameters
            ).scalar_one()
        report = raw_plan[0]
        plan_nodes = []
        pending = [report["Plan"]]
        while pending:
            node = pending.pop(0)
            plan_nodes.append(
                {
                    key: node[key]
                    for key in (
                        "Node Type",
                        "Relation Name",
                        "Index Name",
                        "Plan Rows",
                        "Actual Rows",
                        "Actual Total Time",
                        "Shared Hit Blocks",
                        "Shared Read Blocks",
                    )
                    if key in node
                }
            )
            pending.extend(node.get("Plans", []))
        results.append(
            {
                "planningTimeMs": report.get("Planning Time"),
                "executionTimeMs": report.get("Execution Time"),
                "plan": plan_nodes,
            }
        )
    return results


def test_profile_seeded_catalog_and_curriculum_reads(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    if not os.environ.get("ACADEMIC_DATA_DATABASE_URL"):
        pytest.skip("requires the isolated PostgreSQL 16 academic-data fixture")
    if not os.environ.get("ANDROMEDA_PROFILE_OUTPUT"):
        pytest.skip("runs only in the dedicated isolated PostgreSQL profile job")

    settings = load_settings()
    monkeypatch.setenv("ACADEMIC_DATA_PROFILE_REQUESTS", "1")
    engine = create_engine(settings.database_url, pool_size=2, max_overflow=0)
    try:
        with engine.connect() as connection:
            identity = verify_server_identity(connection, settings)
            database_user = connection.execute(text("SELECT current_user")).scalar_one()
        if (
            identity["database_name"] != "academic_data_test"
            or identity["server_major"] != 16
            or database_user != "andromeda_test"
        ):
            pytest.fail(
                "profile test must use the disposable PostgreSQL 16 database and role"
            )

        app = create_app(settings=settings, engine=engine)
        with TestClient(app) as client:
            active_response = client.get("/api/v1/release")
            assert active_response.status_code == 200, active_response.text
            active_release = active_response.json()["release_key"]

            direction_response, direction_profile, direction_statements = _profile_get(
                client, engine, "/api/v1/directions?limit=100"
            )
            direction_body = direction_response.json()
            assert direction_body["page"]["release_key"] == active_release

            department_response, department_profile, department_statements = _profile_get(
                client, engine, "/api/v1/departments?limit=100"
            )
            department_body = department_response.json()
            assert department_body["page"]["release_key"] == active_release

            program_response, program_profile, _ = _profile_get(
                client, engine, "/api/v1/programs?limit=100"
            )
            program_body = program_response.json()
            assert program_body["page"]["release_key"] == active_release

            plans: list[dict[str, Any]] = []
            study_plan_page_profiles: list[dict[str, Any]] = []
            cursor: str | None = None
            seen_cursors: set[str] = set()
            expected_plan_count: int | None = None
            while True:
                query = "?limit=100"
                if cursor is not None:
                    query += f"&cursor={quote(cursor, safe='')}"
                plans_response, plans_profile, _ = _profile_get(
                    client, engine, f"/api/v1/study-plans{query}"
                )
                plans_body = plans_response.json()
                assert plans_body["page"]["release_key"] == active_release
                if expected_plan_count is None:
                    expected_plan_count = plans_body["page"]["total_count"]
                else:
                    assert plans_body["page"]["total_count"] == expected_plan_count
                plans.extend(plans_body["items"])
                study_plan_page_profiles.append(plans_profile)
                next_cursor = plans_body["page"]["next_cursor"]
                if next_cursor is None:
                    break
                assert next_cursor not in seen_cursors, "study-plan pagination cursor repeated"
                seen_cursors.add(next_cursor)
                cursor = next_cursor
            assert len(plans) == expected_plan_count
            verified_plans = [
                plan
                for plan in plans
                if plan["profile_link_status"] == "verified"
                and plan["status"] == "parsed"
                and plan["item_count"] > 0
            ]
            if not verified_plans:
                pytest.skip(
                    "seeded PostgreSQL release has no parsed, verified study plan"
                )
            largest_plan = max(verified_plans, key=lambda plan: plan["item_count"])
            selected_program_key = largest_plan["program_key"]
            assert selected_program_key is not None
            (
                selected_plans_response,
                selected_plans_profile,
                selected_plan_statements,
            ) = _profile_get(
                client,
                engine,
                f"/api/v1/study-plans?limit=100&program_key={quote(selected_program_key, safe='')}",
            )
            selected_plans_body = selected_plans_response.json()
            assert selected_plans_body["page"]["release_key"] == active_release
            assert all(
                plan["program_key"] == selected_program_key
                for plan in selected_plans_body["items"]
            )
            item_path = f"/api/v1/study-plans/{quote(largest_plan['external_key'], safe='')}/items?limit=100"
            items_response, items_profile, item_statements = _profile_get(
                client, engine, item_path
            )
            items_body = items_response.json()
            assert items_body["page"]["release_key"] == active_release
            assert all(
                item["study_plan_key"] == largest_plan["external_key"]
                for item in items_body["items"]
            )
            assert len(items_body["items"]) == min(100, largest_plan["item_count"])

            campaign_response, campaign_profile, _ = _profile_get(
                client, engine, "/api/v1/campaigns?limit=100"
            )
            campaigns_body = campaign_response.json()
            assert campaigns_body["page"]["release_key"] == active_release
            assert campaigns_body["items"]
            campaign_key = campaigns_body["items"][0]["external_key"]
            escaped_campaign_key = quote(campaign_key, safe="")
            admission_paths = {
                "campaignOfferings": f"/api/v1/campaigns/{escaped_campaign_key}/offerings?limit=100",
                "campaignCalendar": f"/api/v1/campaigns/{escaped_campaign_key}/calendar?limit=100",
                "requirements": f"/api/v1/requirements?campaign_key={escaped_campaign_key}&limit=100",
                "competitionPools": f"/api/v1/competition-pools?campaign_key={escaped_campaign_key}&limit=100",
                "placeQuotas": f"/api/v1/place-quotas?campaign_key={escaped_campaign_key}&limit=100",
            }
            admission_profiles: dict[str, dict[str, Any]] = {}
            admission_bodies: dict[str, dict[str, Any]] = {}
            for name, path in admission_paths.items():
                response, endpoint_profile, _ = _profile_get(client, engine, path)
                body = response.json()
                assert body["page"]["release_key"] == active_release
                admission_profiles[name] = endpoint_profile
                admission_bodies[name] = body

            selected_program = next(
                (
                    program
                    for program in program_body["items"]
                    if program["external_key"] == selected_program_key
                ),
                None,
            )
            direction_key = selected_program.get("direction_key") if selected_program else None
            direction = next(
                (
                    value
                    for value in direction_body["items"]
                    if value["external_key"] == direction_key
                ),
                None,
            )
            direction_code = direction.get("code") if direction else None
            if direction_code:
                escaped_direction_code = quote(direction_code, safe="")
                for name, path in {
                    "tuition": f"/api/v1/tuition?direction_code={escaped_direction_code}&limit=100",
                    "historicalStatistics": f"/api/v1/statistics?kind=historical&direction_code={escaped_direction_code}&limit=100",
                    "admissionStatistics": f"/api/v1/statistics?kind=admission&direction_code={escaped_direction_code}&limit=100",
                }.items():
                    response, endpoint_profile, _ = _profile_get(client, engine, path)
                    body = response.json()
                    assert body["page"]["release_key"] == active_release
                    admission_profiles[name] = endpoint_profile
                    admission_bodies[name] = body

        profile = {
            "databaseServerMajor": identity["server_major"],
            "databaseName": identity["database_name"],
            "databaseUser": database_user,
            "releaseKey": active_release,
            "directionPage": {
                **direction_profile,
                "records": len(direction_body["items"]),
                "totalRecords": direction_body["page"]["total_count"],
                "directionAndDepartmentExplainAnalyze": {
                    "directions": _explain_queries(
                        engine, direction_statements, "directions"
                    ),
                    "direction_departments": _explain_queries(
                        engine, direction_statements, "direction_departments"
                    ),
                },
            },
            "departmentPage": {
                **department_profile,
                "records": len(department_body["items"]),
                "totalRecords": department_body["page"]["total_count"],
                "departmentExplainAnalyze": _explain_queries(
                    engine, department_statements, "departments"
                ),
            },
            "programPage": {
                **program_profile,
                "records": len(program_body["items"]),
                "totalRecords": program_body["page"]["total_count"],
            },
            "largestVerifiedPlan": {
                "planKey": largest_plan["external_key"],
                "programKey": largest_plan["program_key"],
                "expectedItemCount": largest_plan["item_count"],
                "returnedItemCount": len(items_body["items"]),
            },
            "studyPlanCatalog": {
                "pages": len(study_plan_page_profiles),
                "records": len(plans),
                "totalRecords": expected_plan_count,
                "pageProfiles": study_plan_page_profiles,
            },
            "selectedProgramStudyPlanPage": {
                **selected_plans_profile,
                "programKey": selected_program_key,
                "records": len(selected_plans_body["items"]),
                "totalRecords": selected_plans_body["page"]["total_count"],
                "curriculumItemCountExplainAnalyze": _explain_queries(
                    engine, selected_plan_statements, "curriculum_items"
                ),
            },
            "curriculumItemPage": {
                **items_profile,
                "records": len(items_body["items"]),
            },
            "campaignPage": {
                **campaign_profile,
                "records": len(campaigns_body["items"]),
                "totalRecords": campaigns_body["page"]["total_count"],
            },
            "admissionReadPages": {
                name: {
                    **endpoint_profile,
                    "records": len(admission_bodies[name]["items"]),
                    "totalRecords": admission_bodies[name]["page"]["total_count"],
                }
                for name, endpoint_profile in admission_profiles.items()
            },
            "curriculumItemPageExplainAnalyze": _explain_queries(
                engine, item_statements, "curriculum_items"
            ),
        }
        with engine.connect().execution_options(
            isolation_level="REPEATABLE READ"
        ) as connection:
            transaction = connection.begin()
            try:
                connection.execute(text("SET TRANSACTION READ ONLY"))
                verify_server_identity(connection, settings)
                unbatched = AcademicDataQueries(
                    _WithoutBatchReads(SQLAlchemyAcademicDataReadRepository(connection))
                )
                unbatched_directions = unbatched.directions(100, None).model_dump(mode="json")
                unbatched_departments = unbatched.departments(100, None).model_dump(mode="json")
                unbatched_programs = unbatched.programs(100, None).model_dump(mode="json")
                unbatched_campaigns = unbatched.campaigns(100, None).model_dump(mode="json")
                unbatched_plans = unbatched.study_plans(
                    100, None, selected_program_key
                ).model_dump(mode="json")
                unbatched_items = unbatched.curriculum_items(
                    largest_plan["external_key"], 100, None
                ).model_dump(mode="json")
                unbatched_admission_bodies = {
                    "campaignOfferings": unbatched.campaign_offerings(
                        campaign_key, 100, None
                    ).model_dump(mode="json"),
                    "campaignCalendar": unbatched.campaign_calendar(
                        campaign_key, 100, None
                    ).model_dump(mode="json"),
                    "requirements": unbatched.requirements(
                        100, None, campaign_key=campaign_key
                    ).model_dump(mode="json"),
                    "competitionPools": unbatched.competition_pools(
                        100, None, campaign_key=campaign_key
                    ).model_dump(mode="json"),
                    "placeQuotas": unbatched.place_quotas(
                        100, None, campaign_key=campaign_key
                    ).model_dump(mode="json"),
                }
                if direction_code:
                    unbatched_admission_bodies.update(
                        {
                            "tuition": unbatched.tuition(
                                100, None, direction_code=direction_code
                            ).model_dump(mode="json"),
                            "historicalStatistics": unbatched.statistics(
                                "historical", 100, None, direction_code=direction_code
                            ).model_dump(mode="json"),
                            "admissionStatistics": unbatched.statistics(
                                "admission", 100, None, direction_code=direction_code
                            ).model_dump(mode="json"),
                        }
                    )
            finally:
                if transaction.is_active:
                    transaction.rollback()
        assert unbatched_directions == direction_body
        assert unbatched_departments == department_body
        assert unbatched_programs == program_body
        assert unbatched_campaigns == campaigns_body
        assert unbatched_plans == selected_plans_body
        assert unbatched_items == items_body
        assert unbatched_admission_bodies == admission_bodies
        profile["parity"] = {
            "unbatchedReadModelMatchesDirectionPage": True,
            "unbatchedReadModelMatchesDepartmentPage": True,
            "unbatchedReadModelMatchesProgramPage": True,
            "unbatchedReadModelMatchesCampaignPage": True,
            "unbatchedReadModelMatchesSelectedProgramStudyPlans": True,
            "unbatchedReadModelMatchesCurriculumPage": True,
            "unbatchedReadModelMatchesAdmissionPages": True,
            "releaseKey": active_release,
        }
        if os.environ.get("ANDROMEDA_PROFILE_EXPECT_BATCHED") == "1":
            assert direction_profile["sql_query_count"] <= 20
            assert department_profile["sql_query_count"] <= 20
            assert program_profile["sql_query_count"] <= 20
            assert selected_plans_profile["sql_query_count"] <= 20
            assert all(page["sql_query_count"] <= 20 for page in study_plan_page_profiles)
            assert items_profile["sql_query_count"] <= 20
            admission_query_counts = {
                name: page["sql_query_count"] for name, page in admission_profiles.items()
            }
            admission_query_counts["campaigns"] = campaign_profile["sql_query_count"]
            assert all(
                query_count <= 20 for query_count in admission_query_counts.values()
            ), admission_query_counts

        output_path = os.environ.get("ANDROMEDA_PROFILE_OUTPUT")
        serialized = json.dumps(profile, ensure_ascii=False, indent=2)
        print(
            f"BACKEND_READ_PROFILE {json.dumps(profile, ensure_ascii=False, separators=(',', ':'))}"
        )
        if output_path:
            target = Path(output_path)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(serialized + "\n", encoding="utf-8")
    finally:
        engine.dispose()
