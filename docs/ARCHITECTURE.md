# Architecture

## Active components

```text
official BMSTU source URLs OR checked-in/local fixtures
  -> fixture-first capture / explicit bounded direct-HTTP capture
  -> local raw bodies + source manifest and hashes
  -> BMSTU adapter and canonical normalizer
  -> sanitized parse report (no network access)
  -> review-only candidate bundle based on data/bmstu-2026
  -> explicit accept_observation/reject decisions
  -> existing academic-data validator and dry-run mapper
  -> guarded atomic release importer

checked-in reviewed bundle in data/bmstu-2026 ───────────────┘
```

Capture and parsing do not write database rows. Fixture mode is the default;
live mode is explicit and uses direct HTTP only. Raw bodies remain in ignored
local capture directories. Public parse reports and candidates carry source
hashes and provenance, not source bodies. An unreviewed candidate cannot pass
import mapping. An accepted candidate is preserved as a source observation;
this first integration does not infer new typed facts from parser output.
Activation still goes through the existing importer and its single release
transaction and active-release pointer.

## Data ownership

| Data | Owner | Canonical write path |
|---|---|---|
| Universities, departments, directions, programs, admission facts, study plans, courses, source evidence | `academic-data` | validate, map, and commit a versioned bundle |
| User identity, exams, achievements, quotas, saved programs | None in this release | Deferred; do not write these facts into academic releases |
| Parser output | `parsers` until reviewed | Candidate bundle; explicit review materializes accepted rows as source observations |
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

The active installable package contains the selectively restored BMSTU 2026
source adapter, parsers, normalizers, and an explicit capture/parse/review CLI.
Fixture mode reads checked local HTML, JSON, and public curriculum PDF captures.
Live mode is opt-in, direct HTTP only, and constrained by source allowlists,
rate spacing, retries, timeouts, and body limits. The standalone parser command
still reads one local HTML or JSON file. The active package rejects unapproved
provenance URLs and has no HSE registry entry.

HSE sources are held under `parsers/deferred/hse/`, outside the installable
source tree. BMSTU shared runtime contracts were selectively restored from the
audited legacy monolith. The legacy ORM, API, user services, and optional plan
visualizer are not part of the active package. No replacement domain contracts
were invented; small evidence/source contract imports required by the adapter
remain limited to source contracts.

## Explicitly out of scope

The monorepo does not currently include the legacy API, auth, recommendation,
proftest, event/venue, ontology assertion, or generic user-profile services.
Their source schemas remain in the original repositories; see the migration
report before reviving or mapping any of them.
