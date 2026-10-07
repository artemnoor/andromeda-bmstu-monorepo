# Architecture

Previous: [README](../README.md) · Next: [Migration report](MIGRATION_REPORT.md)

## Active ingestion path

```text
official BMSTU sources or checked-in fixtures
  -> bounded capture and source manifest
  -> offline parser report with hashes and provenance
  -> candidate based on the active release export
  -> exact-key diff and human review
  -> importer-compatible typed bundle
  -> validation and deterministic mapping
  -> guarded PostgreSQL transaction
  -> immutable release plus active-pointer event
```

The read-only consumer contour is separate from that write path:

```text
active immutable release in PostgreSQL
  -> AcademicDataQueries / SQLAlchemy read repository
      -> FastAPI v1 (one read-only REPEATABLE READ snapshot per request)
      -> Directus (SELECT-only active-release projection in directus_read)
```

FastAPI routers do not contain SQL. Directus has no canonical table grants;
its PostgreSQL role can write only its separate `directus_meta` schema.
Neither consumer can publish a release or modify source evidence.

Capture never writes database rows. The explicit `ingest probe` command is
read-only and is separate from the broader `ingest capture --mode live`
path. Candidate staging exports the current release from PostgreSQL; the
checked-in `data/bmstu-2026` snapshot is used only for an explicit first-release
bootstrap when the active slot is empty.

Every committed release keeps a verified importer-bundle archive. Export checks
the archive and source digest before returning the bundle. A candidate records
its base release ID and digest. Publication takes a shared advisory lock and
checks that base against the active pointer inside the transaction. A stale
candidate fails before publication. Release facts are immutable; rollback
changes only the active pointer to a previously verified release and appends
an activation event.

## Data ownership

| Data | Owner | Write path |
|---|---|---|
| BMSTU programs, departments, plans, curriculum items, admissions and evidence | `academic-data` | Validate, map, and commit a reviewed bundle |
| Parser observations and candidates | `parsers` until review | Review-gated candidate bundle |
| Review decisions | Importer bundle and review event log | Explicit reviewer identity, timestamp, source and payload |
| Applicant identity/profile and saved choices | Not implemented | Separate future Applicant/User domain |
| Read-only HTTP API | `services/api/` | `AcademicDataQueries` only; GET endpoints |
| Internal Directus viewer | `infra/compose.yaml`, `directus_read` projection | Read-only active-release projection; metadata isolated |
| Public website/frontend | Not implemented | Consume API v1 in a future stage |

The schema stores sourced facts in release-scoped tables with provenance,
evidence and relationship rows. Requirements retain their AND/OR/AT_LEAST
trees. Disciplines are represented as `curriculum_items`; there is no separate
discipline table. Unresolved references remain visible in reconciliation and
review output rather than being guessed or hidden.

Mapper v4 attaches curriculum-item evidence through an exact parent study-plan
key when the child row has no direct artifact key. It requires an exact
child/parent document-URL match and exactly one successful, hashed BMSTU
study-plan PDF among that plan's declared artifacts. HTML and JSON metadata
artifacts are excluded. The evidence locator identifies the parent plan
document but leaves page/row unavailable where the source bundle has no such
locator. Mapper v3 keeps its prior projection semantics so older immutable
releases still reconcile and remain eligible for verified rollback. The v4
successor materialized 5,267 additional curriculum evidence bridges without
rewriting the v3 releases.

## Review and partial sources

The diff matches only exact external keys. It classifies new, changed,
unchanged, conflicting, unreviewed and potentially removed candidates. Sources
are partial by default. An omitted row is not a deletion; even an explicit
complete-dataset scope only reports a potential removal and does not delete
data.

Curriculum candidates first pass through a plan-scoped identity resolver. It
uses a stored exact source signature or a unique exact label and compatible
PDF context to preserve an existing key. New unambiguous rows receive a
deterministic identity key; row order and printed row number remain provenance
locators. Similar labels and repeated rows without a unique source match stay
ambiguous for individual review. See
[curriculum identity](CURRICULUM_IDENTITY.md) for the source signals, legacy
key handling, and remaining limits.

