<!-- aif:plan-mode:ultra -->
# Ultra Implementation Plan: BMSTU Release Operations and Source Validation

Mode: ultra
Branch: main (continue and publish to the existing andromeda-public remote)
Created: 2026-10-07

## Original Request

Работаем в репозитории:

https://github.com/artemnoor/andromeda-bmstu-monorepo

Используй **AI Factory (AIF)** в режиме Ultra для планирования, реализации, тестирования и документирования задачи. Сначала изучи текущую реализацию и составь план с зависимостями и критериями приёмки, затем выполни его полностью.

## Цель

Завершить стабилизацию существующего ingestion pipeline Andromeda для МГТУ им. Н. Э. Баумана и подготовить систему академических данных к подключению API, Directus и сайта.

**Не перестраивай архитектуру.** Сохрани существующие PostgreSQL 16, SQLAlchemy, Alembic, immutable releases, provenance, importer, парсеры и контракты.

### Последовательные обновления (P0)

Новый bundle сейчас формируется от data/bmstu-2026, исходного снимка, что может потерять позже подтверждённые изменения. Основой обновления должен быть актуальный published release. Нужен безопасный экспорт его фактов, external keys, связей, provenance и review metadata в importer bundle. Старый snapshot нельзя неявно использовать после появления releases. Если active release изменился после подготовки кандидата, публикация должна остановиться до повторной сверки. Нужен явный rollback к предыдущему проверенному release, неизменность опубликованных releases и отсутствие подмены экспорта старым чтением. Проверить минимум пять последовательных обновлений: изменение, добавление, no-op, конфликт, повторный импорт; проверять сохранность предыдущих данных после каждого.

### Модерация (P0)

Нужен детальный diff с классами new/changed/unchanged/conflicting/unreviewed/potentially removed. Не отправлять unchanged на повторную модерацию. Группово подтверждать только изменения с точными external-key связями и provenance. New/ambiguous/conflicting/critical — индивидуально. Журналировать кто/когда/что/источник. Не принимать по похожим именам и не считать пропуск записи в partial capture удалением. Поддержать повторную модерацию отклонённых записей. Достаточно CLI, JSON/CSV; веб-админку не делать.

### Ограниченная live-проверка МГТУ (P1)

Проверить публичные официальные источники по каталогу, карточкам программ/кафедр, учебным планам/PDF, дисциплинам/часам/семестрам/контролю, экзаменам/требованиям, местам/квотам/ценам, датам кампании и агрегированной статистике. Соблюдать timeout/rate limit/retries. Не обходить 403/429, не собирать PII и не запускать массовый crawler. Недоступность отмечать source gap. Сравнить с текущей БД. Live-результаты не публиковать автоматически: только validation, review и явный commit в тестовую БД.

### Надёжность и следующий этап

Добавить unit/integration/E2E проверки последовательных обновлений, сохранности, stale/concurrent commit, diff/bulk, partial sources, conflicts, documents/provenance, повторного импорта, active switch, rollback/errors/recovery, AND/OR/AT_LEAST, целостности и чистого окружения. Разрушающие проверки — только изолированная PostgreSQL 16. Добиться зелёного GitHub Actions, тесты не удалять.

Описать фактическую готовность read-only контрактов для программ, планов, дисциплин, экзаменов, стоимости и поступления; отдельно будущий applicant profile; Directus-совместимость без вмешательства в releases; ограничения. Не реализовывать FastAPI, frontend, Directus или профили.

Ограничения: только МГТУ; ВШЭ отложена. Не добавлять сервисы/инфраструктуру, не менять старые репозитории, историю миграций, production DB/deployment. Не выдумывать данные и не скрывать unresolved refs; fixtures не доказывают live-работу. Обновить архитектуру, запуск, обновление, модерацию, ограничения, опубликовать в этом же репозитории. В финале перечислить изменения, lifecycle, bulk moderation, live findings, tests/Actions, риски, готовность API/site. Приоритет — сохранность данных, воспроизводимость, простота, производительность.

## Settings

