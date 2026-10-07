<!-- aif:plan-mode:ultra -->
# Ultra Implementation Plan: Directus Internal Viewer UX

Mode: ultra
Branch: codex/directus-viewer-ux
Created: 2026-10-07

## Original Request

Работаем в существующем репозитории:

https://github.com/artemnoor/andromeda-bmstu-monorepo

Используй **AI Factory / AIF в режиме Ultra**.

# ВАЖНО: ОБЯЗАТЕЛЬНО ИСПОЛЬЗУЙ НЕСКОЛЬКО СУБАГЕНТОВ

Не выполняй эту задачу одним агентом последовательно.

В начале работы **обязательно запусти несколько независимых субагентов параллельно**, минимум **4**, лучше **5–6**, если система позволяет.

Раздели работу минимум так:

1. **Subagent A — Directus UX / Information Architecture**
2. **Subagent B — PostgreSQL / Directus relations / read model**
3. **Subagent C — Directus configuration / metadata / collections**
4. **Subagent D — testing / permissions / regression**
5. **Subagent E — documentation / developer experience**
6. При необходимости отдельный **Subagent F — audit текущей модели данных и API**

Субагенты должны реально работать **параллельно над независимыми частями**, а не запускаться формально.

Главный агент:
- распределяет задачи;
- ждёт результаты всех субагентов;
- проверяет противоречия между ними;
- объединяет изменения;
- запускает итоговые тесты;
- делает единый commit/PR.

Не допускай, чтобы несколько агентов одновременно редактировали один и тот же файл без координации.

---

# Цель

Превратить уже работающий **Directus read-only POC** в удобный внутренний визуализатор/админ-интерфейс Andromeda.

Не менять архитектуру canonical academic data.

Directus остаётся:

**READ ONLY для academic canonical data.**

Он нужен команде для удобного просмотра:

```text
МГТУ
→ направления
→ образовательные программы
→ кафедры
→ учебные планы
→ дисциплины
→ поступление
→ экзамены
→ требования
→ стоимость
→ статистика
→ источники/evidence
```

---

# 1. Сначала провести аудит текущего Directus

Один из субагентов должен отдельно изучить:

- `infra/compose.yaml`;
- `docs/DIRECTUS.md`;
- миграцию read-only ролей;
- `directus_read`;
- `academic_read`;
- текущие таблицы/relations;
- какие collections сейчас реально видит Directus;
- какие поля отображаются неудобно;
- какие relations сейчас выглядят как UUID;
- какие сущности вообще не стоит показывать обычному пользователю Directus.

Не меняй canonical schema без необходимости.

---

# 2. Сделать нормальную структуру навигации Directus

В Directus не должно быть ощущения «80 технических таблиц подряд».

Сгруппировать интерфейс примерно так:

```text
01. Каталог
    Университеты
    Направления
    Программы
    Кафедры

02. Учебные планы
    Учебные планы
    Дисциплины
    Классификация дисциплин

03. Поступление
    Кампании
    Program Offerings
    Экзамены
    Требования
    Места и квоты
    Стоимость
    Индивидуальные достижения

04. Статистика
    Текущая статистика
    Историческая статистика

05. Источники и качество данных
    Source Artifacts
    Evidence
    Manual Review
    Source Observations

06. Системное
    Active Release
```

Технические bridge/evidence/link таблицы, которые не нужны для повседневного просмотра, скрыть из основной навигации либо сгруппировать отдельно.

---

# 3. Человекочитаемые названия

Настроить display templates / display fields.

Например вместо:

```text
0f831d2e-...
```

в relation показывать:

```text
09.03.01 — Информатика и вычислительная техника
```

Вместо UUID программы:

```text
09.03.01-XX — Название программы
```

Для кафедры:

```text
ИУ5 — Системы обработки информации и управления
```

Для учебного плана:

```text
09.03.01-XX · 2026 · очная
```

Для дисциплины:

```text
Математический анализ · семестр 1
```

Для admission campaign:

```text
2026 · бакалавриат/специалитет
```

Для источника:

```text
BMSTU PDF · curriculum · 2026-...
```

Не дублировать данные ради display name, если Directus может использовать template.

---

# 4. Настроить relations

