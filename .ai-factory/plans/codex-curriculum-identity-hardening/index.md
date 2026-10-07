<!-- aif:plan-mode:ultra -->
# Ultra Implementation Plan: BMSTU Curriculum Identity Hardening

Mode: ultra
Branch: codex/curriculum-identity-hardening
Created: 2026-10-07

## Original Request

Работаем в существующем репозитории:

https://github.com/artemnoor/andromeda-bmstu-monorepo

Используй AI Factory / AIF в режиме Ultra.

Текущий main уже содержит стабильный ingestion pipeline, immutable releases, FastAPI read-only API, Directus read-only viewer и зелёный CI.

Не перестраивай архитектуру, не добавляй новые сервисы и не переходи пока к frontend.

Единственная задача

Устранить оставшийся риск в identity для curriculum_items.

Сейчас ключ строится примерно так:

curriculum_item:<study-plan-key>:row:<position>

Это стабильно при изменении названия, часов, семестра или формы контроля, но может массово сломать identity, если в официальный учебный план добавят, удалят или переставят строки.

Нужно сделать identity достаточно устойчивой для реальных последовательных обновлений учебных планов.

⸻

Требования

1. Сначала изучи существующую модель

Не начинай сразу менять ключи.

Проанализируй:

* текущий формат curriculum_items;
* существующие external keys;
* study_plan identity;
* поля дисциплины;
* semester;
* block/module/section, если есть;
* printed row number;
* source locator;
* order/position;
* assessment/control;
* часы;
* названия;
* provenance;
* реальные два fixture PDF и live-план, который уже дал 113/113 совпадений.

Определи, какие признаки действительно могут быть устойчивыми между версиями одного официального учебного плана.

Не используй mutable academic facts как единственный identity.

⸻

2. Спроектировать устойчивую identity

Цель:

одна и та же логическая строка учебного плана должна сохранять identity при:

* изменении часов;
* изменении формы контроля;
* изменении семестра;
* небольшом изменении названия;
* вставке другой дисциплины выше;
* удалении другой дисциплины выше;
* перестановке строк.

При этом разные дисциплины не должны случайно получить один ключ.

Допустима составная схема identity, например с использованием:

* exact study-plan key;
* официального кода дисциплины, если источник его даёт;
* структурного блока/раздела;
* устойчивого source identifier;
* нормализованного source identity;
* других реально подтверждённых признаков.

Но не придумывай код дисциплины, если его нет в источнике.

⸻

3. Не делать fuzzy matching источником истины

Похожее название само по себе не должно автоматически означать одну и ту же дисциплину.

Если две строки нельзя однозначно сопоставить:

old curriculum item
↔
new curriculum item

результат должен быть:

ambiguous / requires review

а не автоматический merge.

Допустимо использовать similarity только как подсказку reviewer, но не как автоматическую identity.

⸻

4. Сохранить обратную совместимость

У нас уже есть опубликованные releases с ключами:

curriculum_item:<plan>:row:<position>

Нельзя просто заменить все external keys и создать тысячи новых записей.

Нужно разработать безопасную миграционную стратегию.

Предпочтительно:

* существующий canonical key сохранять там, где соответствие доказано;
* при новой версии плана сопоставлять новую source row с существующим canonical item;
* создавать новый canonical identity только если действительно появилась новая логическая запись;
* удалённую/не найденную строку не удалять автоматически;
* неоднозначность направлять в review.

Не переписывать старые immutable releases.

⸻

5. Разделить canonical identity и source position

row position и printed row number должны остаться provenance/source locator, но не должны быть единственной canonical identity.

Например:

canonical curriculum item
    stable external_key
    ↓
source observation
    PDF hash
    page
    row
    printed row
    parsed position

Конкретную реализацию выбери после изучения существующей модели.

⸻

6. Проверка последовательных версий PDF

Добавь synthetic/regression tests.

Минимум следующие сценарии.

A. Исходный план

A
B
C
D

Получаем четыре canonical items.

B. Вставили новую дисциплину

A
NEW
B
C
D

Ожидание:

* A сохраняет key;
* B сохраняет key;
* C сохраняет key;
* D сохраняет key;
* NEW получает новый key.

C. Удалили строку

A
B
D

Ожидание:

* A/B/D сохраняют identity;
* C становится missing/potentially removed;
* C не удаляется автоматически.

D. Переставили строки

B
A
C
D

Ожидание:

* identity всех четырёх сохраняется.

E. Изменили часы

B:
144 h → 180 h

Ожидание:

тот же curriculum item, changed field, а не новая сущность.

F. Изменили assessment

зачёт → экзамен

тот же item.

G. Изменили semester

Если источник позволяет доказать, что это та же логическая дисциплина:

тот же item + change.

Если доказать нельзя:

review, а не автоматический merge.

H. Две одинаково называющиеся дисциплины

Проверить отсутствие ложного объединения.

I. Переименование дисциплины

Если нет другого стабильного идентификатора:

не делать автоматический fuzzy merge.

Выдать review candidate.

⸻

7. Проверить на реальных fixtures

После реализации обязательно прогнать оба существующих curriculum PDF fixtures.

