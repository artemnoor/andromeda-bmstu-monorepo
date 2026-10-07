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
- The live catalog API returned one sampled record and reported 53 total. The
  HTML parser found no program links in the sampled HTML response.
- The live curriculum PDF parser returned 113 rows across 12 semesters, but
  those rows had no importer exact external keys. They cannot safely be
  compared or promoted until key generation is confirmed.
- The live tuition parser returned 154 rows with `year-unspecified` external
  keys. None matched the release's exact keys. This is a key/year identity gap,
  not evidence that the stored amounts changed.
- The bounded sample found no exam-requirements PDF link and no safe aggregate
  places/quota table. Order-index metadata was parsed, but individual result
  documents were not downloaded.
- The probe compared against an isolated PostgreSQL 16 test release seeded
  from the checked-in bundle. No production database was queried. The broader
  live capture command remains unsuitable for unattended/mass refresh until
  separately constrained and validated.
- Fixture data is a regression corpus, not comprehensive coverage of all
  BMSTU programs, current admissions rules, tuition years, or live PDF variants.
  Passing-score statistics are not complete campaign-wide data.
- Applicant-level records, personal data, user profiles, and preferences are
  excluded. HSE remains deferred.
- There is no FastAPI application, frontend, Directus configuration, or
  applicant-profile model. Existing read-side queries and DTOs are library
  contracts only; see [API readiness](API_READINESS.md).

## Verification record

Verified locally on Python 3.11 and the isolated localhost PostgreSQL 16
`academic_data_test` database:

- Locked non-editable workspace installation completed with `uv sync
  --locked --reinstall --all-packages --group dev --no-editable`.
- `uv run pytest -q`: **30 passed in 719.00 seconds**. This included the
  five-operation sequential lifecycle, same-base concurrent publishers,
  stale-base rejection, explicit rollback, failed activation recovery,
  exact-key moderation, partial-source behavior, parser failure/provenance,
  and bundle round-trip cases.
- The five sequential operations verified a changed fact, an added exact-key
  statistic, unchanged `no_op`, two contradictory exact-key source candidates
  blocked and individually rejected before publication, and repeated import
  `no_op`. Earlier accepted values, counts, evidence, provenance, and links
  were checked after each step.
- PostgreSQL reports major version **16**, schema revision
  `e91532f013ac`; `academic-data db check` and Alembic `command.check` passed.
- The checked-in bundle validated as **21,911 records, zero errors, one
  existing warning**, digest
  `42616ee9348ee009fa1b297f7ef697862134835e562c7840f413643ce71d2130`.
  Import dry-run returned `dry_run` with zero network requests.
- Fixture hash tests preserve LF `content_sha256`/capture digest and all six
  original upstream `source_sha256` values. `git check-attr` reports LF for
  HTML/JSON fixtures and disables text conversion for PDFs.
- GitHub Actions run [37551684272](https://github.com/artemnoor/andromeda-bmstu-monorepo/actions/runs/37551684272)
  passed every CI step on published commit
  `93ca411490cb60808f6294affdd8b344f170c791`, including the full PostgreSQL 16
  test suite in 10m33s.

## Operational rule

Treat unavailable, conflicting, unknown, or partial values as gaps and keep
them visible for review. Do not publish live findings from the bounded probe
without the normal candidate validation, exact-key review, and explicit
commit. For the repeatable process see
[ingestion operations](INGESTION_OPERATIONS.md).

See also: [architecture](ARCHITECTURE.md),
[live validation](LIVE_VALIDATION.md), [API readiness](API_READINESS.md).