- Testing: yes; full unit, integration, end-to-end and isolated PostgreSQL 16 lifecycle coverage.
- Logging: verbose DEBUG; identify operation/release/candidate, redact URL query values; never log bodies, secrets or applicant data.
- Documentation: yes; update architecture, operator, API-readiness and limitations docs.
- Roadmap linkage: none; .ai-factory/ROADMAP.md is absent.
- Git: continue on main and publish to existing andromeda-public only; no new repository, no origin change, no production DB/deployment.
- Architecture: preserve packages, PostgreSQL, SQLAlchemy, Alembic, immutable releases, bundle/importer, provenance and parsers; add only narrowly scoped support.
- Scope: BMSTU only; no mass live crawling or PII. Live output stays uncommitted unless validated, reviewed and explicitly committed to isolated test DB.

## Current-Code Findings

- parsers/src/andromeda_parser/cli.py defaults ingest stage --base to data/bmstu-2026.
- parsers/src/andromeda_parser/bundle.py copies that base and records bundle digest without a DB release ID.
- academic-data/src/academic_data_service/importer/persistence.py uses a per-candidate digest lock and reads active pointer only at activation; it has no expected-base check, export or rollback.
- Fact immutability triggers already exist; activation history is not exposed.
- Review is CSV-only, without diff, safe group decision, reviewer audit or rejected-item replay.
- BmstuSource._capture_live paginates the full catalog and fetches every detail/plan and admission order; it is too broad for requested live validation.
- Strict read DTOs, AcademicDataQueries and SQL read repository already exist; FastAPI does not.
- Current CI uses PostgreSQL 16 and 17 tests. There is no recorded live source verification.

## Requirements Reconciliation

Authority: this request governs behavior; current importer/schema/parser contracts constrain implementation. The earlier goal objective is architectural background only.

| Decision / supported combination | Source path and section | Verification evidence |
|---|---|---|
| Build from exported active release with exact release ID/digest; bootstrap explicitly only with no active release. | This request §1; parser CLI; importer persistence | Export/stale-base PG tests |
| Preserve every normalized bundle file; legacy adoption requires exact input digest, never an implicit old snapshot. | This request §1; BundleReader; release schema | Export round-trip, tamper and mismatch rejection |
| Serialize commit and rollback under one lock and compare active pointer inside transaction. | This request §1/§4; commit_projection | Stale and concurrent commit tests |
| Join only exact external keys. Missing rows become potential removals only under explicit complete scope; partial data cannot delete. | This request §2; capture manifest | Diff and partial fixture tests |
| Bulk accept only low-risk changed fields with exact target and provenance; audit actor/time/action/value/source. | This request §2 | CLI eligibility and append-only PG audit tests |
| Live probe uses explicit URL budget; 403/429 terminal; report is read-only and partial. | This request §3 | Mocked policy tests plus timestamped live report |
| Destructive cases use only localhost academic_data_test on PostgreSQL 16; no API/Directus/profile implementation. | This request §4/5; settings.py | DB target guard, CI and docs review |

## Architecture and Decisions

- Keep the existing capture → parse → candidate → exact-key review → validate/map → PostgreSQL release flow.
- Store a deterministic compressed copy of each committed importer bundle with its immutable release. Export checks archive hash and importer digest before returning a validated bundle.
- A legacy release without archive requires explicit digest-verified adoption; without matching input, fail closed. Never infer from data/bmstu-2026.
- Bundle update context records exact base release ID and digest. A shared transaction lock plus locked active-pointer comparison rejects stale candidates. Only already-active identical imports are no-op.
- Add append-only activation/rollback and review decision events; never mutate prior release facts.
- Diff matches external keys exactly, defaults sources to partial and has no fuzzy identity. Removals are report-only and require explicit completeness scope.
- Bulk review has an explicit dataset/field allowlist. New, ambiguous, conflicting, critical and removed rows remain individual. Rejected candidate and decision history can be replayed.
- Add bounded named live probes, separate from full catalog capture. Probe does not commit. Report only observed metadata/hash/parser results and source gaps.
- Use existing packages and PG16; no API/UI/service infrastructure.

## Phase Index

