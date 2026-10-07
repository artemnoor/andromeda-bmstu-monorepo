<!-- aif:plan-mode:ultra -->
# Ultra Implementation Plan: BMSTU Live Identity, Read-Only API, and Directus POC

Mode: ultra
Branch: codex/readonly-api-directus-live-gaps
Created: 2026-10-07

## Original Request

Работаем в существующем репозитории:

https://github.com/artemnoor/andromeda-bmstu-monorepo

Используй **AI Factory / AIF в режиме Ultra**.

Текущий `main` уже содержит стабильное academic-data ядро, release lifecycle, exact-key moderation, rollback, provenance/evidence, PostgreSQL 16 и зелёный CI. Не переписывай эту часть и не создавай новый репозиторий.

Ориентируйся также на целевую архитектуру **ANDROMEDA_ARCHITECTURE_v1.1** как на архитектурный baseline.

# Главная цель

Перейти от готового data core к первому реально используемому backend/data-view контуру Andromeda:

**официальные источники МГТУ → ingestion → reviewed canonical PostgreSQL → FastAPI → Directus/read-only consumers**

На этом этапе НЕ делаем полноценный публичный frontend и НЕ переносим write-path модерации в HTTP.

---

## 1. Сначала исправить подтверждённые live-data gaps

Не выполнять массовый crawler.

Работать только с официальными публичными источниками МГТУ, с текущими rate limits, timeout, request budget и безопасным bounded probing.

По результатам текущего `LIVE_VALIDATION.md` решить следующие проблемы.

### 1.1. Учебные планы

Сейчас PDF реально парсится, например получено 113 строк, но строки не имеют надёжных importer-compatible exact external keys.

Необходимо:

- определить детерминированную схему identity для curriculum items;
- использовать program/study-plan identity + discipline identity + semester/position/другие действительно устойчивые признаки;
- не связывать записи только по похожему названию;
- обеспечить стабильность ключей между повторными загрузками одного плана;
- протестировать изменения предмета, часов, семестра и формы контроля;
- проверить отсутствие ложных дублей;
- сохранить provenance до исходного PDF.

### 1.2. Стоимость обучения

Сейчас live-parser даёт записи с `year-unspecified`.

Необходимо:

- найти в официальном источнике надёжный academic year/campaign identity;
- если год действительно невозможно установить — не угадывать;
- такие записи должны оставаться source gap / pending observation;
- при подтверждённом годе сформировать exact keys, совместимые с canonical tuition model.

### 1.3. Каталог программ

HTML-каталог сейчас не извлекает ссылки, хотя официальный API показывает данные.

Необходимо:

- понять, изменился ли markup или HTML-каталог фактически client-rendered;
- не добавлять browser automation без необходимости;
- если официальный API надёжнее — считать его главным catalog source и явно это документировать;
- HTML parser либо безопасно исправить, либо пометить как fallback/deferred, если источник больше не подходит.

### 1.4. Экзамены / места / квоты

Проверить только доступные официальные агрегированные источники.

Не собирать applicant-level данные.

Если источник не найден или exact mapping нельзя подтвердить — оставить явный gap. Ничего не придумывать.

После исправлений повторить bounded live probe и обновить `LIVE_VALIDATION.md`.

---

# 2. Реализовать read-only FastAPI

Добавить первый настоящий HTTP API поверх существующего `AcademicDataQueries`.

Не дублировать SQL/бизнес-логику внутри routers.

Структуру приблизить к целевой архитектуре, но не выполнять бессмысленный массовый rename существующих каталогов.

Можно добавить, например:

```text
services/api/
    app/
    routers/
    dependencies/
    main.py
    tests/
```

API должен читать **только один согласованный active release**.

## Минимальный публичный API v1

Реализовать read-only endpoints примерно следующего уровня:

```text
GET /api/v1/health
GET /api/v1/release

GET /api/v1/directions
GET /api/v1/directions/{key}

GET /api/v1/departments
GET /api/v1/departments/{key}

GET /api/v1/programs
GET /api/v1/programs/{key}

GET /api/v1/programs/{key}/study-plans
GET /api/v1/study-plans/{key}
GET /api/v1/study-plans/{key}/items

GET /api/v1/campaigns
GET /api/v1/campaigns/{key}/offerings

GET /api/v1/requirements
GET /api/v1/requirements/{key}

GET /api/v1/tuition

GET /api/v1/statistics
```

Если текущие DTO/query boundaries требуют немного другой структуры — используй существующие контракты, а не ломай их ради названий endpoint'ов.

