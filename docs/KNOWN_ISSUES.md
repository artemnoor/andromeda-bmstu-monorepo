# Current status and known limitations

Previous: [API readiness](API_READINESS.md) · Next: [Ingestion audit](INGESTION_AUDIT.md)

## Verified behavior

- Normal candidates derive from the verified archive of the active release;
  the original checked-in bundle is used only for explicit first-release
  bootstrap. The expected base release ID/digest is checked again before
  publication. Stale and concurrent publishers fail closed.
- Bundle export round-trips normalized datasets, provenance, evidence,
  relations, and review metadata. Releases remain immutable. Rollback changes
  only the active pointer to a verified earlier release and records an event.
- Parser candidates can materialize into existing typed importer datasets.
  Exact-key review controls which data is applied; conflicts fail closed,
  unknown/absent fields do not erase known values, and partial captures do not
  delete records.
- Diff and review templates report new, changed, unchanged, conflicting,
  unreviewed, and potentially removed candidates. Bulk review is limited to
  allowlisted noncritical fields with exact targets and verified provenance.
  Decisions include actor, timestamp, payload, and source provenance;
  rejected candidates can be re-reviewed without losing their prior decision.
  The append-only decision journal is stored in the verified bundle archive,
  not a queryable SQL event table.
- The selected-source live probe completed under its 12-exchange cap. Its
  output was not imported. See [live findings](LIVE_VALIDATION.md).

## Remaining data and source gaps

- The compressed bundle archive is retained in PostgreSQL for each release.
  There is no size quota, pruning command, or retention policy; database growth
  and backups need operator monitoring.
- The baseline bundle validates with zero errors, but reconciliation records
  55 unresolved exact links (6 admission-statistic and 49 competition-pool
  direction references). The validator also reports 22 manual-review keys
  that are not canonical records and existing unverified campus scopes.
  These are visible source/model gaps; this work did not invent links.
- The official catalog API is primary for the current parser: one sampled row
  parsed and the API reported 53 total. The HTML page returned no recognized
  links and remains a deferred fallback. This sample was not paginated.
- The sampled live curriculum PDF yielded 113 rows across 12 semesters. The
  saved bounded report records 113/113 matches using the previous positional
  keys. The new resolver was replayed against the checked-in 113-row release
  slice and preserved every key with no ambiguous rows; the raw live PDF was
  not available locally for a fresh live reparse. See
  [curriculum identity](CURRICULUM_IDENTITY.md) for the scope of that evidence.
- BMSTU's currently parsed curriculum PDFs expose no official discipline code
  or stable row identifier. Exact labels and available chair/block context
  preserve unique rows across reorder and mutable fact changes. A renamed row,
  indistinguishable repeated title, or repeated title whose semester changes
  remains an individual review gap. Similarity never selects a canonical key.
- The sampled tuition page exposed 154 rows but no academic year in each
  owning section. They remain pending and no canonical tuition row was
  produced. The parser does not infer a year or emit `year-unspecified` keys.
- The bounded sample found no requirements PDF link and no safe aggregate
  places/quota table. The order manifest contained 24 enabled document
  records, but no document bodies were fetched.
- The probe compared against an isolated PostgreSQL 16 test release seeded
  from the checked-in bundle. No production database was queried. The broader
  live capture command remains unsuitable for unattended/mass refresh until
  separately constrained and validated.
- Fixture data is a regression corpus, not comprehensive coverage of all
  BMSTU programs, current admissions rules, tuition years, or live PDF variants.
  Passing-score statistics are not complete campaign-wide data.
- Applicant-level records, personal data, user profiles, and preferences are
  excluded. HSE remains deferred.
- The read-only FastAPI v1 and Directus viewer are implemented, but API
  authentication, rate limiting, public deployment, and frontend integration
  remain out of scope. `/data-gaps` currently lists open manual-review records;
  pending observations without canonical entities are not returned by that
  endpoint.
- The Directus POC reads `directus_read` tables, atomically refreshed from
  allowlisted active-release SQL views because Directus 12.4.1's PostgreSQL
  inspector excludes views. It enforces SELECT-only access but does not yet
  provide curated relation metadata or role/policy export files. The full
  projection refresh adds lock time and WAL per publish/rollback and has not
  been benchmarked beyond the checked-in POC corpus. Its default admin can
  administer Directus metadata while PostgreSQL still blocks academic writes.
