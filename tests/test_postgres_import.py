from __future__ import annotations

import csv
import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from sqlalchemy import Engine, create_engine, text

from academic_data_service.importer.mapping import project_bundle
from academic_data_service.importer.persistence import (
    BundleImportError,
    commit_projection,
)
from academic_data_service.settings import Settings, load_settings
from andromeda_parser.bundle import build_candidate_bundle, materialize_reviewed_bundle
from andromeda_parser.ingest import capture_sources, parse_capture, write_parse_report


pytestmark = pytest.mark.integration
PROJECT_ROOT = Path(__file__).resolve().parents[1]
BUNDLE = PROJECT_ROOT / "data" / "bmstu-2026"
FIXTURE_DIR = PROJECT_ROOT / "tests" / "fixtures" / "bmstu" / "ingestion"
FIXTURE_STATISTIC_KEY = "admission_statistic:bmstu:2025:01.03.02:paid:direction"


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


def _review_fixture_statistic(tmp_path: Path) -> Path:
    capture = capture_sources(
        mode="fixture",
        fixture_dir=FIXTURE_DIR,
        output_dir=tmp_path / "capture",
    )
    parse_path = tmp_path / "parse-report.json"
    write_parse_report(parse_capture(capture.capture_dir), parse_path)
    candidate_dir = tmp_path / "candidate-bundle"
    build_candidate_bundle(
        base_bundle=BUNDLE,
        parse_report_path=parse_path,
        output_dir=candidate_dir,
    )
    candidates = [
        json.loads(line)
        for line in (candidate_dir / "data" / "bmstu_ingestion_candidates.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
    ]
    target = next(
        row for row in candidates
        if row["candidate_type"] == "typed_record"
        and row["target_dataset"] == "historical_admission_statistics.jsonl"
        and row["suggested_target"] == FIXTURE_STATISTIC_KEY
    )
    decisions_path = tmp_path / "review-decisions.csv"
    reviewed_at = datetime.now(timezone.utc).isoformat()
    with decisions_path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(
            stream,
            fieldnames=("external_key", "decision", "reviewed_at", "target_external_key"),
        )
        writer.writeheader()
        for row in candidates:
            decision = (
                "accept_observation" if row["candidate_type"] == "canonical_snapshot"
                else "accept_typed_fact" if row["external_key"] == target["external_key"]
                else "reject"
            )
            writer.writerow({
                "external_key": row["external_key"],
                "decision": decision,
                "reviewed_at": reviewed_at,
                "target_external_key": FIXTURE_STATISTIC_KEY if decision == "accept_typed_fact" else "",
            })
    reviewed_dir = tmp_path / "reviewed-bundle"
    materialize_reviewed_bundle(
        candidate_dir=candidate_dir,
        decisions_path=decisions_path,
        output_dir=reviewed_dir,
    )
    return reviewed_dir


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

        reviewed_dir = _review_fixture_statistic(tmp_path)
        fixture_projection = project_bundle(str(reviewed_dir))
        fixture_commit = commit_projection(engine, settings, fixture_projection)
        assert fixture_commit["outcome"] == "committed"
        fixture_release = _active_release(engine)
        assert fixture_release == UUID(fixture_commit["active_release_id"])
        assert fixture_release != active_before
        with engine.connect() as connection:
            persisted = connection.execute(
                text(
                    "SELECT admitted_count, minimum_score, maximum_score "
                    "FROM historical_admission_statistics "
                    "WHERE release_id = :release_id AND external_key = :external_key"
                ),
                {"release_id": fixture_release, "external_key": FIXTURE_STATISTIC_KEY},
            ).one()
            evidence_count = connection.execute(
                text(
                    "SELECT count(*) FROM historical_statistic_evidence evidence "
                    "JOIN historical_admission_statistics statistic "
                    "ON statistic.release_id = evidence.release_id AND statistic.id = evidence.statistic_id "
                    "WHERE statistic.release_id = :release_id AND statistic.external_key = :external_key"
                ),
                {"release_id": fixture_release, "external_key": FIXTURE_STATISTIC_KEY},
            ).scalar_one()
        assert tuple(persisted) == (12, 201, 280)
        assert evidence_count > 0
        assert _release_counts(engine, active_before) == counts_before

        repeated_fixture_commit = commit_projection(engine, settings, fixture_projection)
        assert repeated_fixture_commit["outcome"] == "no_op"
        assert _active_release(engine) == fixture_release

        changed_bundle = tmp_path / "changed-bundle"
        shutil.copytree(reviewed_dir, changed_bundle)
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

        assert _active_release(engine) == fixture_release
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
                    {"release_id": fixture_release},
                ).all()
            )
        assert failed_release_count == 0
        assert failed_batch_count >= 1
        assert operators == {None: 284, "AND": 81, "OR": 40}

        # Re-import an unchanged baseline as a new release to leave the dedicated DB
        # in its original fact state after proving activation and rollback behavior.
        restored_bundle = tmp_path / "restored-baseline-bundle"
        shutil.copytree(BUNDLE, restored_bundle)
        restored_readme = restored_bundle / "README.md"
        restored_readme.write_text(
            restored_readme.read_text(encoding="utf-8") + f"\n<!-- restore {uuid4()} -->\n",
            encoding="utf-8",
        )
        restored = commit_projection(engine, settings, project_bundle(str(restored_bundle)))
        assert restored["outcome"] == "committed"
        restored_release = UUID(restored["active_release_id"])
        assert restored_release != fixture_release
        assert _release_counts(engine, restored_release) == counts_before
    finally:
        engine.dispose()
