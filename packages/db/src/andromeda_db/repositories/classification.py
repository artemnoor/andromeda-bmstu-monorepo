"""Persistence operations for release-scoped subject classifications."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Engine, insert, select

from andromeda_db.models import catalog_models as _catalog_models  # noqa: F401
from andromeda_db.models import models as _lifecycle_models  # noqa: F401
from andromeda_db.models import (
    subject_classification_models as _classification_models,  # noqa: F401
)
from andromeda_db.models.base import Base


class ClassificationPersistenceError(RuntimeError):
    """A classification batch no longer matches the active database release."""


def load_active_classification_subjects(engine: Engine) -> dict[str, Any]:
    """Read active release identity and the exact catalog rows eligible for classification."""

    metadata = Base.metadata
    releases = metadata.tables["data_releases"]
    active = metadata.tables["active_data_release"]
    result: dict[str, Any] = {"release": None, "subjects": {}}
    with engine.connect() as connection:
        release = (
            connection.execute(
                select(
                    releases.c.id,
                    releases.c.source_bundle_sha256,
                    releases.c.release_key,
                    active.c.release_id,
                )
                .select_from(active.join(releases, active.c.release_id == releases.c.id))
                .where(active.c.slot_key == "active")
            )
            .mappings()
            .one_or_none()
        )
        if release is None:
            raise ClassificationPersistenceError(
                "the target database has no active data release"
            )
        result["release"] = dict(release)
        release_id = release["release_id"]
        for subject_type, table_name, name_column in (
            ("catalog_course", "catalog_courses", "name"),
            ("curriculum_item", "curriculum_items", "discipline_name"),
        ):
            table = metadata.tables[table_name]
            rows = connection.execute(
                select(
                    table.c.id,
                    table.c.external_key,
                    table.c[name_column].label("subject_name"),
                ).where(table.c.release_id == release_id)
            ).mappings()
            result["subjects"][subject_type] = [dict(row) for row in rows]
    return result


def persist_classification_batch(
    engine: Engine,
    *,
    expected_release_id: UUID,
    expected_source_digest: str,
    run_key: str,
    run_row: dict[str, Any],
    classification_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    """Atomically insert one complete run, provided its release is still active."""

    metadata = Base.metadata
    releases = metadata.tables["data_releases"]
    active = metadata.tables["active_data_release"]
    runs = metadata.tables["subject_classification_runs"]
    classifications = metadata.tables["subject_classifications"]
    with engine.begin() as connection:
        release = (
            connection.execute(
                select(
                    releases.c.id,
                    releases.c.source_bundle_sha256,
                    releases.c.release_key,
                )
                .select_from(active.join(releases, active.c.release_id == releases.c.id))
                .where(active.c.slot_key == "active")
                .with_for_update(of=active)
            )
            .mappings()
            .one_or_none()
        )
        if release is None:
            raise ClassificationPersistenceError(
                "the target database has no active data release"
            )
        if (
            release["id"] != expected_release_id
            or release["source_bundle_sha256"] != expected_source_digest
        ):
            raise ClassificationPersistenceError(
                "active release changed while the classification package was being imported"
            )

        existing = (
            connection.execute(
                select(runs.c.result_sha256, runs.c.classified_count).where(
                    runs.c.release_id == expected_release_id,
                    runs.c.external_key == run_key,
                )
            )
            .mappings()
            .one_or_none()
        )
        if existing is not None:
            if existing["result_sha256"] != run_row["result_sha256"]:
                raise ClassificationPersistenceError(
                    "classification run key conflicts with stored facts"
                )
            return {
                "status": "already_imported",
                "release_key": release["release_key"],
                "run_key": run_key,
                "classified_count": existing["classified_count"],
                "result_sha256": existing["result_sha256"],
            }

        connection.execute(insert(runs).values(run_row))
        for offset in range(0, len(classification_rows), 500):
            connection.execute(
                insert(classifications), classification_rows[offset : offset + 500]
            )
    return {
        "status": "imported",
        "release_key": release["release_key"],
        "run_key": run_key,
        "classified_count": len(classification_rows),
        "result_sha256": run_row["result_sha256"],
    }
