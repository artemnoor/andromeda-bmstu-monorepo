# BMSTU ingestion audit

Previous: [Known limitations](KNOWN_ISSUES.md) · Next: [README](../README.md)

Audit date: 2026-10-06. All source checkouts listed below are read-only copies
under the system temporary directory. The original GitHub repositories were
not modified.

## Revisions and evidence

| Source | Revision | Relevant verified contents |
|---|---|---|
| `artemnoor/andromeda-prod` | `ef3461930be4da1dc6710197d6c43697eb4d6738` | Current monorepo baseline; working tree was clean before this audit |
| `artemnoor/andromeda-parsers` | `f08819f5534b3dfa4d46934e10091e7b899a183b` | Parser adapters, BMSTU-2026 normalized bundle, source-tree parser code |
| `artemnoor/andromeda-data` | `8093390f9f8c3b9ec223d033a49fbbfbac9ab7f` | Alternative academic schema v1, three migrations, PostgreSQL tests |
| `artemnoor/hackathon-max-andromeda` | `1ea6beff9c1be151e1ed8a5b17dd69c95a696b18` | Legacy shared contracts, full BMSTU adapter and real local source fixtures |

The BMSTU-2026 bundle in this monorepo is byte-for-byte identical to the
bundle under `andromeda-parsers/database/academic-data/data/bmstu-2026` at the
audited source revision. Per-file SHA-256/path comparison found no changed or
missing files.

## Current monorepo baseline

- `academic-data/` owns 45 ORM tables and eight preserved Alembic revisions.
  Its bundle reader/validator, deterministic mapper, and transactional
  importer already implement release-scoped facts, provenance, source
  evidence, requirement trees, idempotency, and an atomic active-release
  pointer. The selected schema is PostgreSQL 16.
- `parsers/` is an installable BMSTU package with five standalone parser
  entries: catalog HTML, catalog API, program card, admission information, and
  tuition. Its ingestion CLI captures local fixtures by default, parses frozen
  captures offline, and supports an explicit bounded direct-HTTP mode. It can
  build review-gated bundles for the existing importer.
- `data/bmstu-2026/` contains 28 JSONL datasets and 21,911 normalized records.
  The validator reports zero errors and one existing manual-review warning.
  The bundle includes 53 directions, 77 departments, 152 programs, 127
  offerings, 940 competition pools, 152 study plans, 14,165 curriculum items,
  81 requirement sets / 405 nodes, 311 current and 783 historical admission
  statistics, 498 source artifacts, 13,886 evidence rows, 23,020 observations,
  3,478 relationships, and 560 manual-review items. It contains no raw source
  documents, applicant-level records, or olympiad dataset.
- Baseline local tests against the disposable PostgreSQL 16 container: **8
  passed**. Bundle validation and dry-run both returned success. Existing
  warnings are 167 unresolved exact references (all listed for review) and 22
  noncanonical manual-review keys.

## Upstream BMSTU capability matrix

| Capability | Upstream implementation found | Current active package | Integration decision |
|---|---|---|---|
| Official catalog/index and direction discovery | `BmstuSource`, catalog HTML/API parsers, catalog identity helpers | Fixture capture, direct-HTTP capture, catalog HTML/API parsing | Keep capture explicit and bounded; preserve source keys and provenance |
| Program detail cards, departments, profiles | BMSTU detail/API parsers and identity mapping | Program-card local parser | Restore the typed adapter path and map only exact supported identities |
| Study plans, semesters, hours, assessment forms | PDF parser, curriculum normalizer, source-plan metadata | Fixture/live capture and bounded local PDF parsing | Preserve parser output as review candidate; do not publish captured PDFs in the normalized bundle |
| Exams, requirements, campaign dates, places, quotas | Admission, rules, intake, targeted quota and achievement parsers | One admission-information page parser | Keep campaign identity separate and preserve AND/OR/AT_LEAST trees; unresolved structures stay review-only |
| Tuition and public admission information | Tuition/admission-information parsers and facts | Both exist as standalone local parsers | Connect parsed values to captured-source provenance; never infer missing values |
| Admission statistics and competition lists | Aggregation and source adapters exist; some upstream sources are blocked/incomplete | Snapshot bundle only | Aggregate only; exclude personal applicant rows and do not claim full 2026 passing-score coverage |
| Achievements and admission rules | Benefit capture, policy contracts, and rule parsers exist | Not in active parser registry | Parse to candidate output; only promote facts supported by authoritative documents and current schema |
| Olympiad parser/contracts | Parser code exists in the broad adapter | No confirmed safe source dataset | Retain parser code as offline/review capability; do not place olympiad records in the active importer bundle |
| HSE | Deferred code exists | Not registered or installed | Keep inactive and out of the build |

The broad BMSTU adapter is present in the legacy monolith, not in the two
original repositories' executable package layout. Its `capture()` / `parse()`
boundary yields `RawTracerBundle` and `CanonicalSnapshot` and imports legacy
shared contracts. The active integration selectively copied the BMSTU parser
runtime and its required support modules from that monolith, plus two small
evidence/source contract modules used by those imports. It excludes the legacy
ORM, API, user-profile service, and optional plan-link visualizer helper.

## Fixture and runtime verification

