# Read-only API and site readiness

Previous: [Live validation](LIVE_VALIDATION.md) · Next: [Known limitations](KNOWN_ISSUES.md)

## Implemented read contour

The repository now includes a synchronous FastAPI v1 application under
`services/api/`. Its routers call `AcademicDataQueries`; SQLAlchemy repository
access remains in `academic-data/`. A request uses one read-only PostgreSQL
`REPEATABLE READ` transaction, so the active pointer and all facts observed in
that response come from one release snapshot. Pagination is deterministic by
external key and carries the release key on every page.

The OpenAPI document is served at `/openapi.json`; Swagger UI is at `/docs`.
The public v1 surface is GET-only. No proposal, approval, publication,
applicant profile, or applicant-level result endpoint exists.

Application DTOs retain exact external keys, provenance references, evidence,
manual-review data gaps, nullable unknown values, and structured
AND/OR/AT_LEAST requirement trees. The API does not expose the raw payload of
unmodeled source observations. `/data-gaps` currently lists open manual-review
records; pending observations that have no canonical record remain visible to
the internal Directus view by metadata only.

## Read model coverage

| Read model | Query/DTO boundary | API route family |
|---|---|---|
| Directions | `directions`, `DirectionRecord` | `/api/v1/directions` |
| Departments | `departments`, `DepartmentRecord` | `/api/v1/departments` |
| Programs | `programs`, `EducationalProgramRecord` | `/api/v1/programs` |
| Plans and curriculum | `study_plans`, `curriculum_items` | `/api/v1/study-plans`, `/api/v1/programs/{key}/study-plans` |
| Campaigns and calendar | campaigns, calendar events, offerings | `/api/v1/campaigns` |
| Requirements and exams | requirement trees, `admission_exams` | `/api/v1/requirements`, `/api/v1/exams` |
| Places and quotas | competition pools and quota assertions | `/api/v1/place-quotas` |
| Tuition | `tuition`, `TuitionRecord` | `/api/v1/tuition` |
| Statistics | current and historical statistics | `/api/v1/statistics` |
| Review gaps | open manual-review records | `/api/v1/data-gaps` |

Responses from sourced canonical record queries carry release-scoped source
references and evidence where the database has those links. Unknown values stay
`null` or unresolved; live tuition rows without explicit academic year were
not imported as canonical tuition.

## Runtime boundaries

The `andromeda_api_runtime` login is a member of `andromeda_api_readonly`. Its
SELECT rights are limited to tables used by the read queries; it has no DML or
public-schema CREATE rights. The API connection also starts each request in a
read-only transaction. It uses the existing academic PostgreSQL database.

The Directus POC reads `directus_read` tables, a transactionally refreshed
projection from the active-release views, with the `andromeda_directus_runtime`
login. It cannot read base canonical tables or the source views. Directus may
create and update its own metadata under `directus_meta`; that schema is
separate from academic facts. See [Directus setup](DIRECTUS.md).

## Still outside the API

- Ingestion, review, validation, commit, and rollback remain CLI/application
  workflows. A future HTTP proposal/write path needs its own identity,
  authorization, idempotency, audit, and publication design.
- User profiles, exam scores, olympiad results, preferences, saved programs,
  and recommendations belong to a separate Applicant/User domain.
- API authentication, rate limiting, external deployment, and frontend
  integration are not included in this POC.
- `/data-gaps` covers open manual-review records, not every source observation.
- Live checks are bounded samples, not evidence of complete BMSTU parser
  coverage; see [LIVE_VALIDATION.md](LIVE_VALIDATION.md).

See also: [API contract](API.md), [architecture](ARCHITECTURE.md),
[known limitations](KNOWN_ISSUES.md).
