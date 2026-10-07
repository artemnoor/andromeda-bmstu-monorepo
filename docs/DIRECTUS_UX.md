# Directus navigation and data relationships

Previous: [Directus viewer](DIRECTUS.md) · Next: [Known limitations](KNOWN_ISSUES.md)

This page describes the repository-backed Directus 12.4.1 metadata in
[`infra/directus/metadata/collections.json`](../infra/directus/metadata/collections.json)
and
[`relations.json`](../infra/directus/metadata/relations.json). Apply it with
[`apply_metadata.py`](../infra/directus/metadata/apply_metadata.py) as
described in [Directus setup](DIRECTUS.md). The manifest defines seven
folders, 25 collections in the six everyday groups, and 32 technical
collections. Core mode registers the 25 everyday collections and six visible
folders. It leaves the technical collections and `90. Технические связи`
folder unregistered. Licensed mode can register the full 57-collection
catalog, including that hidden folder.

## Navigation

| Group | Collections shown in the everyday menu |
|---|---|
| **01. Каталог** | Университеты (`universities`), Направления (`directions`), Образовательные программы (`educational_programs`), Кафедры (`departments`) |
| **02. Учебные планы** | Учебные планы (`study_plans`), Дисциплины (`curriculum_items`), Классификация дисциплин (`catalog_courses`) |
| **03. Поступление** | Приёмные кампании (`admission_campaigns`), Предложения программ (`program_offerings`), Сроки и события кампаний (`campaign_calendar_events`), Экзамены (`admission_exams`), Наборы требований (`admission_requirement_sets`), Конкурсные группы (`competition_pools`), Места и квоты (`place_quota_assertions`), Стоимость обучения (`tuition_assertions`), Индивидуальные достижения (`individual_achievement_policies`), Виды финансирования (`funding_types`), Виды квот (`quota_types`) |
| **04. Статистика** | Текущая статистика приёма (`admission_statistics`), Историческая статистика (`historical_admission_statistics`) |
| **05. Источники и качество данных** | Ручная проверка (`manual_review_items`), Исходные документы (`source_artifacts`), Подтверждения источников (`source_evidence`), Неразобранные наблюдения (`source_observations`) |
| **06. Системное** | Активный релиз (`active_release`) |

In licensed mode, the hidden **90. Технические связи** folder groups
junctions, requirement tree nodes, source relationships, and entity-to-evidence
bridge collections. It is not registered in Core mode. `hidden` is a Data
Studio navigation setting, not an access-control boundary: API visibility is
governed by Directus permissions plus PostgreSQL grants.

## Display names and list defaults

Collection display templates use existing scalar fields; they do not copy
academic facts into new columns. Examples from the manifest:

| Collection | Display value |
|---|---|
| Direction | `code — name` |
| Program | `code — name` |
| Department | `official_code — name` |
| Study plan | `profile_code · education_year · study_form` |
| Curriculum item | `discipline_name · семестр semester` |
| Admission campaign | `year · campaign_kind` |
| Source artifact | `source_type · fetched_at` |
| Active release | `release_key` |

The metadata marks fields read-only in the Data Studio and hides technical
`id`, `release_id`, and `external_key` fields from ordinary item forms. These
are presentation settings; the PostgreSQL role is the enforcement boundary.

The manifest defines global default tabular layouts for 14 collections. They
set useful columns and initial sorting for programs, plans, curriculum items,
admissions, statistics, source/evidence, manual review, and active release.
The presets have an empty filter set: users can apply Directus filters from
available fields, but there are no named filter bookmarks or a dedicated
dashboard in this configuration.

Useful default columns include:

- Programs: code, name, direction, campus scope, study-plan URL.
- Study plans: program, profile code/name, year, study form, semesters, hours,
  and status.
- Curriculum items: plan, discipline, semester, credits, total/lecture/practice/
  lab hours, assessment, and chair.
- Admission: campaign, direction/program, department, study form, funding and
  quota, places, tuition year/amount/currency, and requirements metadata.
- Statistics: year, direction/department, funding, admission stage, outcome,
  scores, counts, and snapshot date where the collection provides them.
- Data quality: review status/reason/subject/source, artifact URL/hash/fetch
  metadata, and evidence field/locator/verification status.

Directus's project or per-user language must be set to Russian for the
`ru-RU` folder/collection translations to display. The metadata applier does
not alter user profiles or project settings. Source URLs appear as URL fields;
the manifest does not configure a custom clickable-link interface.

## Relationship paths

The relation manifest adds Directus metadata relationships to existing UUID
columns. It uses `schema: null`, so PostgreSQL receives no new foreign keys or
other schema changes. The current read model already contains the matching
identifier columns.

