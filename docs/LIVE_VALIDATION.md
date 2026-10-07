# Bounded BMSTU live validation — 2026-10-07

Previous: [Ingestion operations](INGESTION_OPERATIONS.md) · Next: [API readiness](API_READINESS.md)

## Scope and safety

Checked at **2026-10-06 23:20:08 UTC / 2026-10-07 02:20:08 Europe/Moscow**.
The probe used the explicit read-only CLI, at most one catalog record, one
program card, one plan/PDF, one admissions page, one order index, and one
requirements-link check. It performed **10 HTTP exchanges** (including
redirects) within the 12-exchange cap, across eight fetch calls. Requests were
spaced by at least one second, timeout was 10 seconds, retries were disabled,
and each response was capped at 30 MB. No browser fallback, applicant-level
order document, raw body, or live database write was used. No 403 or 429 was
encountered.

The comparison release was built in the isolated local PostgreSQL 16
`academic_data_test` database from the checked-in bundle, not from a
production database. Its release ID was
`a897c88a-9a3b-59bd-b563-3b055fe6fb42`, with source digest
`42616ee9348ee009fa1b297f7ef697862134835e562c7840f413643ce71d2130`. The
active release ID and digest were unchanged after the probe. The complete
sanitized JSON report is available locally under ignored
`artifacts/live-validation/probe-2026-10-07-final.json`; it is not committed
as an academic data update.

## Observed sources

| Source | Result | What the bounded parser could establish |
|---|---|---|
| [BMSTU bachelor catalog](https://bmstu.ru/bachelor/majors) | HTTP 200 | HTML parser found zero visible program links in this response. This is a parser/source gap, not an empty catalog. |
| [BMSTU catalog API](https://api.www.bmstu.ru/majors/baccalaureate-and-specialty?limit=1&offset=0) | HTTP 200 | One row parsed; API reports 53 records total. The probe did not paginate. |
| One selected program detail | HTTP 200 | Direction `01.03.02`, one department and one program parsed; all three exact keys matched the local release with no changed fields. Raw places/price fields were not promoted from the card. |
| One public study-plan link and its metadata/PDF | HTTP 200 | 2026 plan parsed: 12 semesters and 113 curriculum rows. The parser emitted no exact external keys for those rows, so no fact-level comparison was possible. |
| [BMSTU admission information](https://course.bmstu.ru/edu/abiturient/) | HTTP 200 | 783 aggregate historical-statistic rows matched the local release by exact key with no differences. 154 tuition rows parsed, but their `year-unspecified` keys do not match the current release keys; values are not treated as changed facts. Date text includes 25 July 2026, 19 August 2026, and 20 August 2026. |
| [Admission order index](https://priem.bmstu.ru/lists/orders.json) | HTTP 200 | Manifest metadata parsed for 24 enabled documents. No document body was fetched; this does not establish aggregate places or quota values. |

## Gaps and interpretation

- The selected HTML catalog response has no links recognized by the current
  parser, even though the API reports catalog rows. The API route is the
  usable source in this sample; the HTML parser needs a separately reviewed
  fixture/update before it can be relied upon.
- Curriculum parsing works for the selected PDF, but its 113 rows lack exact
  importer external keys. The parser output therefore cannot be safely
  compared or promoted by key; no name-based join was attempted.
- Tuition parsing returns 154 rows but uses keys such as
  `year-unspecified`; 154 live keys did not match the release by exact key.
  This is an identity/year-contract gap, not evidence that the stored prices
  changed. The source requires review and better academic-year identity.
- The selected admission page exposed no official exam-requirements PDF link
  matching the current selector. Exam subject and AND/OR/AT_LEAST rules were
  not live-verified by this sample.
- No safe aggregate places/quota table was identified. The order index was
  metadata-only; individual admissions/result documents were deliberately
  excluded.
- The page yielded 2026 campaign date text, but the probe did not validate
  every education level, admission track, or deadline against a complete
  official campaign calendar.

No live result was staged, reviewed, or committed. These findings are a
time-bounded source sample and do not demonstrate complete live parser
coverage. For a repeatable local run, use the `ingest probe` steps in
[Ingestion operations](INGESTION_OPERATIONS.md). For model/API limits, see
[API readiness](API_READINESS.md).

See also: [known limitations](KNOWN_ISSUES.md),
[architecture](ARCHITECTURE.md), [ingestion audit](INGESTION_AUDIT.md).
