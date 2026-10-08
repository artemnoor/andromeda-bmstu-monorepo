# Migration report

Previous: [Architecture](../architecture/ARCHITECTURE.md) · Next: [Ingestion operations](../operations/INGESTION_OPERATIONS.md)

## Sources audited

The source repositories were cloned read-only outside this workspace for the
audit. Audited revisions:

| Repository | Commit | Relevant contents |
|---|---|---|
| `artemnoor/andromeda-data` | `8093390f9f8c3b9ec223d033a49fbbfbac9ab7` | Schema v1 ORM, three Alembic revisions, migration/schema PostgreSQL tests |
| `artemnoor/andromeda-parsers` | `f08819f5534b3dfa4d46934e10091e7b899a183b` | academic-data package and migrations, parser source tree, safe BMSTU-2026 bundle, embedded legacy-andromeda snapshot |

Original repositories were not changed.

## What moved

- `database/academic-data` moved to `academic-data/` without rewriting its ORM
  models or Alembic history. It is the only active database schema because it
  has release metadata, source evidence, a validator, deterministic mapping,
  transactional persistence, and an atomic active-release pointer.
- The safe `data/bmstu-2026` normalized bundle moved to `data/bmstu-2026/`.
  It contains no raw PDF/XLS/XLSX files or applicant-level rows.
- The BMSTU source adapter, parser/normalizer dependency closure, and bounded
  source-capture policies were selectively restored from the audited legacy
  monolith. The `andromeda-bmstu` CLI exposes fixture/live capture, offline
  parsing, candidate staging, review, validation, dry-run, and guarded commit.
  Five standalone local-input parsers remain available: catalog HTML, catalog
  API JSON, program cards, admission information, and tuition.
- Public BMSTU HTML/JSON and curriculum PDF fixtures were copied into the test
  tree with a source manifest and hashes. They are test inputs, not part of the
  normalized database bundle. Live raw bodies are excluded from Git.
- HSE adapter source is kept separately in `parsers/deferred/hse/`; it is
  excluded from package discovery and execution.
- A root `uv` workspace and lockfile cover the database package, active parser
  package, and test tooling.

## Schema comparison

The three inspected ORM schema implementations have different table identities
and migration histories:

| Schema | ORM tables | Alembic revisions | Main scope |
|---|---:|---:|---|
| `andromeda-data` schema v1 | 48 | 3 | Academic admissions, curricula, user profiles, policy rules, ontology assertions |
| `academic-data` | 45 | 8 | Release-scoped academic facts, source evidence, classifications, admission importer |
| `legacy-andromeda` | 34 | 22 | Older monolith: user accounts, decision/proftest records, events/venues, academic catalog and admissions |

The first two schemas share no exact table names. `academic-data` and
`legacy-andromeda` share four names (`universities`, `directions`,
`educational_programs`, `curriculum_items`), but their use, keys, and lifecycle
are not automatically compatible. No migrations were concatenated and no
automatic table-to-table data conversion was attempted.

| Capability | `andromeda-data` v1 | `academic-data` | Decision |
|---|---|---|---|
| Catalog and admission facts | Singular tables such as `university`, `program`, `program_offering`, `competition_pool` | Release-scoped plural tables such as `universities`, `directions`, `program_offerings`, `competition_pools` | Use `academic-data`; the bundle mapping and release lifecycle are implemented and exercised |
| Curriculum | `course`, `subject_area`, `curriculum`, `curriculum_item` | `catalog_courses`, `subject_taxonomies`, `study_plans`, `curriculum_items` | Keep the release-scoped model; do not load both representations |
| Provenance | `source`, `source_artifact`, generic `fact_assertion`/`link_assertion` plus ontology tables | `source_artifacts`, `source_evidence`, `source_observations`, typed evidence bridges and relationships | Keep `academic-data` evidence ownership and source mapping |
| Requirements and policies | `requirement_set/node`, `policy_rule/version`, scopes and `rule_set` | `admission_requirement_sets/nodes`, `rule_packs/versions/scopes`, offering links | Keep both current requirement trees and rule packs in the active schema; defer cross-schema policy mapping |
| User profiles and entered facts | `user_profile`, external identities, user exams, olympiads, achievements, quotas, shortlist | No user-profile tables; includes source-derived individual-achievement policies | Defer the v1 user tables as a separate future user-data domain; no user data is silently migrated |
| Olympiad catalog/benefits | Dedicated olympiad and benefit tables | No olympiad rows in the safe bundle; current schema has admission achievement policies | Defer until source coverage and mapping are specified |
| Legacy monolith capabilities | Not represented as a separate architecture | Not represented as API/application services | Defer auth, recommendations, proftest, decision analytics, events, and venues |

