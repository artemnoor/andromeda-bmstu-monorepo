# Ingestion service

This service owns the existing `andromeda.ingestion.universities.bmstu.*`
capture, parser, normalizer and source-contract namespaces. The
`andromeda_parser` namespace owns CLI orchestration, candidate bundles, exact-key
diffs and reviewer materialization. Both are installed from
`services/ingestion/src`; there is no second parser source tree.

The operator flow remains capture → parse → stage → diff → review → validate →
dry-run → commit. The parser/ingestion package has no API or database runtime
dependency and writes only capture, candidate, and reviewed-bundle artifacts.
The separate `services/ingestion-cli` composition package owns the operator
entry point and calls API application use cases for durable proposal state,
release status/export, and canonical publication.

The existing operator command remains available as `andromeda-bmstu`:

```powershell
uv run --package andromeda-ingestion-cli andromeda-bmstu list
uv run --package andromeda-ingestion-cli andromeda-bmstu ingest --help
```

Review uses exact external keys. Similarity is only a reviewer hint; ingestion
does not merge records or publish canonical data by itself.
