"""Active-release SQLAlchemy implementation of the academic data read port."""

from __future__ import annotations

import base64
import binascii
from typing import Any
from uuid import UUID

from andromeda_ontology.ports import InvalidCursorError, PageRows
from sqlalchemy import and_, func, or_, select
from sqlalchemy.engine import Connection

from andromeda_db.models import Base
from andromeda_db.models import admission_models as _admission_models
from andromeda_db.models import catalog_models as _catalog_models
from andromeda_db.models import evidence_models as _evidence_models
from andromeda_db.models import models as _lifecycle_models
from andromeda_db.models import source_models as _source_models
from andromeda_db.models import (
    subject_classification_models as _subject_classification_models,
)

_REGISTERED_MODELS = (
    _admission_models,
    _catalog_models,
    _evidence_models,
    _lifecycle_models,
    _source_models,
    _subject_classification_models,
)
EVIDENCE_BRIDGES: dict[str, tuple[str, str]] = {
    "universities": ("university_evidence", "university_id"),
    "directions": ("direction_evidence", "direction_id"),
    "departments": ("department_evidence", "department_id"),
    "direction_departments": ("direction_department_evidence", "direction_department_id"),
    "educational_programs": ("program_evidence", "program_id"),
    "educational_program_departments": (
        "program_department_evidence",
        "program_department_id",
    ),
    "catalog_courses": ("catalog_course_evidence", "course_id"),
    "study_plans": ("study_plan_evidence", "study_plan_id"),
    "curriculum_items": ("curriculum_evidence", "curriculum_item_id"),
    "admission_campaigns": ("campaign_evidence", "campaign_id"),
    "campaign_calendar_events": ("calendar_event_evidence", "calendar_event_id"),
    "program_offerings": ("offering_evidence", "offering_id"),
    "competition_pools": ("competition_pool_evidence", "pool_id"),
    "competition_pool_offerings": ("pool_offering_evidence", "pool_offering_id"),
    "place_quota_assertions": ("place_quota_evidence", "assertion_id"),
    "admission_requirement_sets": ("requirement_set_evidence", "requirement_set_id"),
    "admission_requirement_nodes": ("requirement_node_evidence", "requirement_node_id"),
    "offering_requirement_links": ("offering_requirement_evidence", "link_id"),
    "tuition_assertions": ("tuition_evidence", "tuition_assertion_id"),
    "historical_admission_statistics": ("historical_statistic_evidence", "statistic_id"),
    "admission_statistics": ("admission_statistic_evidence", "statistic_id"),
    "individual_achievement_policies": ("achievement_evidence", "achievement_policy_id"),
    "admission_documents": ("admission_document_evidence", "document_id"),
    "admission_document_pages": ("admission_document_page_evidence", "page_id"),
    "admission_result_sources": ("admission_result_source_evidence", "result_source_id"),
    "source_relationships": ("source_relationship_evidence", "relationship_id"),
    "manual_review_items": ("manual_review_evidence", "manual_review_id"),
    "admission_exams": ("exam_evidence", "exam_id"),
    "funding_types": ("funding_type_evidence", "funding_type_id"),
    "quota_types": ("quota_type_evidence", "quota_type_id"),
}


class NoActiveReleaseError(RuntimeError):
    """No committed release is available for active-release reads."""