The active project contains seven public regression fixtures: a minimal
institution-identity HTML fixture, redacted official catalog/detail HTML and
API JSON, two public curriculum PDFs, and one sanitized aggregate admission
outcomes page. `source_manifest.json` records the upstream body hash separately
from the sanitized fixture hash. Direct contacts and staff names were removed
from the HTML/JSON copies; the public curriculum PDFs contain no direct
contacts or signatory names. `.gitattributes` pins fixture HTML and JSON to LF
so a Git checkout preserves the hashed bytes. Original upstream
`source_sha256` values are unchanged; sanitized `content_sha256` hashes
describe checked-in bytes. Captured live bodies stay outside Git, and
normalized bundles contain no raw source documents. A local fixture run
captured and parsed seven sources into 2 programs, 2 curricula, 101
disciplines, 212 curriculum items, and one aggregate historical result with
zero parser source gaps. It made no live requests. Its capture digest is
`dedc5d2731b78a285c42bfdcdf85d6e8e6634d729a1a975ecd7d7f00b0145afc`. The
broader `ingest capture --mode live` behavior remains unverified as a routine
update path; a separate selected-source live probe was completed on
2026-10-07 and is documented in [LIVE_VALIDATION.md](LIVE_VALIDATION.md).

Separately, before integration, the monolith's offline BMSTU integration test
passed in a temporary Python 3.11.9 environment: **1 passed**, with four
Alembic configuration deprecation warnings. It used a temporary SQLite
database and made no live requests. This is source-audit evidence only.

The first attempted test command used `--group dev`; the audited backend
declares `dev` as a `project.optional-dependencies` extra, not a dependency
group. That command stopped before tests. Retrying with `--extra dev --python
3.11` succeeded. Both attempts were read-only with respect to the source
checkout; the retry created an isolated `.venv` under the temporary clone.

## Schema and integration constraints

- Keep `academic-data` as the only write owner. Do not concatenate or rewrite
  its migrations, create a second academic schema, or persist through the
  legacy monolith runner.
- The importer maps only dataset names in
  `academic_data_service.importer.mapping.DATASET_MAPPING_REGISTRY`; unknown
  JSONL datasets fail closed. Use its existing observation/evidence mapping
  for reviewed source facts, and preserve the full checked-in bundle when
  staging updates so activating a partial release cannot erase current data.
- Existing exact-key identity is authoritative. Do not fuzzy-link programs,
  profiles, departments, competition pools, or statistics. Null stays null;
  candidate conflicts and unresolved joins go to manual review.
- Raw bytes may exist in a local ignored capture workspace for parsing, but
  exported/public bundles must contain hashes and provenance only. Applicant
  rows, personal identifiers, auth/anti-bot circumvention, and non-BMSTU active
  sources are excluded.
- The upstream fetcher defaulted to `browser_mode="auto"`. The active adapter
  now pins `browser_mode="never"` and rejects forced browser mode. Live mode
  uses direct HTTP, allowlisted redirects, default one-second request spacing,
  bounded retries/timeouts/body size, and visible source gaps. Tests remain
  fixture-only.

## Decisions and known limits

1. Preserve the existing `academic-data` schema, bundle contract, release
   activation, and rollback implementation unless an integration test proves
   a specific incompatibility.
2. Restore only the audited BMSTU parser dependency closure. Exclude the
   broken optional `reconcile_confirmed_plan_links.py` helper because it imports
   a missing visualizer and is outside ingestion correctness.
3. Keep source acquisition explicit and opt-in. CI and tests use local
   fixtures. No live crawl was run in this audit.
4. Treat blocked or absent sources as gaps, never as zero/false values. Do not
   claim that an incomplete source snapshot is a complete admission campaign.
5. Keep olympiad and applicant-level records outside published academic bundles
   until safe source coverage and a confirmed destination contract exist.

## Follow-up: reviewed typed materialization

The candidate bundle now converts supported normalized parser results into
existing typed bundle datasets. Exact-key review is required to materialize a
typed candidate. Review suggestions do not create links automatically;
conflicting non-null source values for the same exact target stop
materialization. Sparse updates keep absent and unknown values, preserve
unselected base rows, retain source evidence, and do not infer deletions from
partial captures.

The full candidate set validates and maps through the existing importer; the
offline regression test checks typed directions/departments/programs/plans,
curriculum items, exams, requirements, offerings, competition pools,
statistics, and provenance. The PostgreSQL 16 lifecycle test commits the
checked-in aggregate statistic change to a new release, confirms evidence and
active-release switching, repeats the import as `no_op`, and injects a failure
before activation to verify rollback. It uses only the local fixtures. Tuition
candidate generation requires a known academic year and campaign; the current
fixtures do not prove a new year-valid price. Fixture coverage is limited and
no live acquisition was attempted. Reproduction commands and remaining
coverage limits are in the root `README.md` and `docs/KNOWN_ISSUES.md`.

## Source links

- [andromeda-parsers](https://github.com/artemnoor/andromeda-parsers)
- [andromeda-data](https://github.com/artemnoor/andromeda-data)
- [hackathon-max-andromeda](https://github.com/artemnoor/hackathon-max-andromeda)

## Follow-up: release lifecycle, moderation, and live probe

Follow-up work adds a verified archive and active-release export, stale-base
and concurrent-publisher guards, explicit rollback history, exact-key diff,
safe group-review eligibility, reviewer/source/value audit events, and
reopening rejected candidates. A PostgreSQL 16 test now covers five sequential
operations while checking that earlier accepted facts remain.

The 2026-10-07 bounded source probe parsed one catalog API row, one detail
card, one study-plan PDF, the admission page, and the order-index metadata.
The sample exposed exact-key gaps for curriculum rows and tuition; no source
data was committed. See [operations](INGESTION_OPERATIONS.md),
[live findings](LIVE_VALIDATION.md), and
[known limitations](KNOWN_ISSUES.md).

See also: [architecture](ARCHITECTURE.md),
[live validation](LIVE_VALIDATION.md), [known limitations](KNOWN_ISSUES.md).
