"""Opt-in, payload-free request and SQL timings for controlled benchmarks."""

from __future__ import annotations

import os
from time import perf_counter_ns
from typing import Any

from sqlalchemy import event
from sqlalchemy.engine import Connection, Engine

PROFILE_ENV = "ACADEMIC_DATA_PROFILE_REQUESTS"
PROFILE_INFO_KEY = "andromeda_api_profile"


def profiling_enabled() -> bool:
    return os.environ.get(PROFILE_ENV) == "1"


def new_request_profile() -> dict[str, int]:
    return {"sql_count": 0, "sql_duration_ns": 0}


def attach_engine_profiler(engine: Engine) -> None:
    """Install cheap SQLAlchemy callbacks once; they act only on profiled connections."""
    if getattr(engine, "_andromeda_profile_installed", False):
        return

    def before_cursor_execute(
        connection: Connection,
        cursor: Any,
        statement: str,
        parameters: Any,
        context: Any,
        executemany: bool,
    ) -> None:
        if PROFILE_INFO_KEY in connection.info:
            connection.info["_andromeda_profile_statement_start_ns"] = perf_counter_ns()

    def after_cursor_execute(
        connection: Connection,
        cursor: Any,
        statement: str,
        parameters: Any,
        context: Any,
        executemany: bool,
    ) -> None:
        profile = connection.info.get(PROFILE_INFO_KEY)
        started = connection.info.pop("_andromeda_profile_statement_start_ns", None)
        if profile is not None and started is not None:
            profile["sql_count"] += 1
            profile["sql_duration_ns"] += perf_counter_ns() - started

    event.listen(engine, "before_cursor_execute", before_cursor_execute)
    event.listen(engine, "after_cursor_execute", after_cursor_execute)
    engine._andromeda_profile_installed = True


def bind_request_profile(
    connection: Connection, profile: dict[str, int] | None
) -> None:
    if profile is None:
        return
    connection.info[PROFILE_INFO_KEY] = profile


def unbind_request_profile(connection: Connection) -> None:
    connection.info.pop(PROFILE_INFO_KEY, None)
    connection.info.pop("_andromeda_profile_statement_start_ns", None)


def server_timing_header(profile: dict[str, int], request_duration_ns: int) -> str:
    app_ms = request_duration_ns / 1_000_000
    sql_ms = profile["sql_duration_ns"] / 1_000_000
    return f'app;dur={app_ms:.2f}, sql;dur={sql_ms:.2f};desc="queries={profile["sql_count"]}"'