Bulk review is limited to allowlisted low-risk fields with exact targets and
verified provenance. New, ambiguous, conflicting, critical, rejected, or
unprovenanced candidates remain for individual review. Similar names never
create a link. Rejected payloads can be reopened for another review, with
earlier decisions preserved in the append-only journal inside the archived
bundle. The journal is not a standalone SQL event table.

## Database and package boundaries

`academic-data/` owns the SQLAlchemy schema, preserved Alembic history,
PostgreSQL 16 importer, immutable releases, and existing read-query/DTO
contracts. Tests may reset only the isolated localhost
`academic_data_test` database. No production connection or deployment is part
of this repository workflow.

`services/api/` is the HTTP composition layer. Its dependency opens one
read-only repeatable-read transaction and constructs one query service and
repository for the request. The API runtime login has SELECT grants on the
curated query table allowlist only; transaction read-only mode is a second
guard. The query/domain packages remain independent of FastAPI.

The Alembic read-boundary migration creates `andromeda_api_runtime` and
`andromeda_directus_runtime` logins with no password. It grants API read access
through `andromeda_api_readonly`; the Directus login can read only tables in
`directus_read`. Those tables are refreshed from safe `academic_read` views by
a security-definer trigger in the same transaction as active-pointer changes.
The refresh keeps only the selected release and exposes the same allowlisted
columns. Directus system tables use `directus_meta`. Password provisioning
and Directus startup are deployment/local-environment steps, not committed
secrets. The full projection refresh adds publish/rollback locking and WAL; it
is intended for this bounded POC corpus and needs a scale benchmark before
larger datasets.

The Directus presentation is separately versioned in
`infra/directus/metadata/collections.json` and `relations.json`. The applier
preflights allowlisted projected collections and fields through the Directus
API, then applies collection, field, and preset metadata through that API.
Directus 12.4.1's `POST /relations` attempts physical foreign-key DDL even for
`schema: null`; the applier instead uses an operator database connection to
upsert virtual relation rows and explicit reverse O2M field aliases only in
`directus_meta`. It performs no DDL and writes no academic items or schema.
Keep `ACADEMIC_DATA_DATABASE_URL` pointed at the isolated PostgreSQL 16 test
database when applying local metadata. Restart Directus after the metadata
upsert so it reloads the relationship schema.

Core mode registers the 25 visible read collections and their six visible
navigation folders; the 32 technical tables remain in `directus_read` but are
not registered as Directus collections. Licensed mode can register the full
grouped catalog when a valid Directus license is supplied. The virtual
relations declare how Directus traverses existing UUID links without adding
PostgreSQL foreign keys. An authenticated API smoke on PostgreSQL 16 / Directus
12.4.1 verified the six folders, key catalog/admission/evidence paths, filter
query, and active-release switch; it was not a manual browser review. See
[Directus UX](DIRECTUS_UX.md) for exact coverage and limits.

The manifests cover presentation metadata only, not Directus users,
role/policies, project language, dashboards, or arbitrary settings.
PostgreSQL privileges remain the authority even for a Directus administrator;
hidden or unregistered technical collections are a navigation/catalog-tier
choice, not a database access boundary.

`parsers/` contains the installable BMSTU parser and ingestion CLI. Fixture
capture is the default; parser stages consume frozen local captures without
network access. Direct live fetches use official-host allowlists, one-second
spacing, bounded timeouts/body sizes, terminal 403/429 outcomes, and no
browser fallback. HSE sources remain deferred and are not in the active build.

The full broad live catalog/order capture is not the bounded probe and has not
been validated as a safe routine update. See the
[live validation report](LIVE_VALIDATION.md) and
[known issues](KNOWN_ISSUES.md).

## See also

- [Operator workflow](INGESTION_OPERATIONS.md)
- [API contract and readiness](API.md) · [API readiness](API_READINESS.md)
- [Directus viewer and UX](DIRECTUS.md) · [Directus UX](DIRECTUS_UX.md)
- [Domain/write-boundary ADR](adr/ADR-0001-api-write-boundary-and-user-domain.md)
- [Migration report](MIGRATION_REPORT.md)
