# Read-only API and site readiness

Previous: [Live validation](LIVE_VALIDATION.md) · Next: [Known limitations](KNOWN_ISSUES.md)

## What is ready now

The codebase already has a read-side application service
(`AcademicDataQueries`), a repository protocol with a SQLAlchemy implementation,
release-aware pagination, strict `contracts/v1` DTOs, source/evidence
references, and explicit data-gap statuses. These parts can support a
read-only HTTP layer without changing the ingestion model.

Existing query areas include directions, departments, programs, program
courses, study plans, curriculum items, admission campaigns and calendar,
offerings, competition pools, requirement trees, tuition, current/historical
statistics, achievements, admission documents, source evidence, and manual
review metadata. The DTOs carry exact external keys and source provenance;
pages include a release key. Requirement nodes preserve `AND`, `OR`, and
`AT_LEAST`.

Review-decision history is currently preserved in an archived bundle sidecar;
it is not exposed by `AcademicDataQueries` as a relational read model.

## Contracts to expose in a future API

These are proposed read-only route families, not implemented routes:

| Read model | Existing backing query/DTO | Notes |
|---|---|---|
| Directions and programs | `directions`, `programs`, `EducationalProgramRecord` | Filter programs by exact direction key; return department relations and plan keys only when resolved. |
| Departments | `departments`, `DepartmentRecord` | Preserve campus verification and source references. |
| Study plans and disciplines | `study_plans`, `curriculum_items`, `StudyPlanRecord`, `CurriculumItemRecord` | Discipline rows are curriculum items with semester, hours, assessment and source evidence. |
| Exams and requirements | `requirements`, `RequirementTreeRecord` | Expose the nested requirement tree; there is no independent public exam-query contract yet. |
| Tuition | `tuition`, `TuitionRecord` | Preserve amount, currency, validity period and gaps; do not infer a missing academic year. |
| Admission | campaigns, calendar, offerings, pools and statistic queries | Keep campaign year, education level, funding, quota and admission-statistic scopes explicit. Never expose applicant-level order rows. |

Stable v1 routes could follow the query boundaries, for example
`/v1/directions`, `/v1/programs`, `/v1/study-plans`,
`/v1/study-plans/{key}/items`, `/v1/requirements`, `/v1/tuition`,
`/v1/statistics`, and `/v1/campaigns/{key}/offerings`. Final path names,
filter syntax, response size limits, error envelopes, readiness behavior, and
OpenAPI publication remain an API implementation decision.

## Not implemented

There is no FastAPI application, HTTP router, authentication, rate limiting,
deployment, browser client, or user profile service in this repository. The
query/DTO layer is library code, not a running service. Live-source coverage
is partial; see the [2026-10-07 source check](LIVE_VALIDATION.md).

Applicant profiles, preferences, saved programs, submitted scores, documents,
or recommendations must be designed as a separate user-owned domain with its
own authorization and retention rules. They must not be added to immutable
academic releases, source evidence, or public admission records.

## Directus compatibility

The normalized relational data can be presented to Directus in a future step
through read-only views or a restricted database role. Such a role should
resolve records through `active_data_release`, expose only reconciled active
facts plus their provenance/data-gap metadata, and have no write permission
for release, fact, review, or activation tables. Directus must not become a
second writer or mutate an already published release. No Directus schema,
service, or configuration is included now.

Before implementation, verify that the desired filters and response DTOs can
be served by `AcademicDataQueries`, define public-vs-review-only fields, and
test that every endpoint reads one consistent active release. For operational
and data limits, see [known limitations](KNOWN_ISSUES.md).

See also: [architecture](ARCHITECTURE.md),
[ingestion operations](INGESTION_OPERATIONS.md), [known limitations](KNOWN_ISSUES.md).
