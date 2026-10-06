# Architecture

## Active components

```text
local BMSTU source file
  -> andromeda-bmstu parser command
  -> JSON parser result (review required)

reviewed normalized bundle in data/bmstu-2026
  -> academic-data bundle validate / dry-run
  -> academic-data bundle commit
  -> one release transaction and active-release pointer
```

The two paths are deliberately separate. The parser command is an offline
operator tool and does not fetch pages or write database rows. The current
reviewed bundle is the canonical input to the academic database. Building and
reviewing a bundle from fresh captures is a follow-up task.

## Data ownership

| Data | Owner | Canonical write path |
|---|---|---|
| Universities, departments, directions, programs, admission facts, study plans, courses, source evidence | `academic-data` | validate, map, and commit a versioned bundle |
| User identity, exams, achievements, quotas, saved programs | None in this release | Deferred; do not write these facts into academic releases |
| Parser output | `parsers` until reviewed | Local parser result, then a future bundle-building/review step |
| Web/API behavior | None in this release | Future backend work |

`academic-data` uses release-scoped rows and separate source evidence,
observations, and relationships. `data_releases` and `active_data_release`
make snapshot ownership explicit. Requirements preserve their AND/OR/AT_LEAST
tree structure. User-entered facts are outside this release-scoped data path.

## Database and migrations

The active schema is only `academic-data/migrations/versions/`. Its eight
Alembic revisions are kept intact and are not combined with either older
migration history. The importer verifies PostgreSQL 16 and a dedicated target
name before writes. Local tests use `academic_data_test` on localhost through
`infra/compose.yaml`.

The schema contains release and importer metadata, academic catalog and
admission records, study-plan content, classifications, provenance, and
evidence bridges. It has no user-profile tables, public API, or application
authentication.

## Parser package

The active installable package contains the self-contained BMSTU 2026 catalog,
program-card, admission-information, and tuition parsers. Its CLI reads one
local HTML or JSON file and emits JSON. It has no fetch dependency in the active
build. It rejects non-BMSTU provenance URLs and has no HSE registry entry.

HSE sources are held under `parsers/deferred/hse/`, outside the installable
source tree. The older broad adapter layer is not active because it imports
`andromeda.modules.*` and `andromeda.shared.contracts.*` modules that neither
supplied repository contains. No substitute domain contracts were invented.

## Explicitly out of scope

The monorepo does not currently include the legacy API, auth, recommendation,
proftest, event/venue, ontology assertion, or generic user-profile services.
Their source schemas remain in the original repositories; see the migration
report before reviving or mapping any of them.