## API должен поддерживать

- pagination;
- разумные limits;
- фильтрацию по exact keys;
- direction/program/department/campaign filters там, где они естественно поддерживаются;
- стабильный error envelope;
- `404` для отсутствующей сущности;
- release metadata;
- provenance/source references;
- data-gap status;
- AND/OR/AT_LEAST requirement trees без потери структуры.

Не отдавать applicant-level данные.

Добавить OpenAPI.

---

# 3. Проверить архитектурную границу API

Критически важно:

```text
FastAPI
    ↓
application/query layer
    ↓
repository
    ↓
PostgreSQL active release
```

Не делать:

```text
router → сырой SQL
```

и не делать:

```text
frontend/directus → canonical PostgreSQL write
```

Domain и query layer не должны зависеть от FastAPI.

---

# 4. Directus как первый визуализатор данных

Добавить **минимальный Directus POC** для внутренней команды.

Цель сейчас — не CMS и не сложная модерация.

Нужен удобный визуальный просмотр:

- программ;
- направлений;
- кафедр;
- учебных планов;
- дисциплин;
- admission campaigns;
- экзаменов/requirements;
- стоимости;
- статистики;
- источников/evidence.

## Главное ограничение

Directus на этом этапе должен быть **READ ONLY для academic canonical**.

Создай отдельную DB role / views, если это необходимо.

Directus runtime не должен иметь:

```text
INSERT
UPDATE
DELETE
ALTER
DROP
```

на canonical/release/evidence таблицах.

Даже Directus Admin UI не должен обходить это ограничение.

Проверить это integration/negative tests реальным DB user.

Если сложные таблицы неудобно показывать напрямую — создать read-only SQL views.

Не менять core schema через Directus.

---

# 5. Не переносить пока write-path в API

Существующий безопасный pipeline:

```text
capture
→ parse
→ diff
→ review
→ validate
→ commit
→ immutable release
```

оставить работающим.

FastAPI на этом этапе — преимущественно **read-only**.

Не переносить approve/publish в HTTP, пока не будет отдельно спроектирована полноценная proposal/audit/auth/idempotency модель из architecture v1.1.

Но подготовить документ с планом будущего:

```text
POST /admin/v1/proposals
POST /admin/v1/proposals/{id}/approve
POST /admin/v1/proposals/{id}/reject
POST /admin/v1/proposals/{id}/publish
```

без реализации write endpoints сейчас.

---

# 6. Пользовательский профиль пока не реализовывать

Отдельно зафиксировать будущую границу:

```text
Academic Data
```

и

```text
Applicant/User Data
```

— разные домены.

Профиль абитуриента, ЕГЭ, олимпиада, shortlist, предпочтения и результаты подбора нельзя записывать в immutable academic releases.

Пока только подготовить ADR/документ.

---

# 7. Тестирование

Добавить полноценные тесты.

Обязательно:

- API читает только active release;
- переключение active release меняет ответы API;
- один запрос не смешивает данные двух releases;
- pagination deterministic;
- invalid cursor;
- 404;
- requirement tree не теряет AND/OR/AT_LEAST;
- source/provenance присутствуют;
- unresolved data не превращаются в придуманные значения;
- Directus role физически не может изменить canonical;
- API runtime role не получает лишних DB permissions;
- live parser exact-key regression tests;
- curriculum identity stability;
- tuition year identity;
- повторный parse одного документа не создаёт дубль;
- PostgreSQL 16 integration tests;
- существующие ingestion tests продолжают проходить.

Добиться полностью зелёного GitHub Actions.

Не удалять существующие тесты ради зелёного CI.

---

# 8. Документация

Обновить:

```text
README.md
docs/ARCHITECTURE.md
docs/API_READINESS.md
docs/LIVE_VALIDATION.md
docs/KNOWN_ISSUES.md
```

Добавить:

```text
docs/API.md
docs/DIRECTUS.md
```

Если нужно — ADR для границы academic/user domains и API read/write separation.

Документация должна честно разделять:

- реализовано;
- протестировано на fixtures;
- проверено live;
- ещё не реализовано;
- source gaps.

---

# 9. Чего НЕ делать

Не добавляй сейчас:

- Dagster;
- Kafka;
- Neo4j;
- Graph Explorer;
- Kubernetes;
- applicant auth;
- recommendation engine;
- frontend;
- публичный write API;
- массовый crawler;
- новую БД;
- отдельный repository.

