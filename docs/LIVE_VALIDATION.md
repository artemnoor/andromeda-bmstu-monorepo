# Bounded BMSTU live validation — 2026-10-07

Previous: [Ingestion operations](INGESTION_OPERATIONS.md) · Next: [API readiness](API_READINESS.md)

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
- No safe aggregate places/quota table was identified. Raw places/price hints
  on a program card were not mapped to campaign/program facts. The order index
  remained metadata-only.
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
[architecture](ARCHITECTURE.md), [API readiness](API_READINESS.md).
