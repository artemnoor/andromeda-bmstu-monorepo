# Read-only API v1

Previous: [API readiness](API_READINESS.md) · Next: [Directus viewer](DIRECTUS.md)

## Runtime

The FastAPI composition root is `services/api/src/andromeda_api/main.py`.
Routers call `AcademicDataQueries`; they do not build SQL. Domain and query
packages have no FastAPI dependency.

Configure `ACADEMIC_DATA_DATABASE_URL` with the `andromeda_api_runtime` login.
For a local-only run against the isolated PostgreSQL test database, set:

```powershell
$env:ACADEMIC_DATA_ENV = "test"
$env:ACADEMIC_DATA_DATABASE_URL = "postgresql+psycopg://andromeda_api_runtime:<url-encoded-password>@localhost:55433/academic_data_test"
uv run --package andromeda-api uvicorn andromeda_api.main:app --host 127.0.0.1 --port 8000
```

The role has no password until the operator provisions one. Use `\password
andromeda_api_runtime` in a trusted `psql` session; do not store credentials in
the repository. The `test` environment validator only permits localhost
`academic_data_test`. A persistent development environment must use its own
`_dev` database.

The application publishes `/openapi.json` and `/docs`. `GET /api/v1/health`
also resolves the active release, so it reports `503` if the database or a
reconciled active release is unavailable.

## Endpoints

Every collection endpoint uses `limit` (default 50, range 1–100) and an
optional URL-safe Base64 `cursor`. Pages are ordered by exact external key;
the page object includes `next_cursor`, `total_count`, and `release_key`.
Filters accept exact keys/codes from the query DTOs.

| Method | Path | Filters / result |
|---|---|---|
| GET | `/api/v1/health` | Database and active-release readiness |
| GET | `/api/v1/release` | Active release identity, digest, mapper, status and schema revision |
| GET | `/api/v1/directions` | Paginated directions |
| GET | `/api/v1/directions/{key}` | One exact direction key |
| GET | `/api/v1/departments` | Paginated departments |
| GET | `/api/v1/departments/{key}` | One exact department key |
| GET | `/api/v1/programs` | Optional `direction_key` |
| GET | `/api/v1/programs/{key}` | One exact program key |
| GET | `/api/v1/programs/{key}/study-plans` | Plans for an exact program key |
| GET | `/api/v1/study-plans` | Optional `program_key` |
| GET | `/api/v1/study-plans/{key}` | One exact plan key |
| GET | `/api/v1/study-plans/{key}/items` | Optional `semester` |
| GET | `/api/v1/campaigns` | Optional `year`, `education_level` |
| GET | `/api/v1/campaigns/{key}` | One exact campaign key |
| GET | `/api/v1/campaigns/{key}/offerings` | Offerings for an exact campaign |
| GET | `/api/v1/campaigns/{key}/calendar` | Calendar events for an exact campaign |
| GET | `/api/v1/requirements` | Optional `campaign_key`; preserves nested AND/OR/AT_LEAST operators |
| GET | `/api/v1/requirements/{key}` | One exact requirement-set key and full tree |
| GET | `/api/v1/exams` | Paginated canonical entrance exams |
| GET | `/api/v1/exams/{key}` | One exact exam key |
| GET | `/api/v1/place-quotas` | Optional exact `campaign_key` |
| GET | `/api/v1/tuition` | Optional `direction_code`; canonical year-bearing records only |
| GET | `/api/v1/statistics` | `kind=historical\|admission`, optional `year`, `direction_code` |
| GET | `/api/v1/data-gaps` | Paginated open manual-review records |

Keys containing `/` must be percent-encoded by clients. Values and links are
resolved in the application layer; a missing exact entity returns `404`.
Applicant-level data is not exposed.

## Active-release consistency

Each request opens one SQLAlchemy connection in a PostgreSQL `REPEATABLE READ`
transaction and sets it read-only. `SQLAlchemyAcademicDataReadRepository`
resolves and caches the active release in that snapshot; all query methods and
their provenance lookups use the same release ID. A concurrent activation
therefore affects the next request, never half of the current response.

## Error envelope

Errors have a stable shape and `X-Request-ID` response header:

```json
{
  "error": {
    "code": "record_not_found",
    "message": "The requested record was not found.",
    "request_id": "...",
    "field_issues": []
  }
}
```

Validation errors use `request_validation_failed` and include `field_issues`;
invalid cursors use `invalid_cursor`; expected missing records use `404` and
`record_not_found`; unavailable database or active release uses `503`.
Internal SQL details are not returned to clients.

## Write boundary

There are no HTTP write routes. Continue to use the explicit
`capture → parse → diff → review → validate → commit` workflow. Future
proposal/approval/publication routes are described in
[ADR-0001](adr/ADR-0001-api-write-boundary-and-user-domain.md) and require a
separate authorization, idempotency and audit design.