Не переписывай working release/importer architecture.

Не делай архитектурные переезды каталогов только ради соответствия красивой структуре.

Не удаляй историю миграций.

Не меняй production-БД или действующие развёртывания.

Не выдумывай данные и не скрывай unresolved references.

Не считай тесты на fixtures доказательством полной работоспособности live-парсинга.

---

# Definition of Done

Этап завершён, когда:

1. Проблемы identity учебных планов и tuition либо исправлены, либо строго зафиксированы как неподтверждаемые gaps.
2. Выполнена новая ограниченная live-проверка МГТУ.
3. Работает read-only FastAPI поверх active academic release.
4. Опубликован OpenAPI.
5. Directus позволяет визуально просматривать основные academic data.
6. Directus физически не может записывать в canonical.
7. Старый ingestion/review/release pipeline продолжает работать.
8. Все unit/integration/API/DB tests проходят.
9. GitHub Actions зелёный.
10. Изменения опубликованы в этом же andromeda-bmstu-monorepo.

В конце дай фактический отчёт:

- что изменено;
- какие live gaps исправлены;
- какие gaps остались;
- список API endpoints;
- что видно в Directus;
- какие DB permissions выставлены;
- результаты тестов;
- ссылку/ID GitHub Actions run;
- оставшиеся архитектурные риски;
- готова ли система после этого к подключению frontend Andromeda.

Приоритет:

**корректность данных → архитектурные границы → API usability → удобство просмотра → всё остальное.**

## Settings
- Testing: yes
- Logging: verbose
- Docs: yes

## Roadmap Linkage
Milestone: none
Rationale: .ai-factory/ROADMAP.md is absent; the explicit user request defines this delivery.

## Requirements Reconciliation
Authority: current explicit user request > compatible architecture baseline > historical goal-objective context. The current request explicitly authorizes read-only API/Directus and supersedes the earlier objective file's no-API/no-Directus scope.

| Decision / supported combination | Source path and section | Verification evidence |
|---|---|---|
| Preserve PG16, immutable releases, importer, exact-key moderation, provenance, and package boundaries; extend rather than rewrite. | Current request: opening scope and sections 3, 5, 9; repo: docs/ARCHITECTURE.md | Existing ingestion/release suite remains unchanged and passes. |
| Build read-only FastAPI and Directus POC; the older objective file's no-API/no-Directus instruction is historical context. | C:\CodexData\attachments\4aa86369-e614-4cf6-be84-2737d0a30840\goal-objective.md, Stage 6; current request, sections 2 and 4 | Read-only app/viewer implemented; no HTTP write methods. |
| Treat architecture v1.1 as proposed baseline and adopt only compatible boundaries; excluded Dagster, write API, and frontend remain out of scope. | C:\Users\Артём\Downloads\ANDROMEDA_ARCHITECTURE_v1.1 (1).md, status lines 3-7; sections 1.3, 6, 8 | Static boundary checks and final component inventory. |
| Curriculum identity is exact/stable; unproven tuition year stays unresolved; bounded public probes never publish data. | Current request, sections 1 and 7 | Local PDF/HTML fixtures plus a capped sanitized live report; DB release digest unchanged. |
| API uses existing query/repository, one release per request, source/gap metadata, and nested requirement operators. | Current request, sections 2-3 and 7; docs/API_READINESS.md | HTTP and PG16 tests for active switch, snapshot, provenance, gaps, cursor, AND/OR/AT_LEAST. |
| Directus is DB-enforced read-only on academic data; its system metadata is isolated. | Current request, section 4; architecture v1.1, sections 6.2-6.4 and 12 | Real restricted PG login negative tests for DML and DDL. |
| Applicant data remains separate; CLI review/publish remains the only academic write path. | Current request, sections 5-6; architecture v1.1, sections 1.3, 5, 8.2 | ADR and route/schema checks; existing ingestion tests pass. |

