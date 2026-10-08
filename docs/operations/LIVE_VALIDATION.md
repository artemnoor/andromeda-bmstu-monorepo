# Bounded BMSTU live validation — 2026-10-07

Previous: [Ingestion operations](INGESTION_OPERATIONS.md) · Next: [API readiness](../api/API_READINESS.md)

## Scope and safety

Repeated at **2026-10-07 06:04:56 UTC / 09:04:56 Europe/Moscow**, after the
curriculum-key and tuition-year changes. The probe used the sanitized release
export from isolated PostgreSQL 16 `academic_data_test`, release
`a897c88a-9a3b-59bd-b563-3b055fe6fb42`, bundle digest
`42616ee9348ee009fa1b297f7ef697862134835e562c7840f413643ce71d2130`.

It made **8 fetch calls / 10 HTTP exchanges** including redirects, under the
12-exchange hard cap. It used a 10-second timeout, no retries, one-second
request spacing, 30 MB response cap, and no browser automation. No admission
order document body was fetched, and no live result was committed or staged.
The complete sanitized report is in ignored local storage at
`artifacts/live-validation/probe-2026-10-07-identity-compat.json`.

## Observed sources and comparisons

| Source | Result | What the bounded probe established |
|---|---|---|
| [BMSTU catalog HTML](https://bmstu.ru/bachelor/majors) | HTTP 200 | Zero visible card links. Marked `fallback_deferred`; this response does not imply an empty catalog. |
| [Official BMSTU catalog API](https://api.www.bmstu.ru/majors/baccalaureate-and-specialty?limit=1&offset=0) | HTTP 200 | One row returned; API reported 53 total. One detail record was inspected, not paginated. The API is the primary catalog source for this parser. |
| One direction, department and program card | HTTP 200 | Direction `01.03.02`, one department and one program parsed. All exact keys matched the release; no compared fields changed. The card contained raw places/price indicators, but those were not promoted. |
| One linked 2026 study plan/PDF | HTTP 200 | 12 semesters and 113 curriculum rows parsed. Keys `curriculum_item:<exact-plan-key>:row:1..113` matched all 113 current-release keys; zero unkeyed, unmatched, or changed records. PDF SHA-256 and row locators were retained in parser output. |
| [BMSTU admission information](https://course.bmstu.ru/edu/abiturient/) | HTTP 200 | 783 aggregate historical-statistic rows matched by exact key with zero compared changes. No explicit year was found in the owning tuition sections: 0 canonical live tuition rows, 154 pending observations, and no `year-unspecified` external keys. The page contained date mentions on 25 July, 19 August, and 20 August 2026; this sample is not a complete campaign calendar. |
| [Admission order index](https://priem.bmstu.ru/lists/orders.json) | HTTP 200 | Manifest metadata listed 24 enabled documents. Zero document bodies were fetched; no applicant-level data was read. |

## User-provided Appendix 8.1 — local parse, 2026-10-08

The user supplied a copy of the BMSTU 2026 first-year intake plan, Appendix
8.1. Its SHA-256 is
`553f0c31af6038441770aabdf86acd79c77000cbe5fcb193991f6cf4054597d0`.
This was parsed locally; it was not fetched from the live site. The public
[BMSTU admissions page](https://isot.bmstu.ru/edu/abiturient/) is the observed
official index, but this exact PDF download URL was not independently
verified. No access protection was bypassed.

The offline PDF parser extracted **127 Moscow offering rows** and **165
source-table rows**. The authority mapping produced **508 offering-scoped
pools** (127 each for budget general competition, paid general competition,
special quota and separate quota) and **508 exact offer-to-pool links**. An
explicit zero remains zero; different values under one direction remain
separate facts. The original parse had **zero exact offering/quota conflicts**.

On 2026-10-08 the facts were staged from the verified active-release archive,
diffed, reviewed individually, validated, dry-run projected and committed to
the local PostgreSQL 16 test database. The new release is
`25a4fb23-71be-530a-b627-7edbf093e17a`, key
`bmstu-2026:3f0d9872fb948e9484e7df32abe9a5cf81ec475fff0a66cdcc3c6af473d4ec35:bmstu-2026-bundle-v4`.
There were 254 new special/separate quota pools and 254 new exact offering
links; the other 254 general-competition pools were already canonical and
were confirmed against the same PDF. The release now contains 1,090 pools and
3,478 source relationships. Directus exposes **127 special + 127 separate**
offering pools, and all **508** budget/paid general and quota pool records
have evidence linked to the supplied PDF artifact.

The same exact PDF rows showed that **104** old direction-scoped quota pools
and their **254** offering links were stale scope. Their prior row digests and
relationship digests were checked before individual retirement decisions;
**80** stale conflict-review rows were resolved. The old release was not
rewritten. The remaining Appendix-specific gaps are **21** offerings without
one exact program-catalog match and **five** combined-department findings.
These records remain visible for review and no program/dept link was guessed.

This is a local user-provided document result, not a fresh live fetch. No
public download URL for these exact bytes was verified, so the source artifact
has no URL and its raw PDF bytes remain omitted. Directus displays the exact
SHA-256 and page/table/row locators. The completed import was re-exported and
reconciled; the exact same PDF staged again as **zero candidates**. Its diff
was empty, so no second release was committed.

## Remaining source gaps

- The HTML catalog returned no recognized links while the official API returned
  a sample. No browser automation was added; the HTML parser is a deferred
  fallback and the API is the primary source.
- The saved probe used the previous positional key convention and matched its
  113 existing rows. This proves exact comparison for the sampled plan/document,
  not every BMSTU PDF layout. The follow-up identity implementation and its
  offline evidence are recorded below; it did not repeat the live fetch.
- The tuition page did not state an academic year in the same owning section
  as the sampled values. All 154 rows remain pending/source-gap observations;
  no current date or campaign convention was used to guess a year.
- The selected admissions page exposed no requirements PDF link matching the
  bounded selector. Exam-rule coverage remains unverified live.
- The bounded live probe did not fetch an aggregate places/quota PDF; the order
  index remained metadata-only. Quota values currently come from the
  user-provided PDF above and have not been independently checked against a
  current public download of the same document.
- Date text was observed but not validated across education levels, tracks,
  and the full official campaign calendar.

No live value was written to PostgreSQL or published. A bounded sample does
not demonstrate complete live parser coverage. To reproduce this check, use
the guarded `ingest probe` command in
[INGESTION_OPERATIONS.md](INGESTION_OPERATIONS.md).

## Curriculum identity follow-up

No additional live requests were made for the identity change. The ignored
report above contains the prior comparison counts but not the raw 113 parsed
rows or the source PDF. The new resolver was tested against the checked-in
release slice for the same exact plan: all 113 current canonical keys were
matched, none were new or ambiguous, and no field values or releases were
rewritten. This is an offline regression against the saved current bundle,
not a fresh 113-row live parser run.

Both checked-in curriculum PDF fixtures were parsed twice: `curriculum.pdf`
produced 89 rows and `curriculum_2.pdf` produced 123 rows. Their deterministic
identity keys, source hashes, PDF page, printed row number, and parsed order
locators are asserted by tests. Exact-identity gaps remain for title changes
and repeated indistinguishable rows because the PDFs do not provide an
official discipline identifier. Those candidates require human review.

See also: [known limitations](KNOWN_ISSUES.md),
[architecture](../architecture/ARCHITECTURE.md), [API readiness](../api/API_READINESS.md).
