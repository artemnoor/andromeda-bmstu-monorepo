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
from andromeda_api.application.settings import load_settings
from andromeda_api.main import create_app
from andromeda_db.connection import verify_server_identity
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine


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
) -> tuple[Any, dict[str, Any]]:
    counters = {"count": 0, "duration_ns": 0}

    def before_cursor_execute(
        connection, cursor, statement, parameters, context, executemany
    ):
        context._andromeda_test_profile_started_ns = perf_counter_ns()

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
    return response, {
        "http_client_duration_ms": round(elapsed_ns / 1_000_000, 2),
        "app_duration_ms": header["app_duration_ms"],
        "sql_duration_ms": header["sql_duration_ms"],
        "sql_query_count": counters["count"],
        "sql_duration_event_ms": round(counters["duration_ns"] / 1_000_000, 2),
        "response_bytes": len(response.content),
    }


def test_profile_seeded_catalog_and_curriculum_reads(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    if not os.environ.get("ACADEMIC_DATA_DATABASE_URL"):
        pytest.skip("requires the isolated PostgreSQL 16 academic-data fixture")

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

            program_response, program_profile = _profile_get(
                client, engine, "/api/v1/programs?limit=100"
            )
            program_body = program_response.json()
            assert program_body["page"]["release_key"] == active_release

            plans_response, _ = _profile_get(
                client, engine, "/api/v1/study-plans?limit=100"
            )
            plans = plans_response.json()["items"]
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
            item_path = f"/api/v1/study-plans/{quote(largest_plan['external_key'], safe='')}/items?limit=100"
            items_response, items_profile = _profile_get(client, engine, item_path)
            items_body = items_response.json()
            assert items_body["page"]["release_key"] == active_release
            assert all(
                item["study_plan_key"] == largest_plan["external_key"]
                for item in items_body["items"]
            )
            assert len(items_body["items"]) == min(100, largest_plan["item_count"])

        profile = {
            "databaseServerMajor": identity["server_major"],
            "databaseName": identity["database_name"],
            "databaseUser": database_user,
            "releaseKey": active_release,
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
            "curriculumItemPage": {
                **items_profile,
                "records": len(items_body["items"]),
            },
        }
        if os.environ.get("ANDROMEDA_PROFILE_EXPECT_BATCHED") == "1":
            assert program_profile["sql_query_count"] <= 20
            assert items_profile["sql_query_count"] <= 20

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
