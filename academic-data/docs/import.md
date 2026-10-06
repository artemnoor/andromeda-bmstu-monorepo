# Import the checked-in BMSTU bundle

The only current import source is the reviewed normalized bundle at
`data/bmstu-2026/`. It contains no raw PDFs, spreadsheets, or applicant-level
records. Import does not run parser code, issue HTTP requests, or fill missing
associations by guessing.

From the monorepo root, validation and dry-run are offline:

```powershell
uv run --no-editable --package andromeda-academic-data-db academic-data bundle validate --input data/bmstu-2026
uv run --no-editable --package andromeda-academic-data-db academic-data bundle import --input data/bmstu-2026 --dry-run
```

They recompute bundle hashes and map the normalized records without opening a
database connection. Review warnings and unresolved references before a local
test commit.

For the local commit path, start PostgreSQL 16 and apply migrations as shown in
the root README. Set `ACADEMIC_DATA_ENV=test` and point
`ACADEMIC_DATA_DATABASE_URL` only to localhost database `academic_data_test`.
Then run:

```powershell
uv run --no-editable --package andromeda-academic-data-db academic-data bundle import --input data/bmstu-2026 --commit
```

Persistence is transactional. A failed import is recorded as a failed batch;
the active release pointer changes only after the new release has reconciled.
Repeating the same source digest and mapper version returns `no_op`.

See [the root architecture](../../docs/ARCHITECTURE.md) for active data
ownership and [known issues](../../docs/KNOWN_ISSUES.md) for current coverage
gaps.