Новая система не должна ухудшить текущий результат.

Для уже проверенного live-плана:

113 curriculum rows

должно сохраняться корректное сопоставление с существующим canonical release, если доказательство identity достаточно.

Если новый алгоритм не может доказать часть соответствий — честно зафиксировать их как review gaps.

Нельзя добиться 113/113 за счёт небезопасной эвристики.

⸻

8. Diff / review

Интегрируй новую identity с существующей схемой:

parse
→ candidate
→ diff
→ review
→ commit

Diff должен различать:

unchanged
changed
new
ambiguous
potentially_removed
conflicting

Перестановка строк сама по себе не должна создавать массовый diff.

⸻

9. Provenance

Для каждого curriculum item сохранять связь с:

* exact study-plan;
* source document;
* source SHA-256;
* page/row/position locator, если доступен;
* временем получения;
* parser version/contract, если это уже предусмотрено системой.

Нельзя терять возможность показать, откуда взялась конкретная дисциплина.

⸻

10. Не делать в этой задаче

Не добавляй:

* frontend;
* новые FastAPI endpoints без необходимости;
* Directus-функции;
* Dagster;
* Graph Explorer;
* Neo4j;
* новую БД;
* recommendation engine;
* массовый live crawler;
* пользовательские профили;
* новые unrelated migrations.

Не переписывай работающий ingestion/release/API/Directus контур.

⸻

11. Тесты

Все существующие тесты должны продолжить проходить.

Добавь отдельные regression tests для:

* insert row;
* delete row;
* reorder;
* mutable field change;
* duplicate titles;
* ambiguous match;
* repeated parse idempotency;
* old published-key preservation;
* provenance preservation;
* partial source;
* candidate review.

После изменений:

uv run pytest -q

должен быть полностью зелёным.

GitHub Actions также должен быть зелёным.

⸻

12. Документация

Обнови минимум:

docs/ARCHITECTURE.md
docs/KNOWN_ISSUES.md
docs/LIVE_VALIDATION.md

И отдельно коротко опиши:

docs/CURRICULUM_IDENTITY.md

Где должно быть:

* canonical identity;
* source identity;
* правила сопоставления;
* что считается ambiguous;
* когда создаётся новый item;
* почему fuzzy name match не является автоматическим;
* как старые row-based keys сохраняются;
* ограничения алгоритма.

⸻

Definition of Done

Задача выполнена, если:

1. Вставка строки в PDF не переименовывает остальные curriculum items.
2. Удаление строки не приводит к автоматическому удалению canonical fact.
3. Перестановка строк не создаёт массовые новые entities.
4. Изменение часов/control не меняет identity.
5. Неоднозначные случаи идут в review.
6. Старые immutable releases не переписываются.
7. Существующие canonical keys сохраняются там, где соответствие доказано.
8. Provenance не теряется.
9. Реальные fixture PDFs проходят regression tests.
10. Все существующие тесты проходят.
11. GitHub Actions зелёный.
12. Изменения опубликованы в этом же репозитории.

В конце дай отчёт:

* какая identity-схема выбрана;
* почему она устойчивее row-position;
* как сохраняется совместимость со старыми keys;
* что происходит при insert/delete/reorder;
* сколько реальных curriculum rows удалось точно сопоставить;
* сколько осталось ambiguous;
* результаты тестов;
* GitHub Actions run;
* оставшиеся ограничения.

Приоритет: корректная identity и отсутствие ложных merge > сохранение старых ключей > удобство реализации.

## Settings

- Testing: yes
- Logging: verbose
- Docs: yes

## Requirements Reconciliation

Authority: the current user request defines behavior; committed parser, importer, bundle, and fixture data define existing contracts. Saved live artifacts are evidence only for the exact run and source hash they describe.

| Decision / supported combination | Source path and section | Verification evidence |
|----------------------------------|-------------------------|-----------------------|
| Preserve a canonical external key only for a one-to-one exact match within the exact study plan. The PDF exposes no official discipline code; printed row/position is mutable locator data. `chair` is a department abbreviation, not a discipline identifier. | `parsers/src/andromeda/ingestion/universities/bmstu/parser/curriculum.py::_study_plan_records`; `parsers/src/andromeda/ingestion/universities/bmstu/parser/campaign_2026/curricula/parser.py::_attach_exact_identity`; `tests/fixtures/bmstu/ingestion/curriculum*.pdf` | Unit tests for row insertion, deletion, reorder, duplicate titles, and position-only changes. |
| Match exact losslessly normalized title and exact chair abbreviation within an exact plan; disregard hours, assessment, and (when the title is unique) semester. When repeated titles require semester to disambiguate, a changed semester is ambiguous. Similarity can populate reviewer hints only. | `parsers/src/andromeda/modules/disciplines/domain/identity.py::normalize_discipline_name`; `docs/INGESTION_OPERATIONS.md` exact-key review policy | Tests for mutable fields, rename review, and duplicate names. |
| Preserve existing `curriculum_item:<plan>:row:<n>` keys when matched; new identities are deterministic hashes of exact source identity signals. Keep released rows and immutable releases untouched. | `data/bmstu-2026/data/curriculum_items.jsonl`; `academic-data/src/academic_data_service/importer/mapping.py`; `docs/ARCHITECTURE.md` release lifecycle | Regression against all 113 rows of the selected current-release plan and no-key-rewrite assertions. |
| A complete selected plan may report unmatched old rows as `potentially_removed`; a partial/failed parse reports no removals. Review/diff never deletes a canonical fact. | `parsers/src/andromeda_parser/moderation.py::compare_candidate_bundle`; user requirements 6/8/11 | Scoped-completeness tests plus candidate materialization and base-row-preservation assertions. |
| Latest saved live compatibility artifact reports 113 exact matches for the old positional keys at the same release digest. The earlier `identity-recheck` artifact used a different `row:<printed>:occurrence` convention and reports 0; it is not proof for the selected design. The raw live PDF is not present in the tracked fixture corpus. | `docs/LIVE_VALIDATION.md`; ignored `artifacts/live-validation/probe-2026-10-07-identity-compat.json`; ignored `...identity-recheck.json` | Offline regression uses the exact 113-row plan in the checked-in bundle; report counts are stated separately from live re-fetch claims. |

