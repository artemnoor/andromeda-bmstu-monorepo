"""Request-scoped query service backed by one repeatable-read snapshot."""

from __future__ import annotations

from collections.abc import Iterator

from andromeda_db.connection import (
    create_service_engine,
    verify_server_identity,
)
from andromeda_db.repositories.read_repository import (
    NoActiveReleaseError,
    SQLAlchemyAcademicDataReadRepository,
)
from fastapi import Request
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from andromeda_api.application.queries import AcademicDataQueries, ApiReadError
from andromeda_api.application.settings import Settings, load_settings
from andromeda_api.profiling import (
    attach_engine_profiler,
    bind_request_profile,
    unbind_request_profile,
)


def _runtime_settings(request: Request) -> Settings:
    settings = request.app.state.settings
    if settings is None:
        settings = load_settings()
        request.app.state.settings = settings
    return settings


def _runtime_engine(request: Request, settings: Settings) -> Engine:
    engine = request.app.state.engine
    if engine is None:
        engine = create_service_engine(
            settings,
            pool_size=settings.db_pool_size,
            max_overflow=settings.db_max_overflow,
            pool_timeout=settings.db_pool_timeout_seconds,
            connect_args={"connect_timeout": settings.db_connect_timeout_seconds},
        )
        request.app.state.engine = engine
        request.app.state.owns_engine = True
    return engine


def get_queries(request: Request) -> Iterator[AcademicDataQueries]:
    """Open one read-only PostgreSQL snapshot and bind all queries to it."""
    settings = _runtime_settings(request)
    engine = _runtime_engine(request, settings)
    profile = getattr(request.state, "api_profile", None)
    if profile is not None:
        attach_engine_profiler(engine)
    connection: Connection = engine.connect().execution_options(
        isolation_level="REPEATABLE READ"
    )
    bind_request_profile(connection, profile)
    transaction = connection.begin()
    try:
        connection.execute(text("SET TRANSACTION READ ONLY"))
        verify_server_identity(connection, settings)
        connection.execute(
            text("SELECT set_config('statement_timeout', :timeout, true)"),
            {"timeout": f"{settings.db_statement_timeout_ms}ms"},
        )
        repository = SQLAlchemyAcademicDataReadRepository(connection)
        try:
            yield AcademicDataQueries(repository)
        except NoActiveReleaseError as error:
            raise ApiReadError(
                503,
                "active_release_unavailable",
                "No committed data release is ready.",
            ) from error
    finally:
        unbind_request_profile(connection)
        if transaction.is_active:
            transaction.rollback()
        connection.close()
