# Ingestion service

This service owns the existing `andromeda.ingestion.universities.bmstu.*`
capture, parser, normalizer and source-contract namespaces. The
`andromeda_parser` namespace owns CLI orchestration, candidate bundles, exact-key
diffs and reviewer materialization. Both are installed from
`services/ingestion/src`; there is no second parser source tree.

The operator flow remains capture → parse → stage → diff → review → validate →
dry-run → commit. Ingestion writes capture and candidate artifacts. Release
status/export, bundle validation and dry-runs, and publication go through
`andromeda_api.application` use cases.

The existing operator command remains available as `andromeda-bmstu`:

```powershell
uv run --package andromeda-ingestion andromeda-bmstu list
uv run --package andromeda-ingestion andromeda-bmstu ingest --help
```

Review uses exact external keys. Similarity is only a reviewer hint; ingestion
does not merge records or publish canonical data by itself.