1. [Phase 1: Release artifacts and guarded lifecycle](phase-01-release-lifecycle.md) — Tasks 1–2
2. [Phase 2: Diff and moderation](phase-02-diff-moderation.md) — Tasks 3–4
3. [Phase 3: Bounded live validation](phase-03-live-validation.md) — Task 5
4. [Phase 4: End-to-end reliability](phase-04-test-matrix.md) — Task 6
5. [Phase 5: Documentation and publication](phase-05-docs-ci-publication.md) — Tasks 7–8

## Cross-Phase Dependencies

- Task 2 depends on Task 1: active export is required for optimistic commit.
- Task 3 depends on Task 1: diff needs current release bundle.
- Task 4 depends on Task 3: group review uses diff classes.
- Task 5 depends on Tasks 1 and 3: compare probe to current exact-key state.
- Task 6 depends on Tasks 1–5: exercise full implemented workflow.
- Task 7 depends on Task 6: docs state verified behavior/live findings.
- Task 8 depends on Tasks 6–7: publish only after full verification/docs.

## Tasks

### Phase 1: Release artifacts and guarded lifecycle
- [x] Task 1: Store and export a verifiable bundle for each immutable release ([details](phase-01-release-lifecycle.md#task-1-store-and-export-a-verifiable-bundle-for-each-immutable-release))
- [x] Task 2: Base updates on active releases and guard commit/rollback concurrency ([details](phase-01-release-lifecycle.md#task-2-base-updates-on-active-releases-and-guard-commitrollback-concurrency)) (depends on 1)

### Phase 2: Diff and moderation
- [x] Task 3: Produce exact-key classified diffs with partial-source safety ([details](phase-02-diff-moderation.md#task-3-produce-exact-key-classified-diffs-with-partial-source-safety)) (depends on 1)
- [x] Task 4: Add narrow bulk review, append-only decision audit, and rejected-item replay ([details](phase-02-diff-moderation.md#task-4-add-narrow-bulk-review-append-only-decision-audit-and-rejected-item-replay)) (depends on 3)

### Phase 3: Bounded live validation
- [x] Task 5: Add selected-source live probes and a DB comparison report ([details](phase-03-live-validation.md#phase-3-bounded-live-validation)) (depends on 1, 3)

### Phase 4: End-to-end reliability
- [x] Task 6: Verify five-update lifecycle, moderation, concurrency, rollback, and integrity on PostgreSQL 16 ([details](phase-04-test-matrix.md#task-6-verify-five-update-lifecycle-moderation-concurrency-rollback-and-integrity-on-postgresql-16)) (depends on 1–5)

### Phase 5: Documentation and publication
- [x] Task 7: Document operator workflow, API/Directus readiness, live findings, and limitations ([details](phase-05-docs-ci-publication.md#task-7-document-operator-workflow-api-directus-readiness-live-findings-and-limitations)) (depends on 1–6)
- [x] Task 8: Verify, publish to the existing repository, and confirm green Actions ([details](phase-05-docs-ci-publication.md#task-8-verify-publish-to-the-existing-repository-and-confirm-green-actions)) (depends on 6, 7; CI run 37551684272 passed on published `93ca411`)

## Commit Plan

- **Commit 1** (after Tasks 1–3): `feat(ingestion): export and guard immutable active releases`
- **Commit 2** (after Tasks 4–6): `feat(ingestion): add reviewed diff and bounded BMSTU validation`
- **Commit 3** (after Tasks 7–8): `docs(ingestion): document verified release operations`

## Definition of Done

- Every sequential update derives from the latest active export, carries expected release identity, preserves older accepted facts and rejects stale/concurrent publication.
- Release export round-trips all bundle files; archive, importer digest and legacy exact-digest adoption are verified.
- Diff has required categories, exact-key-only matching and partial-source safety. Bulk review skips unchanged/new/conflict/ambiguous/critical. Rejections can be re-reviewed and every commit stores audit source/value/operator/time.
- Rollback switches only the active pointer to a verified committed release and adds an audit event. Published releases are immutable.
- Five sequential operations plus all listed failure, integrity and reproducibility scenarios pass on isolated PostgreSQL 16 with local fixtures.
- Limited official-source live probe produces a dated report and exact DB comparison without altering active release.
- Docs describe only working behavior, live gaps, API/Directus readiness, remaining risk; GitHub Actions is green on published main.