## Exclusions and functional gaps

- `andromeda-data` was not copied as a second schema. Its profiles, shortlist,
  olympiad benefits, and generic ontology assertions may be useful later, but
  the current import/product scope has no user-data service or explicit mapping
  for them. Their code and migrations remain untouched in the source repository.
- `legacy-andromeda` ORM and Alembic history were not copied. It contains useful
  decision, proftest, event, venue, auth, and user-profile functionality, but
  those are not prerequisites for importing BMSTU academic data.
- HSE normalizers remain deferred. BMSTU's required shared contracts were
  selectively copied from the separately audited legacy monolith; no legacy
  ORM, API, user-profile service, or optional visualization tool was restored.
- Live source acquisition is opt-in and bounded. It has not been exercised
  against live sites; checked-in fixtures make the capture/parse path offline
  and reproducible.
- Candidate review materializes explicitly accepted facts into existing typed
  datasets only after a reviewer supplies exact destination keys. Typed
  updates are sparse, conflicting values fail closed, and absent rows do not
  delete facts from the full base bundle.
- No frontend, Directus configuration, API, production deployment, applicant
  personal data, closed source documents, live raw captures, or alternate
  database is included. Public, contact-free curriculum PDFs remain the only
  document binaries; HTML/JSON source fixtures are sanitized regression inputs.

## Tests and remaining mapping work

The academic-data repository had no committed unit or integration tests for its
bundle importer. The selected workspace adds offline validation/dry-run
coverage, BMSTU ingestion fixtures, and PostgreSQL checks for a full commit,
idempotence, rollback, release activation, and representative entity counts.
The initial monorepo verification reported **15 passed** on Python 3.11 and
PostgreSQL 16. After the ingestion follow-up, the full suite reports **17
passed in 223.22 seconds** from rebuilt non-editable workspace packages with
the dedicated PostgreSQL 16 test database configured. It covers fixture
hash/parser errors, explicit typed review,
conflict/partial preservation, baseline and changed releases, idempotency,
source evidence, rollback, and active-release switching. The checked-in bundle
also validates and dry-runs; `academic-data db upgrade`, `db check`, and
Alembic's autogenerate check succeeded at revision `de41afbb52c8`.

The separate `andromeda-data` source schema suite completed with **13 passed**
against its own disposable PostgreSQL 16 database and one pytest configuration
warning. Those tests validate the unselected schema only. The detailed bundle
counts, exact unresolved mappings, parser-fixture limitation, and release ID
are in [`KNOWN_ISSUES.md`](../operations/KNOWN_ISSUES.md).

## Follow-up: completed fixture-to-release path

The previously observation-only candidate flow now creates typed rows for
supported institutions, departments, programs, study plans, curriculum items,
exams, requirements, offerings, competition pools, tuition assertions, and
admission statistics. It preserves the canonical observation and adds source
artifact/evidence provenance. Unknown fields and unaccepted candidates leave
the checked-in base records intact. The updated fixture set contains seven
snapshots; its stable capture digest and the six unchanged original source
hashes are documented in [`INGESTION_AUDIT.md`](../operations/INGESTION_AUDIT.md).

The PostgreSQL 16 test runs a real local fixture through capture, parse,
candidate stage, explicit exact-key review, bundle validation/mapping, and
release commit. It verifies changed historical-statistic values and linked
evidence, a repeated-import no-op, failed-activation rollback, and a subsequent
release activation. Other supported typed categories and the no-op database
projection are validated in the reviewed bundle/dry-run and baseline import.
No live parse was run. The remaining limits are the small fixture corpus,
unverified live markup, incomplete current campaign coverage, and
source-dependent price/campaign identity; see
[`KNOWN_ISSUES.md`](../operations/KNOWN_ISSUES.md) for the operator workflow and limits.

The documented CLI commands were also run with the checked-in fixture folder
through `capture`, `parse`, `stage`, one exact-key typed acceptance, `validate`,
`dry-run`, and `commit` against the disposable local database.

See also: [architecture](../architecture/ARCHITECTURE.md),
[current ingestion operations](../operations/INGESTION_OPERATIONS.md),
[known limitations](../operations/KNOWN_ISSUES.md).
