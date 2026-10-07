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
| Applicant identity/profile and saved choices | Not implemented | Must remain outside academic releases |
| HTTP API, website, Directus | Not implemented | Future read-only integration work |

The schema stores sourced facts in release-scoped tables with provenance,
evidence and relationship rows. Requirements retain their AND/OR/AT_LEAST
trees. Disciplines are represented as `curriculum_items`; there is no separate
discipline table. Unresolved references remain visible in reconciliation and
review output rather than being guessed or hidden.

## Review and partial sources

The diff matches only exact external keys. It classifies new, changed,
unchanged, conflicting, unreviewed and potentially removed candidates. Sources
are partial by default. An omitted row is not a deletion; even an explicit
complete-dataset scope only reports a potential removal and does not delete
data.

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

`parsers/` contains the installable BMSTU parser and ingestion CLI. Fixture
capture is the default; parser stages consume frozen local captures without
network access. Direct live fetches use official-host allowlists, one-second
spacing, bounded timeouts/body sizes, terminal 403/429 outcomes, and no
browser fallback. HSE sources remain deferred and are not in the active build.

The full broad live catalog/order capture is not the bounded probe and has not
been validated as a safe routine update. See the
[live validation report](LIVE_VALIDATION.md) and
[known issues](KNOWN_ISSUES.md).

See also: [operator workflow](INGESTION_OPERATIONS.md),
[API readiness](API_READINESS.md), [migration report](MIGRATION_REPORT.md).
