"""FastAPI composition root for the read-only v1 API."""

from __future__ import annotations

import logging
import re
import uuid
from contextlib import asynccontextmanager
from typing import Any

from andromeda_contracts.api.v1.models import ApiErrorEnvelope
from andromeda_ontology.ports import InvalidCursorError
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException

from andromeda_api.application.queries import ApiReadError
from andromeda_api.routers.v1 import router as v1_router

REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
logger = logging.getLogger("andromeda.api")


@asynccontextmanager
async def _lifespan(app: FastAPI):
    yield
    if app.state.owns_engine and app.state.engine is not None:
        app.state.engine.dispose()


def create_app(*, settings: Any | None = None, engine: Any | None = None) -> FastAPI:
    """Create the read-only HTTP application; DB settings are loaded on first request."""
    app = FastAPI(
        title="Andromeda Academic Data API",
        summary="Read-only view of one active, immutable academic data release.",
        version="1.0.0",
        description=(
            "All academic reads are scoped to one PostgreSQL active release per request. "
            "This API has no proposal, review, or publication write endpoints."
        ),
        openapi_url="/openapi.json",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=_lifespan,
    )
    app.state.settings = settings
    app.state.engine = engine
    app.state.owns_engine = False
    app.include_router(v1_router)

    @app.middleware("http")
    async def request_id_header(request: Request, call_next):
        incoming = request.headers.get("x-request-id", "")
        request_id = incoming if REQUEST_ID_PATTERN.fullmatch(incoming) else str(uuid.uuid4())
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response

    @app.exception_handler(ApiReadError)
    async def query_error(request: Request, error: ApiReadError):
        return _error_response(request, error.status_code, error.code, error.public_message)

    @app.exception_handler(InvalidCursorError)
    async def invalid_cursor_error(request: Request, error: InvalidCursorError):
        return _error_response(request, 422, "invalid_cursor", "The page cursor is invalid.")

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, error: RequestValidationError):
        envelope = ApiErrorEnvelope(
            error={
                "code": "request_validation_failed",
                "message": "One or more request parameters are invalid.",
                "request_id": _request_id(request),
                "field_issues": [
                    {
                        "path": list(issue.get("loc", ())),
                        "code": str(issue.get("type", "invalid")),
                        "message": str(issue.get("msg", "Invalid value.")),
                    }
                    for issue in error.errors()
                ],
            }
        )
        return JSONResponse(status_code=422, content=envelope.model_dump(mode="json"))

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, error: StarletteHTTPException):
        if error.status_code == 404:
            code, message = "route_not_found", "The requested route was not found."
        elif error.status_code == 405:
            code, message = "method_not_allowed", "The requested method is not allowed."
        else:
            code, message = "http_error", "The request could not be completed."
        return _error_response(request, error.status_code, code, message)

    @app.exception_handler(SQLAlchemyError)
    async def database_error(request: Request, error: SQLAlchemyError):
        logger.warning("database_read_failed request_id=%s error_type=%s", _request_id(request), type(error).__name__)
        return _error_response(
            request,
            503,
            "database_unavailable",
            "Academic data is temporarily unavailable.",
        )

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, error: Exception):
        logger.error(
            "request_failed request_id=%s error_type=%s",
            _request_id(request),
            type(error).__name__,
        )
        return _error_response(
            request, 500, "internal_error", "The request could not be completed."
        )

    return app


def _request_id(request: Request) -> str:
    value = getattr(request.state, "request_id", None)
    return value if isinstance(value, str) else str(uuid.uuid4())


def _error_response(request: Request, status_code: int, code: str, message: str) -> JSONResponse:
    body = ApiErrorEnvelope(
        error={"code": code, "message": message, "request_id": _request_id(request)}
    )
    return JSONResponse(status_code=status_code, content=body.model_dump(mode="json"))


app = create_app()
