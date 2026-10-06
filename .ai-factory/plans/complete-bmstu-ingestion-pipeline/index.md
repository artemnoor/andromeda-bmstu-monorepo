<!-- aif:plan-mode:ultra -->
# Ultra Implementation Plan: Complete the BMSTU Ingestion Pipeline

Mode: ultra
Branch: main (continue on the current branch and publish to the existing public repository)
Created: 2026-10-06

## Original Request

Продолжай работу в `andromeda-bmstu-monorepo`, используя **AI Factory**. Не перестраивай архитектуру и не создавай новый репозиторий.

**Задача — исправить выявленные проблемы и полностью завершить ingestion pipeline МГТУ.**

1. **Исправь CI:** проблема подтверждена — Git преобразовал CRLF в LF в HTML-fixtures, из-за чего SHA-256 не совпадают с `source_manifest.json`. Настрой `.gitattributes`, согласуй контрольные суммы и capture digest, не изменяя хеши оригинальных источников (`source_sha256`). Добейся полностью зелёного GitHub Actions.
2. **Заверши Parser → Bundle → PostgreSQL:** сейчас принятые результаты парсинга сохраняются только как observations. Реализуй преобразование подтверждённых данных в реальные типизированные записи: программы, кафедры, учебные планы, дисциплины, экзамены, требования, места, квоты, стоимость и статистику.
3. **Сохрани безопасность:** только точные external keys, provenance, ручное подтверждение изменений, обработка конфликтов, сохранение неизвестных значений и запрет потери корректных данных при неполных выгрузках.
4. **Протестируй полный цикл:** изменение фактов, отсутствие изменений, повторный импорт, ошибки парсинга, конфликтующие источники, частичные данные, rollback и переключение active release. Используй PostgreSQL 16 и реальные локальные fixtures.
5. **Обнови документацию:** опиши, что действительно работает, что ещё ограничено и как воспроизводимо обновить академические данные.

Не добавляй пока сайт, API, Directus, Dagster и другие новые технологии. Не выполняй массовый live-парсинг.

**Результат:** рабочий, проверенный pipeline обновления академических данных МГТУ. Выполни задачи через AI Factory, опубликуй изменения в этом же репозитории и добейся зелёного CI. В конце предоставь фактические результаты тестов и список оставшихся ограничений.

## Settings

- Testing: yes; full offline and PostgreSQL 16 integration coverage is required.
- Logging: Verbose — DEBUG detail, with redacted URLs and no response bodies or secrets.
- Documentation: yes; update the operator workflow and current limitations.
- Roadmap linkage: none; the repository has no `.ai-factory/ROADMAP.md`.
- Git: continue on current `main`; publish only to `andromeda-public` after local verification. Do not create another repository or modify `origin`.
- Architecture: preserve the existing `academic-data` schema, bundle contract, importer, and release transaction. No new service or technology.
- Data scope: BMSTU only; local fixtures only; no mass live parsing, applicant PII, raw captures, or source repository writes.

## Requirements Reconciliation

Authority: this follow-up request supersedes the previous plan's observation-only acceptance criteria; existing schema and data safety constraints remain authoritative.

| Decision / supported combination | Source path and section | Verification evidence |
|---|---|---|
| HTML fixture bytes must be stable across checkout platforms; sanitized `content_sha256` and capture digest follow the checked-in fixture bytes, while original `source_sha256` values remain unchanged. | `tests/fixtures/bmstu/ingestion/source_manifest.json`; this request, item 1 | Cross-platform Git attributes check and all fixture hash tests |
| Only explicitly reviewed typed facts are materialized. Every link uses an exact external key; unreviewed, ambiguous, or conflicting candidates cannot be imported. | `parsers/src/andromeda_parser/bundle.py`; this request, item 3 | Review rejection, exact-link, duplicate-target and conflict tests |
| Sparse updates leave unknown or absent fields untouched. Missing rows in a partial capture never delete valid rows from the base bundle. | This request, item 3; `academic-data/src/academic_data_service/importer/mapping.py` | Partial-source test compares untouched base rows byte-for-byte |
| Typed facts continue through the existing validated bundle and release importer; a failure before activation rolls back the new release and retains the prior active release. | `academic-data/src/academic_data_service/importer/persistence.py`; this request, item 4 | PostgreSQL 16 commit, rollback, idempotency, and active-pointer integration tests |
| CI and verification use committed local fixtures only; absence of a fact in a capture is not interpreted as zero, false, or deletion. | This request, item 4; `.github/workflows/ci.yml` | CI run and partial/error fixture tests |

## Architecture and Decisions