class SQLAlchemyAcademicDataReadRepository:
    """Read canonical rows from one request-scoped, read-only connection."""

    def __init__(self, connection: Connection) -> None:
        self._connection = connection
        self._release_id: UUID | None = None
        self._release_key: str | None = None
        self._release: dict[str, Any] | None = None
        self._last_row_count: int | None = None
        self._by_id_cache: dict[tuple[str, UUID], dict[str, Any] | None] = {}
        self._related_cache: dict[tuple[str, str, UUID, tuple[tuple[str, Any], ...]], list[dict[str, Any]]] = {}
        self._related_count_cache: dict[tuple[str, str, UUID], int] = {}
        self._evidence_cache: dict[tuple[str, UUID], list[dict[str, Any]]] = {}
        self._manual_review_cache: dict[str, list[dict[str, Any]]] = {}

    @property
    def active_release_key(self) -> str:
        self._ensure_active_release()
        assert self._release_key is not None
        return self._release_key

    @property
    def release_key_if_loaded(self) -> str | None:
        return self._release_key

    @property
    def last_row_count(self) -> int | None:
        return self._last_row_count

    @property
    def active_release_id(self) -> UUID:
        self._ensure_active_release()
        assert self._release_id is not None
        return self._release_id

    def get(self, table_name: str, external_key: str) -> dict[str, Any] | None:
        table = self._table(table_name)
        row = (
            self._connection.execute(
                select(table).where(
                    table.c.release_id == self.active_release_id,
                    table.c.external_key == external_key,
                )
            )
            .mappings()
            .first()
        )
        self._last_row_count = 1 if row is not None else 0
        return dict(row) if row is not None else None

    def get_by_id(self, table_name: str, record_id: UUID) -> dict[str, Any] | None:
        cache_key = (table_name, record_id)
        if cache_key in self._by_id_cache:
            row = self._by_id_cache[cache_key]
            self._last_row_count = 1 if row is not None else 0
            return dict(row) if row is not None else None
        table = self._table(table_name)
        row = (
            self._connection.execute(
                select(table).where(
                    table.c.release_id == self.active_release_id,
                    table.c.id == record_id,
                )
            )
            .mappings()
            .first()
        )
        self._last_row_count = 1 if row is not None else 0
        value = dict(row) if row is not None else None
        self._by_id_cache[cache_key] = value
        return dict(value) if value is not None else None

    def get_by_ids(self, table_name: str, record_ids: list[UUID]) -> dict[UUID, dict[str, Any]]:
        """Read and cache a set of rows by internal ID in one release-scoped query."""
        ids = list(dict.fromkeys(record_ids))
        missing = [record_id for record_id in ids if (table_name, record_id) not in self._by_id_cache]
        if missing:
            table = self._table(table_name)
            rows = (
                self._connection.execute(
                    select(table).where(
                        table.c.release_id == self.active_release_id,
                        table.c.id.in_(missing),
                    )
                )
                .mappings()
                .all()
            )
            found = {row["id"]: dict(row) for row in rows}
            for record_id in missing:
                self._by_id_cache[(table_name, record_id)] = found.get(record_id)
            self._last_row_count = len(rows)
        return {
            record_id: dict(self._by_id_cache[(table_name, record_id)])
            for record_id in ids
            if self._by_id_cache[(table_name, record_id)] is not None
        }

    def active_release(self) -> dict[str, Any]:
        self._ensure_active_release()
        assert self._release is not None
        return self._release

    def page(
        self,
        table_name: str,
        *,
        filters: dict[str, Any] | None = None,
        limit: int = 50,
        cursor: str | None = None,
    ) -> PageRows:
        if not 1 <= limit <= 100:
            raise ValueError("limit must be between 1 and 100")
        table = self._table(table_name)
        base_filters = self._conditions(table, filters)
        count = self._connection.execute(
            select(func.count()).select_from(table).where(*base_filters)
        ).scalar_one()
        conditions = list(base_filters)
        if cursor is not None:
            conditions.append(table.c.external_key > decode_cursor(cursor))
        rows = (
            self._connection.execute(
                select(table).where(*conditions).order_by(table.c.external_key).limit(limit + 1)
            )
            .mappings()
            .all()
        )
        has_more = len(rows) > limit
        selected = rows[:limit]
        next_cursor = encode_cursor(str(selected[-1]["external_key"])) if has_more else None
        self._last_row_count = len(selected)
        return PageRows([dict(row) for row in selected], next_cursor, int(count))

    def related(
        self,
        table_name: str,
        foreign_key: str,
        parent_id: UUID,
        *,
        filters: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        cache_key = (table_name, foreign_key, parent_id, tuple(sorted((filters or {}).items())))
        if cache_key in self._related_cache:
            rows = self._related_cache[cache_key]
            self._last_row_count = len(rows)
            return [dict(row) for row in rows]
        table = self._table(table_name)
        if foreign_key not in table.c:
            raise ValueError(f"unknown relation column {foreign_key}")
        conditions = [
            table.c.release_id == self.active_release_id,
            table.c[foreign_key] == parent_id,
            *self._conditions(table, filters),
        ]
        rows = (
            self._connection.execute(
                select(table).where(*conditions).order_by(table.c.external_key)
            )
            .mappings()
            .all()
        )
        self._last_row_count = len(rows)
        result = [dict(row) for row in rows]
        self._related_cache[cache_key] = result
        return [dict(row) for row in result]

    def related_many(
        self,
        table_name: str,
        foreign_key: str,
        parent_ids: list[UUID],
        *,
        filters: dict[str, Any] | None = None,
    ) -> dict[UUID, list[dict[str, Any]]]:
        """Load related rows for many parents with one release-scoped query."""
        ids = list(dict.fromkeys(parent_ids))
        filter_key = tuple(sorted((filters or {}).items()))
        missing = [
            parent_id for parent_id in ids
            if (table_name, foreign_key, parent_id, filter_key) not in self._related_cache
        ]
        if missing:
            table = self._table(table_name)
            if foreign_key not in table.c:
                raise ValueError(f"unknown relation column {foreign_key}")
            rows = (
                self._connection.execute(
                    select(table).where(
                        table.c.release_id == self.active_release_id,
                        table.c[foreign_key].in_(missing),
                        *self._conditions(table, filters)[1:],
                    ).order_by(table.c[foreign_key], table.c.external_key)
                )
                .mappings()
                .all()
            )
            grouped = {parent_id: [] for parent_id in missing}
            for row in rows:
                grouped[row[foreign_key]].append(dict(row))
            for parent_id, result in grouped.items():
                self._related_cache[(table_name, foreign_key, parent_id, filter_key)] = result
            self._last_row_count = len(rows)
        return {
            parent_id: [
                dict(row)
                for row in self._related_cache[(table_name, foreign_key, parent_id, filter_key)]
            ]
            for parent_id in ids
        }

    def related_count(self, table_name: str, foreign_key: str, parent_id: UUID) -> int:
        cache_key = (table_name, foreign_key, parent_id)
        if cache_key in self._related_count_cache:
            self._last_row_count = 0
            return self._related_count_cache[cache_key]
        return self.related_counts(table_name, foreign_key, [parent_id])[parent_id]

    def related_counts(
        self, table_name: str, foreign_key: str, parent_ids: list[UUID]
    ) -> dict[UUID, int]:
        """Count release-scoped related rows for many parents with one grouped query."""
        ids = list(dict.fromkeys(parent_ids))
        missing = [
            parent_id
            for parent_id in ids
            if (table_name, foreign_key, parent_id) not in self._related_count_cache
        ]
        if missing:
            table = self._table(table_name)
            if foreign_key not in table.c:
                raise ValueError(f"unknown relation column {foreign_key}")
            rows = self._connection.execute(
                select(table.c[foreign_key], func.count().label("related_count"))
                .where(
                    table.c.release_id == self.active_release_id,
                    table.c[foreign_key].in_(missing),
                )
                .group_by(table.c[foreign_key])
            ).all()
            counts = {row[0]: int(row[1]) for row in rows}
            for parent_id in missing:
                self._related_count_cache[(table_name, foreign_key, parent_id)] = counts.get(
                    parent_id, 0
                )
            self._last_row_count = len(rows)
        return {
            parent_id: self._related_count_cache[(table_name, foreign_key, parent_id)]
            for parent_id in ids
        }

    def evidence_for(self, entity_table: str, entity_id: UUID) -> list[dict[str, Any]]:
        cache_key = (entity_table, entity_id)
        if cache_key in self._evidence_cache:
            rows = self._evidence_cache[cache_key]
            self._last_row_count = len(rows)
            return [dict(row) for row in rows]
        return self.evidence_for_many(entity_table, [entity_id]).get(entity_id, [])

    def evidence_for_many(
        self, entity_table: str, entity_ids: list[UUID]
    ) -> dict[UUID, list[dict[str, Any]]]:
        """Read provenance bridges for many rows without one query per record."""
        ids = list(dict.fromkeys(entity_ids))
        bridge_spec = EVIDENCE_BRIDGES.get(entity_table)
        if bridge_spec is None:
            return {entity_id: [] for entity_id in ids}
        missing = [entity_id for entity_id in ids if (entity_table, entity_id) not in self._evidence_cache]
        if not missing:
            return {
                entity_id: [dict(row) for row in self._evidence_cache[(entity_table, entity_id)]]
                for entity_id in ids
            }
        bridge_name, target_field = bridge_spec
        bridge = self._table(bridge_name)
        evidence = self._table("source_evidence")
        artifacts = self._table("source_artifacts")
        joined = bridge.join(
            evidence,
            and_(
                bridge.c.release_id == evidence.c.release_id, bridge.c.evidence_id == evidence.c.id
            ),
        ).join(
            artifacts,
            and_(
                evidence.c.release_id == artifacts.c.release_id,
                evidence.c.source_artifact_id == artifacts.c.id,
            ),
        )
        rows = (
            self._connection.execute(
                select(
                    bridge.c[target_field].label("__entity_id"),
                    evidence.c.external_key.label("evidence_key"),
                    evidence.c.field_path,
                    evidence.c.locator,
                    evidence.c.claim,
                    evidence.c.quoted_fragment,
                    evidence.c.observed_at,
                    evidence.c.verification_status,
                    artifacts.c.external_key.label("source_artifact_key"),
                    artifacts.c.requested_url,
                    artifacts.c.final_url,
                    artifacts.c.fetched_at,
                    artifacts.c.sha256,
                )
                .select_from(joined)
                .where(
                    bridge.c.release_id == self.active_release_id,
                    bridge.c[target_field].in_(missing),
                )
                .order_by(bridge.c[target_field], evidence.c.external_key)
            )
            .mappings()
            .all()
        )
        grouped = {entity_id: [] for entity_id in missing}
        for row in rows:
            grouped[row["__entity_id"]].append(
                {key: value for key, value in dict(row).items() if key != "__entity_id"}
            )
        for entity_id, result in grouped.items():
            self._evidence_cache[(entity_table, entity_id)] = result
        self._last_row_count = len(rows)
        return {
            entity_id: [dict(row) for row in self._evidence_cache[(entity_table, entity_id)]]
            for entity_id in ids
        }

    def manual_reviews_for(self, external_key: str) -> list[dict[str, Any]]:
        if external_key in self._manual_review_cache:
            rows = self._manual_review_cache[external_key]
            self._last_row_count = len(rows)
            return [dict(row) for row in rows]
        return self.manual_reviews_for_many([external_key]).get(external_key, [])

    def manual_reviews_for_many(self, external_keys: list[str]) -> dict[str, list[dict[str, Any]]]:
        """Load review rows for a group of keys while preserving per-key deduplication."""
        keys = list(dict.fromkeys(external_keys))
        missing = [key for key in keys if key not in self._manual_review_cache]
        if not missing:
            return {key: [dict(row) for row in self._manual_review_cache[key]] for key in keys}
        table = self._table("manual_review_items")
        rows = (
            self._connection.execute(
                select(table)
                .where(
                    table.c.release_id == self.active_release_id,
                    or_(
                        table.c.subject_key.in_(missing),
                        table.c.source_key.in_(missing),
                        table.c.target_key.in_(missing),
                    ),
                )
                .order_by(table.c.external_key)
            )
            .mappings()
            .all()
        )
        grouped = {key: [] for key in missing}
        for row in rows:
            value = dict(row)
            matching_keys = {
                key for key in (row["subject_key"], row["source_key"], row["target_key"])
                if key in grouped
            }
            for key in matching_keys:
                grouped[key].append(value)
        for key, result in grouped.items():
            self._manual_review_cache[key] = result
        self._last_row_count = len(rows)
        return {key: [dict(row) for row in self._manual_review_cache[key]] for key in keys}

    def subject_classifications_for(
        self,
        subject_type: str,
        subject_ids: list[UUID],
        taxonomy_key: str,
        taxonomy_version: str,
    ) -> dict[UUID, dict[str, Any]]:
        """Return the latest immutable Jev result per typed subject row."""

        if subject_type == "catalog_course":
            target_column = "catalog_course_id"
        elif subject_type == "curriculum_item":
            target_column = "curriculum_item_id"
        else:
            raise ValueError("unsupported subject type")
        if not subject_ids:
            return {}

        classifications = self._table("subject_classifications")
        runs = self._table("subject_classification_runs")
        categories = self._table("subject_taxonomy_categories")
        subject_id_column = classifications.c[target_column]
        ranked = (
            select(
                subject_id_column.label("subject_id"),
                classifications.c.taxonomy_key,
                classifications.c.taxonomy_version,
                classifications.c.category_code,
                categories.c.name.label("category_name"),
                classifications.c.confidence,
                classifications.c.probabilities,
                classifications.c.jev_answer,
                classifications.c.review_reasons,
                classifications.c.review_status,
                runs.c.external_key.label("run_key"),
                runs.c.resolved_model_version,
                func.row_number()
                .over(
                    partition_by=subject_id_column,
                    order_by=(runs.c.completed_at.desc(), runs.c.id.desc()),
                )
                .label("result_rank"),
            )
            .select_from(
                classifications.join(
                    runs,
                    and_(
                        classifications.c.release_id == runs.c.release_id,
                        classifications.c.run_id == runs.c.id,
                    ),
                ).join(
                    categories,
                    and_(
                        classifications.c.taxonomy_key == categories.c.taxonomy_key,
                        classifications.c.taxonomy_version == categories.c.taxonomy_version,
                        classifications.c.category_code == categories.c.category_code,
                    ),
                )
            )
            .where(
                classifications.c.release_id == self.active_release_id,
                classifications.c.taxonomy_key == taxonomy_key,
                classifications.c.taxonomy_version == taxonomy_version,
                subject_id_column.in_(subject_ids),
            )
            .subquery()
        )
        rows = self._connection.execute(select(ranked).where(ranked.c.result_rank == 1)).mappings()
        results: dict[UUID, dict[str, Any]] = {}
        for row in rows:
            results[row["subject_id"]] = {
                "taxonomy_key": row["taxonomy_key"],
                "taxonomy_version": row["taxonomy_version"],
                "category_code": row["category_code"],
                "category_name": row["category_name"],
                "confidence": row["confidence"],
                "probabilities": row["probabilities"],
                "model": row["resolved_model_version"],
                "run_key": row["run_key"],
                "review_status": row["review_status"],
                "review_reasons": row["review_reasons"],
            }
        return results

    def subject_taxonomy(self, taxonomy_key: str, taxonomy_version: str) -> dict[str, Any] | None:
        taxonomies = self._table("subject_taxonomies")
        categories = self._table("subject_taxonomy_categories")
        taxonomy = (
            self._connection.execute(
                select(taxonomies).where(
                    taxonomies.c.taxonomy_key == taxonomy_key,
                    taxonomies.c.taxonomy_version == taxonomy_version,
                )
            )
            .mappings()
            .first()
        )
        if taxonomy is None:
            self._last_row_count = 0
            return None
        category_rows = self._connection.execute(
            select(categories)
            .where(
                categories.c.taxonomy_key == taxonomy_key,
                categories.c.taxonomy_version == taxonomy_version,
            )
            .order_by(categories.c.ordinal)
        ).mappings()
        self._last_row_count = 1
        return {
            **dict(taxonomy),
            "categories": [
                {
                    "category_code": row["category_code"],
                    "ordinal": row["ordinal"],
                    "name": row["name"],
                    "definition": row["definition"],
                }
                for row in category_rows
            ],
        }

    def _ensure_active_release(self) -> None:
        if self._release_id is not None:
            return
        active = self._table("active_data_release")
        releases = self._table("data_releases")
        row = (
            self._connection.execute(
                select(releases)
                .select_from(active.join(releases, active.c.release_id == releases.c.id))
                .where(
                    active.c.slot_key == "active",
                    releases.c.status == "committed",
                    releases.c.reconciliation_status.in_(("passed", "passed_with_gaps")),
                )
            )
            .mappings()
            .first()
        )
        if row is None:
            raise NoActiveReleaseError("No committed data release is ready.")
        self._release_id = row["id"]
        self._release_key = row["release_key"]
        self._release = dict(row)

    def _conditions(self, table: Any, filters: dict[str, Any] | None) -> list[Any]:
        result: list[Any] = [table.c.release_id == self.active_release_id]
        for column_name, value in (filters or {}).items():
            if column_name not in table.c:
                raise ValueError(f"unsupported filter column {column_name}")
            result.append(table.c[column_name] == value)
        return result

    def _table(self, table_name: str) -> Any:
        table = Base.metadata.tables.get(table_name)
        if table is None:
            raise ValueError(f"unknown service table {table_name}")
        return table


def encode_cursor(external_key: str) -> str:
    return base64.urlsafe_b64encode(external_key.encode("utf-8")).decode("ascii").rstrip("=")


def decode_cursor(value: str) -> str:
    if not value or len(value) > 1024:
        raise InvalidCursorError("cursor is empty or too long")
    try:
        decoded = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4)).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError, ValueError) as error:
        raise InvalidCursorError("cursor is not a valid encoded external key") from error
    if not decoded or len(decoded) > 512:
        raise InvalidCursorError("cursor does not contain a valid external key")
    return decoded
