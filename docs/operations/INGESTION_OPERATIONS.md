# Ingestion operations

Previous: [Migration report](../architecture/MIGRATION_REPORT.md) · Next: [Live validation](LIVE_VALIDATION.md)

## Safety model

Normal candidates start from an export of the current active release. Staging
records its exact release ID and bundle digest. Before publication, PostgreSQL
checks both values again under the publication lock. If another release became
active in the meantime, the candidate is rejected and must be restaged and
reviewed against the new base.

The importer never overwrites a committed release. Sparse reviewed values keep
fields that are absent or unknown, and an incomplete source cannot remove
records. The CLI examples below assume the dedicated local PostgreSQL 16 test
database from the [local development guide](LOCAL_DEVELOPMENT.md#local-postgresql-16).

## Capture and parse

```powershell
uv run --package andromeda-ingestion andromeda-bmstu ingest capture `
  --mode fixture --fixture-dir tests/fixtures/bmstu/ingestion `
  --output artifacts/bmstu-ingestion/capture
uv run --package andromeda-ingestion andromeda-bmstu ingest parse `
  --input artifacts/bmstu-ingestion/capture `
  --output artifacts/bmstu-ingestion/parsed.json
```

The fixture flow makes no network requests. The separate live probe is bounded
and read-only; the broader live capture can enumerate many catalog and order
documents and must not be used as a routine production crawler.

### User-provided aggregate admission PDF

Appendix 8.1 supplied by the user is parsed offline, without fetching a URL or
copying the original local path into the report:

```powershell
uv run --package andromeda-ingestion andromeda-bmstu ingest parse-admission-plan `
  --input "C:\path\to\БС.pdf" `
  --output artifacts/bmstu-ingestion/admission-plan.json `
  --captured-at 2026-10-03T12:50:55.107065+00:00
```

`--captured-at` preserves the source artifact's original capture time; omit it
when that time is not established. The report stores the PDF SHA-256, byte size,
page/table/row locators and aggregate source rows. It stores neither the local
path nor the PDF bytes. A repeat of an already accepted identical snapshot
produces no pending candidates; after an empty diff, stop without review or
commit.

## Stage from the current release

With `ACADEMIC_DATA_ENV=test` and `ACADEMIC_DATA_DATABASE_URL` set to the local
test service:

```powershell
uv run --package andromeda-ingestion andromeda-bmstu ingest stage `
  --parse-report artifacts/bmstu-ingestion/parsed.json `
  --output artifacts/bmstu-ingestion/candidate
```

`stage` reads the active release, verifies and exports its archived bundle,
then builds a candidate with that release ID and digest. It does not use
`data/bmstu-2026` as a fallback. For the first release only, explicitly seed
an empty active slot:

```powershell
uv run --package andromeda-ingestion andromeda-bmstu ingest stage `
  --bootstrap --base data/bmstu-2026 `
  --parse-report artifacts/bmstu-ingestion/parsed.json `
  --output artifacts/bmstu-ingestion/candidate
```

Bootstrap fails if an active release already exists. Missing or unverifiable
archives also fail closed; a legacy release must be explicitly adopted with
an exact-digest matching bundle.

## Diff and moderation

Create machine-readable JSON and CSV diffs. Exact external keys are the only
identity join; name similarity does not link records.

```powershell
uv run --package andromeda-ingestion andromeda-bmstu ingest diff `
  --input artifacts/bmstu-ingestion/candidate `
  --json-output artifacts/bmstu-ingestion/diff.json `
  --csv-output artifacts/bmstu-ingestion/diff.csv
uv run --package andromeda-ingestion andromeda-bmstu ingest review-template `
  --input artifacts/bmstu-ingestion/candidate `
  --output artifacts/bmstu-ingestion/review.csv `
  --actor reviewer-name
```

Diff classifications include `new`, `changed`, `unchanged`, `conflicting`,
`unreviewed`, and `potentially_removed`. Partial captures do not imply
deletion. A removal appears only as a report row when that dataset is
explicitly declared complete; it is never materialized as a delete.

The template omits unchanged candidates when their exact key and provenance
are verified, so they do not re-enter review or create another decision
event. It pre-fills only changed fields on the narrow safe-field allowlist
when an exact target and provenance are present. New, conflicting, ambiguous,
critical, previously rejected, or provenance-incomplete rows remain blank for
individual review. Review every prefilled change against its source before
accepting it; a filled cell is a review aid, not a similarity-based identity
decision. Set the exact target key and `reviewed_at`; the reviewer can use the
`reviewed_by` column or `--actor`.

```powershell
uv run --package andromeda-ingestion andromeda-bmstu ingest review `
  --input artifacts/bmstu-ingestion/candidate `
  --decisions artifacts/bmstu-ingestion/review.csv `
  --output artifacts/bmstu-ingestion/reviewed `
  --actor reviewer-name
uv run --package andromeda-ingestion andromeda-bmstu ingest validate `
  --input artifacts/bmstu-ingestion/reviewed
uv run --package andromeda-ingestion andromeda-bmstu ingest dry-run `
  --input artifacts/bmstu-ingestion/reviewed
```

Materialization writes append-only `review_decisions.jsonl` events in the
verified release bundle archive. Events contain reviewer, timestamp, decision,
candidate/target keys, source key and digest, and the reviewed payload/hash;
unchanged no-action rows have no new decision event. Rejected candidate
payloads are retained for re-review:

```powershell
uv run --package andromeda-ingestion andromeda-bmstu ingest remoderate `
  --input artifacts/bmstu-ingestion/reviewed `
  --output artifacts/bmstu-ingestion/reopened
```

Reopened rows require an explicit new individual decision; the previous
rejection remains in the audit history.

The 2026 Appendix 8.1 result is recorded in
[live validation](LIVE_VALIDATION.md). Its 254 new quota pools and 254 exact
offering links were reviewed individually. Exact digests and PDF row locators
also justified retiring 104 old direction-scoped pools and their 254 links;
the prior immutable release remains available for verified rollback.

## Commit and rollback

Only after inspecting the diff, review journal, validation, and dry-run should
an operator explicitly commit to the selected database:

```powershell
uv run --package andromeda-ingestion andromeda-bmstu ingest commit `
  --input artifacts/bmstu-ingestion/reviewed
uv run academic-data release show
```

Commit is transactional: a failure before activation rolls back the candidate
and leaves the active pointer unchanged. Reimporting the same successful
bundle is a no-op. Published release rows remain immutable.

Each release retains its compressed importer bundle in PostgreSQL. There is no
archive pruning command or retention/size quota; monitor database growth and
include these artifacts in database backup planning. Do not delete an archive
to make an update succeed; a legacy release without one requires exact-digest
adoption.

Rollback is an explicit active-pointer switch to a committed release whose
archive and reconciliation are verified. Inspect `release_activation_events`
in the database to find prior release IDs and active-head changes, then pass
the current active ID as a compare-and-swap guard:

```powershell
uv run academic-data release rollback `
  --to <verified-previous-release-id> `
  --expected-active-release-id <current-active-release-id> `
  --reason "restore verified release after review"
```

Rollback appends an actor/time/reason event. If the active ID changed since it
was inspected, rollback stops and requires an explicit retry against the new
head.

## Bounded live probe

The probe accepts only the checked local export as its comparison input and
does not open a database commit path. It caps HTTP exchanges including
redirects, spaces requests by at least one second, uses a 10-second timeout,
does not retry 403/429 or other source errors, and writes a report without raw
bodies or query tokens. It never fetches admission-order documents.

```powershell
uv run --package andromeda-ingestion andromeda-bmstu ingest probe `
  --compare-bundle artifacts/bmstu-ingestion/current-release.zip `
  --release-id <release-id> `
  --output artifacts/bmstu-ingestion/live-report.json
```

The report remains pending evidence. To publish any live fact, run it through
the normal candidate, exact-key review, validation, and explicit commit path.
No live source data from the recorded 2026-10-07 probe was staged or committed.

See also: [live probe findings](LIVE_VALIDATION.md),
[architecture](../architecture/ARCHITECTURE.md), [known limitations](KNOWN_ISSUES.md).