Особенно важны переходы:

```text
Direction
→ Programs
→ Study Plans
→ Curriculum Items
```

и:

```text
Program
→ Departments
```

и:

```text
Campaign
→ Offerings
→ Requirements
→ Exams
```

и:

```text
Fact
→ Evidence
→ Source Artifact
```

Нужно, чтобы пользователь Directus мог открыть программу и дальше провалиться в её связанные данные без ручного копирования UUID.

Если текущий `directus_read` не предоставляет необходимые FK для Directus relations, разрешается создать дополнительные **read-only projection tables/views**, но:

- не менять canonical data ради UI;
- не давать Directus write access;
- не дублировать бизнес-логику.

---

# 5. Сделать удобные представления

Настроить layouts / presets / bookmarks, где это поддерживается и можно сохранить конфигурацию воспроизводимо.

### Programs

Показывать:

- code;
- name;
- direction;
- department;
- campus;
- study plan;
- source status.

### Study Plans

Показывать:

- program;
- profile code;
- education year;
- study form;
- semester count;
- total hours;
- status;
- source document.

### Curriculum Items

Показывать:

- discipline;
- program / study plan;
- semester;
- credits;
- hours;
- lectures;
- practice;
- labs;
- assessment;
- department/chair;
- source/evidence.

Добавить удобные фильтры:

```text
program
semester
department
discipline
assessment type
```

### Admission

Фильтры:

```text
campaign year
direction
program
funding type
quota type
```

### Statistics

Фильтры:

```text
year
direction
department
budget / paid
```

---

# 6. Отдельно сделать Data Quality / Review экран

Это важно.

Сделать удобный просмотр:

```text
Manual Review
Data Gaps
Unresolved References
Source Evidence
```

Желательно отдельная dashboard-like страница или набор presets.

Должно быть быстро видно:

- какой факт проблемный;
- какая сущность;
- причина;
- источник;
- статус;
- release;
- evidence.

Directus пока не должен выполнять approve/publish.

Это только viewer.

---

# 7. Active Release

Сделать небольшой системный экран:

```text
Current active release
Release key
Committed at
Bundle SHA
Mapper version
Reconciliation status
Schema revision
```

Пользователь должен сразу видеть:

> какие данные сейчас считаются активными.

---

# 8. Source / Evidence UX

Для source artifacts показывать source type, URL, fetched_at, SHA-256, content type, status code, verification/storage status. URL кликабельный, если Directus это позволяет.

Evidence:

```text
entity
field
source
locator
verification status
observed_at
```

Не показывать лишние internal UUID как основные display fields.

---

# 9. Безопасность

Directus должен по-прежнему быть физически read-only на academic data.