The manifest declares these navigation paths through existing UUID columns.
The authenticated API smoke verified several paths below, including
Program → Department as described after the diagram. Other configured paths
shown here were not asserted by that smoke:

```text
University → Directions → Programs → Study Plans → Curriculum Items
                         ↘ Department links (junction collection)

Campaign → Program Offerings → Requirement links → Requirement Sets
         → Calendar Events                         → Requirement Nodes → Exams
         → Competition Pools → Places and Quotas

Academic fact → entity evidence bridge → Source Evidence → Source Artifact
```

Program-to-department membership is represented through the
`educational_program_departments` junction collection, not a new direct
program/department fact. The smoke traversed the `department_links` alias to
`department_id.official_code`; a bounded scan of up to 25 programs returned at
least one department code. This confirms the relation path, not completeness
for every program. Similar link collections connect directions and
departments, competition pools and offerings, and offerings and requirement
sets. Requirement sets connect to their nodes; nodes can connect to child
nodes and entrance exams. Requirement tree operators remain the underlying
AND/OR/AT_LEAST values; Directus does not approve or rewrite them.

Evidence links pass through entity-specific bridge tables (for example,
`study_plan_evidence` or `curriculum_evidence`) to `source_evidence`, then to
`source_artifacts`. This preserves the academic fact's field locator and
source document without duplicating provenance. The bridge tables are grouped
as technical collections in licensed mode; the primary evidence and artifact
collections remain in the quality group. The smoke verified the curriculum
item → evidence → artifact path and the source-evidence → artifact path. Other
entity-specific evidence bridges are configured but were not all traversed.

Some curriculum rows in earlier releases have evidence only on their parent
study plan. Mapper v4 now projects a child-to-PDF evidence bridge where the
child resolves to one exact plan and that plan declares one successful,
SHA-256-identified PDF. The evidence locator says it is a plan-document
association and marks page/row as unavailable. Directus shows this only after
a reviewed successor release is published; immutable existing releases are
not patched in place.

## Data quality and active release

There is no custom dashboard. The **05. Источники и качество данных** group is
the current review surface:

- `manual_review_items` shows status, issue code, subject, summary, and source
  artifact reference.
- `source_evidence` shows the fact field, locator, verification status,
  observation time, and source artifact reference.
- `source_artifacts` shows source type, requested/final URL, fetch time,
  SHA-256, content type, HTTP status, and storage status.
- `source_observations` exposes only safe identifying metadata; raw observation
  payloads are intentionally absent.

There is no separate Directus collection for every data gap or unresolved
reference. `manual_review_items` shows open review records and
`source_observations` shows safe pending-source identifiers; the existing
[`GET /api/v1/data-gaps` API view](API.md) covers open manual-review records,
not every source observation. Use the ingestion reconciliation/review output
for the complete unresolved-reference picture.

This group is for inspection only. There are no Directus approve, reject,
review, or publish actions. Use the CLI review workflow for decisions.

The **06. Системное → Активный релиз** singleton exposes release key,
commit timestamp, source bundle SHA-256, mapper version, reconciliation
status, and schema revision. The projection is refreshed atomically when the
active pointer changes, so this row and other projected collections represent
the same active release.

## Configuration limits and smoke status

The repository config currently provides translated folders, collection
labels/templates, field visibility/order, 97 metadata-only relations, and 14
global tabular defaults. It does not include Directus role/policy definitions,
bookmarks, named filter presets, a dashboard, or project-language settings.
Applying the metadata does not remove unrelated existing Directus metadata.

An authenticated REST API smoke passed against isolated PostgreSQL 16 and
Directus 12.4.1 after applying and restarting Core-mode metadata. It verified
that the 25 collections are assigned to six visible folders, the technical
folder is not registered, and virtual relation rows have no physical schema.
It also traversed Program → Department via
`department_links.department_id.official_code` (a bounded scan of up to 25
programs returned at least one official department code), Program → Study Plan
→ Curriculum Items, filtered curriculum items by semester, Campaign →
Offerings, Requirement Sets → Nodes → Exams, Curriculum Item → Evidence →
Source Artifact, and Source Evidence → Source Artifact; read statistics and
Active Release; and verified that a release switch changes the active-release
response. The excluded
`admission_result_sources` collection returned HTTP 403. This is authenticated
API evidence, not a manual browser/Data Studio review. The licensed catalog
mode and exhaustive per-program relation completeness were not smoke-tested.
Exact coverage and test links are in
[Directus setup](DIRECTUS.md#smoke-checklist).

## See also

- [Directus setup, restore, and permissions](DIRECTUS.md)
- [Architecture and consumer boundaries](ARCHITECTURE.md)
- [Known limitations](KNOWN_ISSUES.md)