- Keep the flow `capture -> parse -> candidate bundle -> human review -> typed bundle -> existing validator/mapper -> PostgreSQL release transaction -> active release`.
- Reuse the existing typed dataset contracts in `DATASET_MAPPING_REGISTRY`; do not add ORM tables or alter Alembic history unless verification proves the existing schema cannot represent a required fact.
- Preserve parser source observations alongside typed rows for auditability. Typed rows reference existing/imported source artifacts and retain source URL, hash, retrieval time, and locator.
- Review decisions identify the parser candidate and exact target `external_key`. A source code/name similarity is never an automatic identity link. Conflicting candidates remain review items until a human resolves them.
- Materialization is additive and sparse by default. It may update only fields explicitly present and reviewed; it does not infer removals from missing records.
- All database scenarios use the disposable local PostgreSQL 16 service and checked-in fixtures. No live capture is run.

## Phase Index

1. [Phase 1: Fixture integrity](phase-01-fixture-integrity.md) — Task 1
2. [Phase 2: Typed materialization and review](phase-02-typed-materialization.md) — Tasks 2–3
3. [Phase 3: Release safety verification](phase-03-release-verification.md) — Task 4
4. [Phase 4: Documentation, CI, and publication](phase-04-docs-ci-publication.md) — Tasks 5–6

## Cross-Phase Dependencies

- Task 2 depends on Task 1 because candidate/source digests must refer to stable fixture bytes.
- Task 3 depends on Task 2 because review must gate typed mappings rather than only the raw canonical snapshot.
- Task 4 depends on Tasks 1–3 because PostgreSQL scenarios exercise the reviewed typed bundle produced from fixtures.
- Tasks 5 and 6 depend on Task 4 because documentation and publication must report verified behavior and the final CI result.

## Tasks

### Phase 1: Fixture integrity
- [ ] Task 1: Make fixture hashes checkout-stable and reproduce the capture digest ([detail](phase-01-fixture-integrity.md#task-1-make-fixture-hashes-checkout-stable-and-reproduce-the-capture-digest))

### Phase 2: Typed materialization and review
- [ ] Task 2: Materialize reviewed parser facts into existing typed bundle datasets ([detail](phase-02-typed-materialization.md#task-2-materialize-reviewed-parser-facts-into-existing-typed-bundle-datasets)) (depends on 1)
- [ ] Task 3: Enforce exact-key review, provenance, conflict, and partial-snapshot safety ([detail](phase-02-typed-materialization.md#task-3-enforce-exact-key-review-provenance-conflict-and-partial-snapshot-safety)) (depends on 2)

### Phase 3: Release safety verification
- [ ] Task 4: Verify the end-to-end update lifecycle on PostgreSQL 16 ([detail](phase-03-release-verification.md#task-4-verify-the-end-to-end-update-lifecycle-on-postgresql-16)) (depends on 1–3)

### Phase 4: Documentation, CI, and publication
- [ ] Task 5: Document the verified update workflow and truthful limitations ([detail](phase-04-docs-ci-publication.md#task-5-document-the-verified-update-workflow-and-truthful-limitations)) (depends on 4)
- [ ] Task 6: Publish to the existing public repository and verify green GitHub Actions ([detail](phase-04-docs-ci-publication.md#task-6-publish-to-the-existing-public-repository-and-verify-green-github-actions)) (depends on 4–5)

## Commit Plan

- **Commit 1** (after Tasks 1–3): `fix(ingestion): materialize reviewed BMSTU facts safely`
- **Commit 2** (after Tasks 4–5): `test(docs): verify complete BMSTU release lifecycle`
- **Commit 3** (after Task 6 if a CI-only correction is needed): `fix(ci): stabilize BMSTU fixture verification`

## Definition of Done

- Fixture content hashes match on the current checkout and GitHub Actions; all `source_sha256` values for original sources remain unchanged.
- A reviewed parser result produces importer-mappable typed rows for every populated supported category, including programs, departments, plans/curriculum, exams/requirements, places/quotas, tuition, and statistics. Empty/unknown candidate fields do not become invented facts.
- Exact-key decisions and provenance are required. Conflicts and unreviewed candidates fail closed; partial captures retain omitted base facts.
- PostgreSQL 16 tests cover change, no change, repeat import, parser error, conflicting sources, partial data, rollback, and active-release switch.
- Docs distinguish implemented paths from fixture/source coverage limits and provide reproducible commands.
- GitHub Actions is green on the published `main` in `https://github.com/artemnoor/andromeda-bmstu-monorepo`; the source `origin` is unchanged.