## Architecture and Decisions

- Keep PostgreSQL schema, release lifecycle, API, Directus, and public importer contracts. No new service or migration is planned.
- Separate three values: the immutable canonical `external_key`, an exact source identity signature stored in the existing `source_row` JSON, and PDF source locators (page, printed row, parsed order) stored only as provenance.
- Use exact plan identity + losslessly normalized exact discipline label + exact chair abbreviation and available block/part context. New non-duplicate items receive a deterministic SHA-256 identity key. Hours, credits, and assessment are values, not identity. Semester is not used for a unique title; it is a disambiguator only inside a duplicate-title group.
- Preserve legacy row keys on one-to-one matches. A reviewer can explicitly map a renamed or otherwise ambiguous observation to an existing key; the decision journal records the target and actor. No similarity score selects a target.
- Reconciliation is scoped to the exact study plan. Unmatched old rows remain in the base bundle; scoped completeness only adds a `potentially_removed` review result.
- The current release export is the matching baseline. The checked-in snapshot is used only as the test/bootstrap source already prescribed by the pipeline.

## Phase Index

1. [Phase 1: Evidence and source contracts](phase-01-source-contracts.md) — Tasks 1-2
2. [Phase 2: Reconciliation and review integration](phase-02-reconciliation.md) — Task 3
3. [Phase 3: Regression, documentation, and delivery](phase-03-verification.md) — Tasks 4-5

## Cross-Phase Dependencies

- Task 2 depends on Task 1 because parser/domain fields must use the decided distinction between source identity, canonical key, and locator.
- Task 3 depends on Tasks 1-2 because reconciliation consumes the verified source signals and passes ambiguity through the existing exact-key review boundary.
- Task 4 depends on Tasks 1-3 because tests exercise the implemented parser-to-candidate-to-diff-to-review contract.
- Task 5 depends on Tasks 1-4 because documentation and publication must describe and verify the final behavior.

## Tasks

### Phase 1: Evidence and source contracts
- [x] Task 1: Add the conservative curriculum identity resolver ([details](phase-01-source-contracts.md#task-1-add-the-conservative-curriculum-identity-resolver))
- [x] Task 2: Preserve identity signals, duplicate rows, and source locators ([details](phase-01-source-contracts.md#task-2-preserve-identity-signals-duplicate-rows-and-source-locators)) (depends on 1)

### Phase 2: Reconciliation and review integration
- [x] Task 3: Reconcile active-release curriculum keys through diff and review ([details](phase-02-reconciliation.md#task-3-reconcile-active-release-curriculum-keys-through-diff-and-review)) (depends on 1, 2)

### Phase 3: Regression, documentation, and delivery
- [x] Task 4: Add sequence, ambiguity, provenance, fixture, and live-plan regressions ([details](phase-03-verification.md#task-4-add-sequence-ambiguity-provenance-fixture-and-live-plan-regressions)) (depends on 1-3)
- [ ] Task 5: Document the shipped contract and publish with green CI ([details](phase-03-verification.md#task-5-document-the-shipped-contract-and-publish-with-green-ci)) (depends on 1-4)

## Commit Plan

- **Commit 1** (after Tasks 1-3): `feat: reconcile BMSTU curriculum identities across plan revisions`
- **Commit 2** (after Tasks 4-5): `docs: document curriculum identity and regression evidence`

## Definition of Done

- The candidate pipeline uses exact, order-independent evidence to preserve old keys and produces deterministic keys for unambiguous new rows.
- Duplicate, renamed, and structurally unresolved rows stay visible as review candidates; no fuzzy match is auto-accepted.
- Insertions, deletions, reorder, mutable fact changes, repeated parsing, and partial sources are covered by tests against both PDF fixtures and the checked-in 113-row live-plan release slice.
- Both prior releases and the checked-in source bundle are unchanged; no Alembic migration is added.
- `uv run pytest -q` passes and the pushed branch's GitHub Actions checks are green.
- The requested docs describe observed behavior and distinguish the prior live report from a fresh live parse.