Обязательно повторно проверить реальным runtime DB user: Directus НЕ МОЖЕТ выполнить `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `ALTER`, `DROP` на canonical academic tables. Он также не должен иметь доступ к данным, которые намеренно исключены из viewer. Directus admin UI не должен обходить PostgreSQL permissions. Metadata самого Directus может жить в `directus_meta`.

---

# 10. Не ломать API и ingestion

Не менять без необходимости `capture → parse → candidate → diff → review → commit → release → rollback`. Не менять FastAPI contracts ради Directus. Directus — consumer.

---

# 11. Не делать сейчас

Не добавлять полноценную moderation CMS, publish из Directus, applicant profiles, auth Andromeda, frontend, recommendation engine, Dagster, Kafka, Neo4j, Graph Explorer или отдельный repository.

---

# 12. Конфигурация должна быть воспроизводимой

Не настраивать всё только вручную внутри запущенного контейнера.

По возможности сохранить schema/config snapshots, Directus metadata configuration, relation definitions, display templates, collection settings, field visibility, presets/bookmarks и dashboards в воспроизводимом виде в репозитории. После `git clone; docker compose up` должно быть возможно восстановить тот же интерфейс без часов ручной настройки. Если Directus имеет ограничения на экспорт конкретного типа metadata — документировать минимальные ручные действия.

---

# 13. Тесты

Существующие тесты должны пройти. Добавить проверки минимум на Directus runtime collections, canonical DML/DDL запреты, hidden/excluded data, active release projection и release switch, resolvable relations, отсутствие schema changes от Directus metadata, API integration regression и ingestion regression. GitHub Actions должен быть зелёным.

---

# 14. Обязательно провести реальный smoke test

Запустить PostgreSQL и Directus в тестовой среде, авторизоваться в Directus и проверить вручную/API: Programs; Program → Study Plan; Study Plan → Curriculum Items; semester filter; Campaigns; Requirements/Exams; Statistics; Source Evidence; Active Release; блокировку изменения academic record на уровне DB.

Не ограничиваться unit tests.

---

# 15. Документация

Обновить `docs/DIRECTUS.md`, `docs/ARCHITECTURE.md`, `docs/KNOWN_ISSUES.md`, `README.md`; при необходимости добавить `docs/DIRECTUS_UX.md` с меню, collections, relations, display templates, filters/presets, data quality, запуском, восстановлением конфигурации и ограничениями.

---

# Definition of Done

Directus должен стать удобным внутренним интерфейсом, а не raw PostgreSQL browser: логичные группы, технические таблицы скрыты, UUID заменены человекочитаемыми значениями, relations работают, доступны пути Program → Plan → Curriculum и Campaign → Requirements/Exams, Evidence можно открыть от сущности, виден active release, академические данные физически read-only, конфигурация воспроизводима, real Directus smoke и все тесты зелёные, изменения остаются в этом monorepo.

# В конце отчёта ОБЯЗАТЕЛЬНО указать работу субагентов

Отдельным блоком `Subagents used` перечислить каждому имя/роль, задачу, исследованные или изменённые файлы/компоненты и результат. Если меньше четырёх агентов реально не запускались, задача не завершена. Также предоставить commit SHA, GitHub Actions run, тесты, доступные collections, настроенные relations, ограничения и оценку готовности Directus к роли внутренней админки.

Приоритет: удобство просмотра данных → корректные relations → безопасность read-only → воспроизводимость → визуальная полировка.

## Settings

- Testing: yes; unit, isolated PostgreSQL 16 integration, and live Directus smoke.
- Logging: verbose for local diagnostics; never log credentials, tokens, source payloads, or applicant-level data.
- Docs: yes.

## Research Context

No project Research artifact exists. Official Directus primary docs were consulted for collection metadata, relation metadata, and schema snapshots/apply:

- https://docs.directus.io/reference/system/collections
- https://docs.directus.io/reference/system/relations
- https://docs.directus.io/reference/system/schema
- https://docs.directus.io/self-hosted/cli

## Requirements Reconciliation

Authority: latest user request > existing repository architecture/security contracts > current Directus runtime/API behavior. No supplied architecture document supersedes the repository's current Directus boundary.

| Decision / supported combination | Source path and section | Verification evidence |
|---|---|---|
| Keep canonical academic schema and ingestion/release/API unchanged; Directus remains a read-only consumer | user request §§1, 9-11; `docs/ARCHITECTURE.md` — consumer boundary | migration diff contains no canonical changes; existing ingestion/API suites pass |
| Keep all 57 read projections in the exact repository manifest; Core registers 25 everyday collections in six visible groups and leaves 32 technical projections unregistered in the primary catalog. Hiding is navigation curation, not authorization. | user request §§2, 12; `infra/compose.yaml`; migration `DIRECTUS_READ_TABLES` | manifest-to-allowlist validation; authenticated collections API |
| Declare virtual relations only on exact existing UUID columns, with no database FK/schema mutation | user request §4; migration `f4b19a7c2d61...`; Directus Relations docs | manifest field validation; `/relations` response and nested relation reads; schema fingerprint unchanged |
| Use Directus display templates, field settings, global presets, and singleton metadata only when supported by pinned Directus 12.4.1 | user request §§3, 5, 7, 8; official collection/schema docs | metadata API smoke on pinned image; collection/preset/field metadata assertions |
| Treat Directus admin UI as untrusted: DB role rejects academic DML/DDL, while Directus metadata remains isolated in `directus_meta` | user request §9; `docs/DIRECTUS.md` — PostgreSQL boundary | real `andromeda_directus_runtime` privilege matrix and forbidden statements |
| No applicant result source, raw paths, or observation payload may leak into the viewer | user request §9; current `directus_read` projection contract | collection absence and column-query negative tests |
| Smoke must traverse programs/plans/items, admissions, sources/evidence, active release, filter/list layouts; fixtures/unit tests alone do not establish runtime usability | user request §14; existing smoke docs | PostgreSQL 16 + Directus 12.4.1 authenticated API/UI/API relation checks |
| Documentation must distinguish tested metadata from manual/unsupported behavior and no frontend/admin write flow is added | user request §§10-15 | reviewed README/DIRECTUS/ARCHITECTURE/KNOWN_ISSUES/DIRECTUS_UX docs |

## Architecture and Decisions

- Preserve PostgreSQL 16, SQLAlchemy/Alembic, immutable releases and `directus_read` disposable projection. Do not add a projection migration unless a concrete Directus limitation is proven by the pinned runtime.
- Store collection, field, relation, folder and preset settings as repository data. Apply collection/field/preset presentation through the Directus admin API after startup. For the pinned Directus 12.4.1 relation endpoint, creation attempts PostgreSQL FK DDL even with `schema: null`; the guarded local operator applier therefore writes only virtual relation and reverse-alias metadata rows in `directus_meta`, after API preflight. It never writes academic item data or academic schemas.
- The metadata applier fails closed unless the operator URL points to local PostgreSQL 16 `academic_data_test` or a local `*_dev` database, and it rejects the runtime role. Collection/folder presentation remains `schema: null`; relation metadata has no physical schema/FK.
- Hidden is navigation/UI curation only; it is not an authorization or confidentiality boundary. Excluded records must be absent from the projection itself.
- Active release display is sourced from the existing singleton-like `active_release` projection. No release activation or moderation endpoint is added.
- Presets/bookmarks are global only if pinned Directus version accepts null user/role/bookmark fields; otherwise document the smallest required operator action rather than weakening permissions.
- Authenticated Directus REST traversal and API metadata are verified on an isolated PG16 instance. No manual browser/Data Studio review was available, so visual polish and click behavior beyond REST paths remain unverified.

## Phase Index

1. [Phase 1: Audit and design lock](phase-01-audit-design.md) — Tasks 1-2
2. [Phase 2: Reproducible metadata and navigation](phase-02-metadata-navigation.md) — Tasks 3-4
3. [Phase 3: Permissions, regressions, and runtime smoke](phase-03-security-smoke.md) — Tasks 5-6
4. [Phase 4: Documentation and publication](phase-04-docs-delivery.md) — Task 7

## Cross-Phase Dependencies

- Task 2 depends on Task 1 because collection display metadata must be grounded in the exact projection columns and Directus 12.4.1 API behavior.
- Task 3 depends on Tasks 1-2 because the apply tool must reconcile the manifests against the curated allowlist and collection folders.
- Task 4 depends on Tasks 2-3 because presets, field layouts, Data Quality navigation and Active Release views must use configured collection/field names.
- Task 5 depends on Tasks 2-4 because manifest validation and runtime permission checks need final collection/relation/preset contracts.
- Task 6 depends on Tasks 3-5 because authenticated Directus smoke must apply metadata to isolated PostgreSQL 16 and verify both navigation and DB denial.
- Task 7 depends on Tasks 1-6 because documentation and publication must describe only smoke-verified behavior.

## Tasks

### Phase 1: Audit and design lock
- [x] Task 1: Audit Directus projection, roles, collections, and runtime gaps ([details](phase-01-audit-design.md#task-1-audit-directus-projection-roles-collections-and-runtime-gaps))
- [x] Task 2: Lock a projection-only UX and metadata contract ([details](phase-01-audit-design.md#task-2-lock-a-projection-only-ux-and-metadata-contract)) (depends on 1)

### Phase 2: Reproducible metadata and navigation
- [x] Task 3: Declare collections, folders, display templates, field visibility, and tabular presets ([details](phase-02-metadata-navigation.md#task-3-declare-collections-folders-display-templates-field-visibility-and-tabular-presets)) (depends on 1-2)
- [x] Task 4: Add idempotent metadata apply and exact virtual relation graph ([details](phase-02-metadata-navigation.md#task-4-add-idempotent-metadata-apply-and-exact-virtual-relation-graph)) (depends on 1-3)

### Phase 3: Permissions, regressions, and runtime smoke
- [x] Task 5: Verify projection allowlist, relations, and physical read-only boundary ([details](phase-03-security-smoke.md#task-5-verify-projection-allowlist-relations-and-physical-read-only-boundary)) (depends on 2-4)
- [x] Task 6: Run authenticated PostgreSQL 16 + Directus 12.4.1 workflow smoke ([details](phase-03-security-smoke.md#task-6-run-authenticated-postgresql-16--directus-1241-workflow-smoke)) (depends on 3-5)

### Phase 4: Documentation and publication
- [x] Task 7: Document restoration, limits, test evidence, and publish on this repository ([details](phase-04-docs-delivery.md#task-7-document-restoration-limits-test-evidence-and-publish-on-this-repository)) (depends on 1-6; docs published in PR #3 and full PR-head CI verified)

## Commit Plan

- **Single commit/PR** containing implementation, tests, docs, and AIF plan: `feat(directus): curate read-only viewer metadata`

## Definition of Done

- Directus 12.4.1 presents curated folders, readable display values, essential relations, data quality collections and the active release without exposing applicant data.
- The checked-in metadata can be applied repeatably after `docker compose up` with no hand-created collection/relation setup.
- Tests prove the real runtime DB login cannot mutate canonical/projection data or DDL, and excluded data is absent.
- Authenticated isolated PostgreSQL 16 + Directus smoke opens and follows the requested catalog/admission/source/release paths.
- Existing API and ingestion tests remain green; final GitHub Actions is green on the published commit.
- Changes remain in `andromeda-bmstu-monorepo`; no new services, database, frontend, canonical migration, or write API is introduced.

## Subagent Work

- **`directus_ux_ia` — Directus UX / information architecture:** audited `infra/compose.yaml`, `docs/DIRECTUS.md`, the read-only role/projection migration, pinned Directus behavior, and the navigation model. Identified the Core collection cap, the need to keep hidden as navigation-only, and that Directus 12.4.1 relation creation can attempt physical FK DDL. No files changed.
- **`pg_relations_readmodel` — PostgreSQL / relations / read model:** inspected migration `f4b19a7c2d61`, catalog/admission/evidence/source models, Compose, and permission checks. Mapped 57 projection tables and the relation paths; confirmed existing UUID columns suffice without academic schema changes. No files changed.
- **`directus_metadata_review` — Directus configuration / metadata:** independently reviewed `collections.json`, `relations.json`, and `apply_metadata.py`. Confirmed 57 collections, 25 Core-visible collections, 32 technical collections, 7 folders, 14 presets, and 97 metadata-only relations; noted stale relation rows are not pruned automatically. No files changed.
- **`directus_permissions_tests` — permissions / regression testing:** added `tests/test_directus_permissions.py` for the actual PostgreSQL runtime role, active-release projection, excluded applicant data, and academic DML/DDL denial. Main agent corrected a schema-privilege assertion after running against isolated PG16; final targeted result was 2 passed.
- **`directus_docs_dx` — documentation / developer experience:** updated `README.md`, `docs/DIRECTUS.md`, `docs/ARCHITECTURE.md`, `docs/KNOWN_ISSUES.md`, and `docs/DIRECTUS_UX.md`; documented the verified Program→Department path and remaining limits. Main agent updated `infra/directus/metadata/README.md` for final smoke scope.

## Local Verification Before Publication

- Previous complete local suite: `uv run pytest -q` — 57 passed, 1 skipped; the Directus authenticated runtime smoke was run separately against isolated PG16/Directus 12.4.1 and passed (1 passed).
- Final focused checks: `tests/test_directus_permissions.py` — 2 passed against the disposable localhost PostgreSQL 16 database; `tests/test_directus_metadata.py` — 5 passed; changed-file Ruff — passed; Compose config and `git diff --check` — passed.
- The disposable `andromeda-directus-ux-smoke` project was removed after the smoke. Existing local databases on ports 55433 and 55434 were not touched.
- PR #3 is open in `artemnoor/andromeda-bmstu-monorepo`; GitHub Actions passed on its PR head. The final run URL and SHA are included in the handoff.