## Architecture and Decisions
- Keep the domain/query boundary in academic-data. Add HTTP orchestration under services/api; routers call AcademicDataQueries only.
- Create one connection/repository/query instance per request. Existing repository resolves and caches the active release ID; all query methods in the request use it.
- Keep FastAPI out of domain and query modules. Reuse contracts/v1 DTOs; add typed exam and quota DTO/query methods only where the application boundary has no existing reader.
- Create NOLOGIN groups andromeda_api_readonly and andromeda_directus_readonly. API receives explicit SELECT grants on the minimum existing tables its queries touch. Directus receives SELECT only on `directus_read`, a DB-maintained projection from active-release views, because Directus 12.4.1 does not introspect PostgreSQL views.
- Directus login may own only its metadata schema. Credentials are supplied outside Git. Its admin UI cannot expand PostgreSQL permissions.
- Curriculum identity is curriculum_item:<exact-study-plan-key>:row:<global-parsed-row-position>, matching the existing importer key convention. Resolve the study-plan key from the exact selected program card key; use the ordered data-row position rather than the PDF's printed row number, which can repeat across semesters. Discipline name, hours, semester, and assessment remain mutable facts, not fuzzy join keys. Reject missing plan identity.
- Tuition canonical keys require an explicit direction code and academic-year label parsed from the owning official section. Missing/ambiguous year remains a pending source observation with no canonical external key.
- Pin the Directus image to an official stable release verified during implementation; keep Directus under an opt-in Compose profile using the existing PG16 database.
- Do not add HTTP writes, proposal workflow, applicant profile storage, frontend, new database, mass crawler, or excluded architecture technologies.

## Phase Index
1. [Phase 1: Source identity and bounded validation](phase-01-source-identity.md) — Tasks 1-2
2. [Phase 2: Database read boundary](phase-02-database-read-boundary.md) — Task 3
3. [Phase 3: Read-only API](phase-03-read-only-api.md) — Task 4
4. [Phase 4: Directus viewer](phase-04-directus-viewer.md) — Task 5
5. [Phase 5: Verification and delivery](phase-05-verification-and-delivery.md) — Tasks 6-7

## Cross-Phase Dependencies
- Task 2 depends on Task 1 so live curriculum comparisons use the new exact identity.
- Task 3 depends on Tasks 1-2 so DB projections align with final parser/source-gap semantics.
- Task 4 and Task 5 depend on Task 3 so API and Directus use the approved least-privilege boundary.
- Task 6 depends on Tasks 1-5 and proves the complete contour on PG16.
- Task 7 depends on Tasks 1-6 and reports only verified implementation/live/CI evidence.

## Tasks

### Phase 1: Source identity and bounded validation
- [x] Task 1: Add stable curriculum-item identity and regression tests ([details](phase-01-source-identity.md#task-1-add-stable-curriculum-item-identity))
- [x] Task 2: Resolve tuition, catalog priority, and bounded source gaps ([details](phase-01-source-identity.md#task-2-resolve-tuition-catalog-and-bounded-live-gaps)) (depends on 1)

### Phase 2: Database read boundary
- [x] Task 3: Add least-privilege PostgreSQL roles and Directus projection ([details](phase-02-database-read-boundary.md#task-3-add-postgresql-roles-and-active-release-views)) (depends on 1, 2)

### Phase 3: Read-only API
- [x] Task 4: Add FastAPI v1 over the query layer ([details](phase-03-read-only-api.md#task-4-add-fastapi-v1-read-endpoints)) (depends on 3)

### Phase 4: Directus viewer
- [x] Task 5: Add opt-in Directus read-only POC ([details](phase-04-directus-viewer.md#task-5-add-the-directus-viewer)) (depends on 3)

### Phase 5: Verification and delivery
- [x] Task 6: Verify API, parser, roles, Directus, and ingestion on PostgreSQL 16 ([details](phase-05-verification-and-delivery.md#task-6-verify-the-complete-read-contour)) (depends on 1-5)
- [ ] Task 7: Document the results and publish to the existing repository ([details](phase-05-verification-and-delivery.md#task-7-document-and-publish)) (depends on 1-6)

## Commit Plan
- **Commit 1** (after Tasks 1-3): feat: stabilize BMSTU identity and DB read roles
- **Commit 2** (after Tasks 4-5): feat: add read-only API and Directus viewer
- **Commit 3** (after Tasks 6-7): docs: verify BMSTU read contour and publish

## Definition of Done
- Curriculum keys are repeatable/exact and mutable fields update without name matching; uncertain rows fail closed.
- Tuition with unconfirmed year remains a source gap; catalog, exams, quotas, places, and dates reflect bounded official evidence.
- FastAPI is OpenAPI-described, query-layer-only, read-only, and consistent per release.
- Directus displays the transactionally refreshed active-release projection and cannot alter it or canonical data at the DB layer.
- PostgreSQL 16 tests and all existing ingestion tests pass; GitHub Actions is green on the published commit.
- README and requested docs distinguish implemented, fixture-tested, live-checked, not implemented, and source gaps.