- Applicant profiles, preferences, EGE/olympiad results, shortlists, and
  recommendations remain a separate unimplemented domain. HSE remains deferred.

## Core pipeline verification baseline

The following database and release-lifecycle results were recorded before the
curriculum-identity follow-up. They remain baseline evidence for the unchanged
importer and release core.

Verified locally on Python 3.11 and the isolated localhost PostgreSQL 16
`academic_data_test` database:

- Locked non-editable workspace installation completed with `uv sync
  --locked --all-packages --group dev --no-editable`.
- `uv run pytest -q`: **39 passed, 1 deprecation warning, in 844.17 seconds**.
  This includes the existing five-operation sequential lifecycle, same-base
  concurrent publishers, stale-base rejection, explicit rollback, failed
  activation recovery, exact-key moderation, partial-source behavior, parser
  failure/provenance, and bundle round-trip cases, plus API and Directus
  integration tests. The new API/Directus test proves one-release repeatable
  reads, AND/OR/AT_LEAST output, runtime permissions, and projection refresh
  after rollback.
- The five sequential operations verified a changed fact, an added exact-key
  statistic, unchanged `no_op`, two contradictory exact-key source candidates
  blocked and individually rejected before publication, and repeated import
  `no_op`. Earlier accepted values, counts, evidence, provenance, and links
  were checked after each step.
- PostgreSQL reports major version **16**, schema revision
  `f4b19a7c2d61`; `academic-data db check` and Alembic `command.check` passed.
- The checked-in bundle validated as **21,911 records, zero errors, one
  existing warning**, digest
  `42616ee9348ee009fa1b297f7ef697862134835e562c7840f413643ce71d2130`.
  Import dry-run returned `dry_run` with zero network requests.
- `docker compose --profile directus config --quiet` passed. The pinned
  Directus 12.4.1 smoke authenticated, discovered 12 key academic collections,
  and read one direction item; the container was stopped and the temporary DB
  password cleared afterward.
- Fixture hash tests preserve LF `content_sha256`/capture digest and all six
  original upstream `source_sha256` values. `git check-attr` reports LF for
  HTML/JSON fixtures and disables text conversion for PDFs.
- GitHub Actions run **37588909953** passed on implementation commit
  `4a58f1fa93eda6d51a492d219d14c3e48bd0bb1c`: **39 passed, 1 warning in
  652.44 seconds**. The PostgreSQL 16-backed `uv run pytest -q` workflow runs
  on pushed branches; check the current commit's GitHub checks after any later
  documentation-only update. The pre-change `main` baseline was green.

## Curriculum identity follow-up verification

Verified on 2026-10-07 after the identity changes:

- `uv run pytest -q`: **45 passed, 5 skipped, 1 warning in 123.81 seconds**.
  The five skips are `tests/test_postgres_import.py`; their guard requires a
  local PostgreSQL 16 URL for the dedicated `academic_data_test` database.
  This machine has PostgreSQL 17 only, so it was not used for destructive
  importer tests. The repository CI job provisions PostgreSQL 16 and runs the
  same suite; its result is recorded after the final push.
- Focused identity tests cover a five-step history (insert, reorder, mutable
  fact change, potential removal, repeated import), duplicate titles, ambiguous
  semester changes, rename review, partial source, importer provenance, both
  PDF fixtures, and the offline 113-row release slice.
- `curriculum.pdf` and `curriculum_2.pdf` parsed as 89 and 123 rows. The offline
  `01.03.02-01` release slice matched all 113 existing keys with zero new or
  ambiguous rows. This does not replace a new live parse; the saved live report
  has no raw PDF body to replay.
- No fixture file, checked-in release bundle, immutable PostgreSQL release, or
  Alembic migration was changed by the identity implementation.

## Operational rule

Treat unavailable, conflicting, unknown, or partial values as gaps and keep
them visible for review. Do not publish live findings from the bounded probe
without the normal candidate validation, exact-key review, and explicit
commit. For the repeatable process see
[ingestion operations](INGESTION_OPERATIONS.md).

See also: [architecture](ARCHITECTURE.md),
[live validation](LIVE_VALIDATION.md), [API readiness](API_READINESS.md).
