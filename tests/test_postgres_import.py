from __future__ import annotations

import os
import shutil
from pathlib import Path
from uuid import UUID

import pytest
from sqlalchemy import Engine, create_engine, text

from academic_data_service.importer.mapping import project_bundle
from academic_data_service.importer.persistence import (
    BundleImportError,
    commit_projection,
)
from academic_data_service.settings import Settings, load_settings


pytestmark = pytest.mark.integration
PROJECT_ROOT = Path(__file__).resolve().parents[1]
BUNDLE = PROJECT_ROOT / "data" / "bmstu-2026"


def _test_database() -> tuple[Engine, Settings]:
    if not os.environ.get("ACADEMIC_DATA_DATABASE_URL"):
        pytest.skip("set ACADEMIC_DATA_DATABASE_URL to the dedicated local PostgreSQL test DB")
    settings = load_settings()
    if (
        settings.environment != "test"
        or settings.database_name != "academic_data_test"
        or settings.database_host not in {"localhost", "127.0.0.1"}
    ):
        pytest.fail("integration tests may only use localhost academic_data_test in test mode")
    return create_engine(settings.database_url), settings


def _active_release(engine: Engine) -> UUID | None:
    with engine.connect() as connection:
        value = connection.execute(
            text("SELECT release_id FROM active_data_release WHERE slot_key = 'active'")
        ).scalar_one_or_none()
    return value


def _release_counts(engine: Engine, release_id: UUID) -> dict[str, int]:
    tables = (
        "directions",
        "departments",
        "educational_programs",
        "program_offerings",
        "competition_pools",
        "study_plans",
        "curriculum_items",
        "admission_requirement_sets",
        "admission_requirement_nodes",
        "admission_statistics",
        "historical_admission_statistics",
        "source_artifacts",
        "source_evidence",
        "source_observations",
        "source_relationships",
        "manual_review_items",
    )
    with engine.connect() as connection:
        return {
            table: connection.execute(
                text(f"SELECT count(*) FROM {table} WHERE release_id = :release_id"),
                {"release_id": release_id},
            ).scalar_one()
            for table in tables
        }


def test_commit_is_idempotent_and_failed_activation_rolls_back(tmp_path: Path) -> None:
    engine, settings = _test_database()
    try:
        projection = project_bundle(str(BUNDLE))
        first = commit_projection(engine, settings, projection)
        assert first["outcome"] in {"committed", "no_op"}
        active_before = _active_release(engine)
        assert active_before is not None

        counts_before = _release_counts(engine, active_before)
        assert counts_before["directions"] == 53
        assert counts_before["departments"] == 77
        assert counts_before["educational_programs"] == 152
        assert counts_before["program_offerings"] == 127
        assert counts_before["competition_pools"] == 940
        assert counts_before["study_plans"] == 152
        assert counts_before["curriculum_items"] == 14_165
        assert counts_before["admission_requirement_sets"] == 81
        assert counts_before["admission_requirement_nodes"] == 405
        assert counts_before["admission_statistics"] == 311
        assert counts_before["historical_admission_statistics"] == 783
        assert counts_before["source_artifacts"] == 498
        assert counts_before["source_evidence"] == 13_886
        assert counts_before["source_observations"] == 23_020
        assert counts_before["source_relationships"] == 3_478
        assert counts_before["manual_review_items"] == 560

        second = commit_projection(engine, settings, projection)
        assert second["outcome"] == "no_op"
        assert _active_release(engine) == active_before
        assert _release_counts(engine, active_before) == counts_before

        changed_bundle = tmp_path / "changed-bundle"
        shutil.copytree(BUNDLE, changed_bundle)
        readme = changed_bundle / "README.md"
        readme.write_text(readme.read_text(encoding="utf-8") + "\n", encoding="utf-8")
        changed_projection = project_bundle(str(changed_bundle))

        def fail_before_activation() -> None:
            raise BundleImportError("intentional integration-test failure")

        with pytest.raises(BundleImportError, match="rolled back"):
            commit_projection(
                engine,
                settings,
                changed_projection,
                before_activation=fail_before_activation,
            )

        assert _active_release(engine) == active_before
        assert _release_counts(engine, active_before) == counts_before
        with engine.connect() as connection:
            failed_release_count = connection.execute(
                text("SELECT count(*) FROM data_releases WHERE source_bundle_sha256 = :digest"),
                {"digest": changed_projection.input_digest},
            ).scalar_one()
            failed_batch_count = connection.execute(
                text("SELECT count(*) FROM import_batches WHERE source_bundle_sha256 = :digest AND status = 'failed'"),
                {"digest": changed_projection.input_digest},
            ).scalar_one()
            operators = dict(
                connection.execute(
                    text(
                        "SELECT operator, count(*) FROM admission_requirement_nodes "
                        "WHERE release_id = :release_id GROUP BY operator"
                    ),
                    {"release_id": active_before},
                ).all()
            )
        assert failed_release_count == 0
        assert failed_batch_count >= 1
        assert operators == {None: 284, "AND": 81, "OR": 40}
    finally:
        engine.dispose()
