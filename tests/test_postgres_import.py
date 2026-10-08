from __future__ import annotations

import csv
import hashlib
import json
import os
import shutil
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import URL
from sqlalchemy.exc import DBAPIError

from andromeda_api.application.importer.mapping import project_bundle
from andromeda_api.application.importer.persistence import BundleImportError, run_bundle_import
from andromeda_db.repositories.release_publication import publish_projection as commit_projection
from andromeda_api.application.importer.bundle import BundleReader
from andromeda_db.connection import verify_server_identity
from andromeda_api.application.operations.releases import (
    export_release_bundle,
    rollback_active_release,
)
from andromeda_api.application.settings import Settings, load_settings
from andromeda_parser.bundle import build_candidate_bundle, materialize_reviewed_bundle
from andromeda_parser.ingest import IngestionError, capture_sources, parse_capture, write_parse_report
from andromeda_parser.moderation import compare_candidate_bundle


pytestmark = pytest.mark.integration
PROJECT_ROOT = Path(__file__).resolve().parents[1]
BUNDLE = PROJECT_ROOT / "data" / "bmstu-2026"
FIXTURE_DIR = PROJECT_ROOT / "tests" / "fixtures" / "bmstu" / "ingestion"
FIXTURE_STATISTIC_KEY = "admission_statistic:bmstu:2025:01.03.02:paid:direction"


@pytest.fixture(scope="module", autouse=True)
def _reset_isolated_postgres_test_schema():
    """Make lifecycle tests repeatable; destructive DDL is guarded to one test DB."""

    if not os.environ.get("ACADEMIC_DATA_DATABASE_URL"):
        yield
        return
    settings = load_settings()
    if (
        settings.environment != "test"
        or settings.database_name != "academic_data_test"
        or settings.database_host not in {"localhost", "127.0.0.1"}
    ):
        pytest.fail("integration schema reset is restricted to localhost academic_data_test in test mode")
    engine = create_engine(settings.database_url)
    try:
        with engine.connect() as connection:
            identity = verify_server_identity(connection, settings)
            database_user = connection.execute(text("SELECT current_user")).scalar_one()
        if (
            identity["database_name"] != "academic_data_test"
            or identity["database_host"] not in {"localhost", "127.0.0.1"}
            or identity["server_major"] != 16
            or database_user != "andromeda_test"
        ):
            pytest.fail("integration schema reset target is not the dedicated local PostgreSQL 16 test database")
        with engine.begin() as connection:
            connection.execute(text("DROP SCHEMA IF EXISTS directus_read CASCADE"))
            connection.execute(text("DROP SCHEMA IF EXISTS academic_read CASCADE"))
            connection.execute(text("DROP SCHEMA IF EXISTS directus_meta CASCADE"))
            connection.execute(text("DROP SCHEMA public CASCADE"))
            connection.execute(text("CREATE SCHEMA public AUTHORIZATION andromeda_test"))
            connection.execute(text("GRANT ALL ON SCHEMA public TO andromeda_test"))
    finally:
        engine.dispose()
    from andromeda_api.cli import run_database_upgrade

    run_database_upgrade()
    yield


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
        "curriculum_evidence",
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


def _set_release_context(bundle: Path, release_id: UUID, digest: str) -> None:
    (bundle / "release_context.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "base_release_id": str(release_id),
                "base_source_bundle_sha256": digest,
            },
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )


def _export_release(engine: Engine, settings: Settings, release_id: UUID, output: Path) -> tuple[Path, dict]:
    with engine.connect() as connection:
        archive_format = connection.execute(
            text(
                "SELECT archive_format FROM data_release_bundle_artifacts "
                "WHERE release_id = :release_id"
            ),
            {"release_id": release_id},
        ).scalar_one_or_none()
    if archive_format is None:
        pytest.fail("integration test requires an archived active release")
    target = output.with_suffix(".zip") if archive_format == "source_zip_v1" else output
    exported = export_release_bundle(
        engine, settings, output_path=target, release_id=release_id
    )
    return target, exported


def _copy_bundle(source: Path, target: Path) -> Path:
    target.mkdir(parents=True, exist_ok=False)
    with BundleReader(source) as reader:
        for relative in reader._file_names():
            destination = target / Path(relative)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(reader.read_bytes(relative))
    return target


def _set_statistic(bundle: Path, *, external_key: str, admitted_count: int) -> None:
    path = bundle / "data" / "historical_admission_statistics.jsonl"
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    found = False
    for row in rows:
        if row.get("external_key") == external_key:
            row["admitted_count"] = admitted_count
            found = True
    if not found:
        raise AssertionError(f"integration statistic was not found: {external_key}")
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n" for row in rows),
        encoding="utf-8",
    )


def _wrap_requirement_with_at_least(bundle: Path) -> str:
    path = bundle / "data" / "admission_exam_requirements.jsonl"
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    selected = rows[0]
    selected["requirement_tree"] = {
        "operator": "AT_LEAST",
        "min_count": 1,
        "children": [selected["requirement_tree"]],
    }
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n" for row in rows),
        encoding="utf-8",
    )
    return str(selected["external_key"])


def _set_direction_name(bundle: Path, external_key: str, name: str) -> None:
    path = bundle / "data" / "directions.jsonl"
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    for row in rows:
        if row.get("external_key") == external_key:
            row["name"] = name
            break
    else:
        raise AssertionError(f"direction was not found: {external_key}")
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n" for row in rows),
        encoding="utf-8",
    )


def _wrap_requirement_with_nested_operators(bundle: Path) -> str:
    path = bundle / "data" / "admission_exam_requirements.jsonl"
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    selected = rows[0]
    leaves: list[dict] = []

    def collect_leaves(node: dict) -> None:
        exam = node.get("exam")
        if isinstance(exam, dict):
            leaves.append({"exam": exam})
            return
        for child in node.get("children", []):
            if isinstance(child, dict):
                collect_leaves(child)

    collect_leaves(selected["requirement_tree"])
    if len(leaves) < 2:
        raise AssertionError("nested requirement regression needs two exact exam leaves")
    selected["requirement_tree"] = {
        "operator": "AT_LEAST",
        "min_count": 1,
        "children": [
            {
                "operator": "AND",
                "children": [
                    {"operator": "OR", "min_count": 1, "children": leaves[:2]}
                ],
            }
        ],
    }
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n" for row in rows),
        encoding="utf-8",
    )
    return str(selected["external_key"])


def _statistic_values(engine: Engine, release_id: UUID, external_key: str) -> tuple[int | None, int | None, int | None]:
    with engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT admitted_count, minimum_score, maximum_score "
                "FROM historical_admission_statistics "
                "WHERE release_id = :release_id AND external_key = :external_key"
            ),
            {"release_id": release_id, "external_key": external_key},
        ).one()
    return tuple(row)


def _review_fixture_statistic(
    tmp_path: Path, *, base_bundle: Path, base_release_id: UUID, base_digest: str
) -> Path:
    capture = capture_sources(
        mode="fixture",
        fixture_dir=FIXTURE_DIR,
        output_dir=tmp_path / "capture",
    )
    parse_path = tmp_path / "parse-report.json"
    write_parse_report(parse_capture(capture.capture_dir), parse_path)
    candidate_dir = tmp_path / "candidate-bundle"
    build_candidate_bundle(
        base_bundle=base_bundle,
        parse_report_path=parse_path,
        output_dir=candidate_dir,
        base_release_id=str(base_release_id),
        base_source_bundle_sha256=base_digest,
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
        active_before = _active_release(engine)
        if active_before is None:
            baseline_bundle = tmp_path / "baseline-bundle"
            shutil.copytree(BUNDLE, baseline_bundle)
            baseline_readme = baseline_bundle / "README.md"
            baseline_readme.write_text(
                baseline_readme.read_text(encoding="utf-8")
                + f"\n<!-- pg test bootstrap {uuid4()} -->\n",
                encoding="utf-8",
            )
            first = commit_projection(
                engine, settings, project_bundle(str(baseline_bundle))
            )
            assert first["outcome"] == "committed"
            active_before = UUID(first["active_release_id"])
        assert active_before is not None
        base_bundle, base_export = _export_release(
            engine, settings, active_before, tmp_path / "base-release"
        )
        first = commit_projection(engine, settings, project_bundle(str(base_bundle)))
        assert first["outcome"] == "no_op"
        assert _active_release(engine) == active_before

        counts_before = _release_counts(engine, active_before)
        assert counts_before["directions"] == 53
        assert counts_before["departments"] == 77
        assert counts_before["educational_programs"] == 152
        assert counts_before["program_offerings"] == 127
        assert counts_before["competition_pools"] == 940
        assert counts_before["study_plans"] == 152
        assert counts_before["curriculum_items"] == 14_165
        assert counts_before["curriculum_evidence"] == 14_165
        assert counts_before["admission_requirement_sets"] == 81
        assert counts_before["admission_requirement_nodes"] == 405
        assert counts_before["admission_statistics"] == 311
        assert counts_before["historical_admission_statistics"] == 783
        assert counts_before["source_artifacts"] == 498
        assert counts_before["source_evidence"] == 19_153
        assert counts_before["source_observations"] == 23_020
        assert counts_before["source_relationships"] == 3_478
        assert counts_before["manual_review_items"] == 560

        second = commit_projection(engine, settings, project_bundle(str(base_bundle)))
        assert second["outcome"] == "no_op"
        assert _active_release(engine) == active_before
        assert _release_counts(engine, active_before) == counts_before

        reviewed_dir = _review_fixture_statistic(
            tmp_path,
            base_bundle=base_bundle,
            base_release_id=active_before,
            base_digest=base_export["source_bundle_sha256"],
        )
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
        _set_release_context(
            changed_bundle, fixture_release, fixture_commit["input_digest"]
        )
        readme = changed_bundle / "README.md"
        readme.write_text(
            readme.read_text(encoding="utf-8") + f"\n<!-- injected failure {uuid4()} -->\n",
            encoding="utf-8",
        )
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
        rollback = rollback_active_release(
            engine,
            settings,
            target_release_id=active_before,
            expected_active_release_id=fixture_release,
            reason="restore verified PostgreSQL fixture after rollback scenario",
        )
        assert rollback["outcome"] == "rolled_back"
        assert _active_release(engine) == active_before
        assert _release_counts(engine, active_before) == counts_before

        exported_bundle, exported = _export_release(
            engine, settings, active_before, tmp_path / "exported-active-release"
        )
        assert exported["source_bundle_sha256"] == base_export["source_bundle_sha256"]
        assert exported["reconciliation"]["reconciled"] is True
        with BundleReader(base_bundle) as source_reader, BundleReader(exported_bundle) as export_reader:
            assert source_reader.input_digest == export_reader.input_digest
            assert {item.relative_path: item.sha256 for item in source_reader.files} == {
                item.relative_path: item.sha256 for item in export_reader.files
            }
        exported_repeat = commit_projection(
            engine, settings, project_bundle(str(exported_bundle))
        )
        assert exported_repeat["outcome"] == "no_op"
        assert _active_release(engine) == active_before
        with engine.connect() as connection:
            archive_rows = connection.execute(
                text(
                    "SELECT count(*) FROM data_release_bundle_artifacts "
                    "WHERE release_id = :release_id"
                ),
                {"release_id": active_before},
            ).scalar_one()
        assert archive_rows == 1
        with pytest.raises(DBAPIError):
            with engine.begin() as connection:
                connection.execute(
                    text(
                        "UPDATE data_release_bundle_artifacts "
                        "SET archive_sha256 = :digest WHERE release_id = :release_id"
                    ),
                    {"digest": "0" * 64, "release_id": active_before},
                )
        assert _active_release(engine) == active_before
        with pytest.raises(DBAPIError):
            with engine.begin() as connection:
                connection.execute(
                    text(
                        "UPDATE release_activation_events SET reason = 'changed' "
                        "WHERE operation = 'rollback' AND active_release_id = :release_id"
                    ),
                    {"release_id": active_before},
                )
    finally:
        engine.dispose()


def test_stale_prepared_bundle_is_rejected_after_another_release_activates(
    tmp_path: Path,
) -> None:
    engine, settings = _test_database()
    try:
        base_release_id = _active_release(engine)
        assert base_release_id is not None, "run the PostgreSQL lifecycle test before stale-base test"
        base_bundle, base_export = _export_release(
            engine, settings, base_release_id, tmp_path / "stale-base"
        )
        before_counts = _release_counts(engine, base_release_id)

        winner_bundle = tmp_path / "winner-bundle"
        stale_bundle = tmp_path / "stale-bundle"
        shutil.copytree(base_bundle, winner_bundle)
        shutil.copytree(base_bundle, stale_bundle)
        _set_release_context(
            winner_bundle, base_release_id, base_export["source_bundle_sha256"]
        )
        _set_release_context(stale_bundle, base_release_id, base_export["source_bundle_sha256"])
        winner_readme = winner_bundle / "README.md"
        winner_readme.write_text(
            winner_readme.read_text(encoding="utf-8") + f"\n<!-- winner {uuid4()} -->\n",
            encoding="utf-8",
        )
        stale_readme = stale_bundle / "README.md"
        stale_readme.write_text(
            stale_readme.read_text(encoding="utf-8") + f"\n<!-- stale {uuid4()} -->\n",
            encoding="utf-8",
        )
        winner = commit_projection(
            engine, settings, project_bundle(str(winner_bundle))
        )
        assert winner["outcome"] == "committed"
        winner_id = UUID(winner["active_release_id"])
        assert winner_id != base_release_id

        with pytest.raises(BundleImportError, match="candidate base is stale"):
            commit_projection(engine, settings, project_bundle(str(stale_bundle)))
        assert _active_release(engine) == winner_id
        assert _release_counts(engine, base_release_id) == before_counts
        assert _release_counts(engine, winner_id) == before_counts
        with engine.connect() as connection:
            publication_count = connection.execute(
                text(
                    "SELECT count(*) FROM release_activation_events "
                    "WHERE operation = 'publish' AND previous_release_id = :previous "
                    "AND active_release_id = :active"
                ),
                {"previous": base_release_id, "active": winner_id},
            ).scalar_one()
        assert publication_count == 1

        rollback_active_release(
            engine,
            settings,
            target_release_id=base_release_id,
            expected_active_release_id=winner_id,
            reason="restore lifecycle test base after stale publisher check",
        )
        assert _active_release(engine) == base_release_id
        assert _release_counts(engine, base_release_id) == before_counts
    finally:
        engine.dispose()


def test_five_sequential_updates_preserve_every_previously_accepted_fact(
    tmp_path: Path,
) -> None:
    engine, settings = _test_database()
    external_key = FIXTURE_STATISTIC_KEY
    try:
        base_release_id = _active_release(engine)
        if base_release_id is None:
            seed = tmp_path / "seed-bundle"
            shutil.copytree(BUNDLE, seed)
            seed_readme = seed / "README.md"
            seed_readme.write_text(seed_readme.read_text(encoding="utf-8") + f"\n<!-- sequence seed {uuid4()} -->\n", encoding="utf-8")
            seeded = commit_projection(engine, settings, project_bundle(str(seed)))
            base_release_id = UUID(seeded["active_release_id"])
        assert base_release_id is not None

        base_bundle, base_export = _export_release(
            engine, settings, base_release_id, tmp_path / "sequence-base"
        )
        base_counts = _release_counts(engine, base_release_id)

        def assert_no_count_loss(previous: dict[str, int], release_id: UUID) -> dict[str, int]:
            current = _release_counts(engine, release_id)
            assert current.keys() == previous.keys()
            assert all(current[table] >= count for table, count in previous.items())
            return current

        source_rows = [
            json.loads(line)
            for line in (base_bundle / "data" / "historical_admission_statistics.jsonl").read_text(encoding="utf-8").splitlines()
        ]
        source_row = next(row for row in source_rows if row["external_key"] == external_key)
        original_count = source_row["admitted_count"]

        # 1: a reviewed-value change under the same exact key.
        update_one = _copy_bundle(base_bundle, tmp_path / "sequence-update-one")
        _set_release_context(update_one, base_release_id, base_export["source_bundle_sha256"])
        _set_statistic(update_one, external_key=external_key, admitted_count=original_count + 1)
        requirement_key = _wrap_requirement_with_at_least(update_one)
        first_projection = project_bundle(str(update_one))
        assert first_projection.report["requirement_operator_counts"]["AT_LEAST"] == 1
        first = commit_projection(engine, settings, first_projection)
        assert first["outcome"] == "committed"
        first_release_id = UUID(first["active_release_id"])
        first_counts = assert_no_count_loss(base_counts, first_release_id)
        assert _statistic_values(engine, first_release_id, external_key) == (
            original_count + 1,
            source_row["minimum_score"],
            source_row["maximum_score"],
        )
        with engine.connect() as connection:
            operators = dict(connection.execute(
                text(
                    "SELECT operator, count(*) FROM admission_requirement_nodes "
                    "WHERE release_id = :release_id AND operator IS NOT NULL GROUP BY operator"
                ),
                {"release_id": first_release_id},
            ).all())
            at_least_count = connection.execute(
                text(
                    "SELECT count(*) FROM admission_requirement_nodes node "
                    "JOIN admission_requirement_sets requirement "
                    "ON requirement.release_id = node.release_id "
                    "AND requirement.id = node.requirement_set_id "
                    "WHERE node.release_id = :release_id AND node.operator = 'AT_LEAST' "
                    "AND requirement.external_key = :external_key"
                ),
                {"release_id": first_release_id, "external_key": requirement_key},
            ).scalar_one()
        assert operators.get("AND", 0) > 0 and operators.get("OR", 0) > 0
        assert at_least_count == 1
        assert _release_counts(engine, first_release_id)["admission_requirement_nodes"] == base_counts["admission_requirement_nodes"] + 1
        assert _release_counts(engine, base_release_id) == base_counts

        # 2: add a separately keyed aggregate row while preserving update 1.
        second_base, second_export = _export_release(
            engine, settings, first_release_id, tmp_path / "sequence-second-base"
        )
        update_two = _copy_bundle(second_base, tmp_path / "sequence-update-two")
        _set_release_context(update_two, first_release_id, second_export["source_bundle_sha256"])
        added_key = f"{external_key}:sequential-addition:{uuid4()}"
        added = dict(source_row)
        added.update(
            {
                "external_key": added_key,
                "admission_year": 2022,
                "admitted_count": 7,
                "minimum_score": 210,
                "maximum_score": 310,
                "source_locator": {"sequence_test": str(uuid4())},
            }
        )
        statistics_path = update_two / "data" / "historical_admission_statistics.jsonl"
        statistics = [json.loads(line) for line in statistics_path.read_text(encoding="utf-8").splitlines()]
        statistics.append(added)
        statistics_path.write_text(
            "".join(json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n" for row in statistics),
            encoding="utf-8",
        )
        second_projection = project_bundle(str(update_two))
        second = commit_projection(engine, settings, second_projection)
        assert second["outcome"] == "committed"
        second_release_id = UUID(second["active_release_id"])
        second_counts = assert_no_count_loss(first_counts, second_release_id)
        assert _statistic_values(engine, second_release_id, external_key)[0] == original_count + 1
        assert _statistic_values(engine, second_release_id, added_key) == (7, 210, 310)
        with engine.connect() as connection:
            assert connection.execute(
                text(
                    "SELECT count(*) FROM admission_requirement_nodes "
                    "WHERE release_id = :release_id AND operator = 'AT_LEAST'"
                ),
                {"release_id": second_release_id},
            ).scalar_one() == 1
        assert _release_counts(engine, first_release_id)["historical_admission_statistics"] == base_counts["historical_admission_statistics"]
        assert _release_counts(engine, second_release_id)["historical_admission_statistics"] == base_counts["historical_admission_statistics"] + 1

        # 3: exporting and importing an unchanged active release is a true no-op.
        unchanged_bundle, unchanged_export = _export_release(
            engine, settings, second_release_id, tmp_path / "sequence-no-change"
        )
        assert unchanged_export["source_bundle_sha256"] == second["input_digest"]
        unchanged = commit_projection(engine, settings, project_bundle(str(unchanged_bundle)))
        assert unchanged["outcome"] == "no_op"
        assert _active_release(engine) == second_release_id
        second_counts = _release_counts(engine, second_release_id)
        assert second_counts["historical_admission_statistics"] == base_counts["historical_admission_statistics"] + 1

        # 4: block contradictory source values, then resolve with one explicit exact-key decision.
        capture = capture_sources(
            mode="fixture",
            fixture_dir=FIXTURE_DIR,
            output_dir=tmp_path / "sequence-conflict-capture",
        )
        parse_path = tmp_path / "sequence-conflict-parse.json"
        write_parse_report(parse_capture(capture.capture_dir), parse_path)
        conflict_candidate_dir = tmp_path / "sequence-conflict-candidate"
        build_candidate_bundle(
            base_bundle=unchanged_bundle,
            parse_report_path=parse_path,
            output_dir=conflict_candidate_dir,
            base_release_id=str(second_release_id),
            base_source_bundle_sha256=unchanged_export["source_bundle_sha256"],
        )
        candidate_path = conflict_candidate_dir / "data" / "bmstu_ingestion_candidates.jsonl"
        conflict_candidates = [json.loads(line) for line in candidate_path.read_text(encoding="utf-8").splitlines()]
        selected_candidate = next(
            row
            for row in conflict_candidates
            if row.get("candidate_type") == "typed_record"
            and row.get("target_dataset") == "historical_admission_statistics.jsonl"
            and row.get("suggested_target") == external_key
        )
        conflict_artifacts = [
            json.loads(line)
            for line in (conflict_candidate_dir / "source_artifacts.jsonl").read_text(encoding="utf-8").splitlines()
        ]
        other_artifact = next(
            row for row in conflict_artifacts if row["source_key"] != selected_candidate["source_artifact_key"]
        )
        contradiction = dict(selected_candidate)
        contradiction["external_key"] = f"bmstu_fact_candidate:sequence-conflict:{uuid4()}"
        contradiction["source_identity"] = f"{selected_candidate['source_identity']}:contradictory-source"
        contradiction["source_artifact_key"] = other_artifact["source_key"]
        contradiction_payload = json.loads(selected_candidate["payload_json"])
        contradiction_payload["admitted_count"] = int(contradiction_payload["admitted_count"]) + 10
        contradiction_payload["source_artifact_key"] = other_artifact["source_key"]
        contradiction_payload["source_artifact_keys"] = [other_artifact["source_key"]]
        contradiction_payload["source_sha256"] = other_artifact["sha256"]
        contradiction["payload_json"] = json.dumps(
            contradiction_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        )
        contradiction["payload_sha256"] = hashlib.sha256(
            contradiction["payload_json"].encode("utf-8")
        ).hexdigest()
        conflict_candidates.append(contradiction)
        candidate_path.write_text(
            "".join(json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n" for row in conflict_candidates),
            encoding="utf-8",
        )
        candidate_manifest_path = conflict_candidate_dir / "ingestion_candidate_manifest.json"
        conflict_manifest = json.loads(candidate_manifest_path.read_text(encoding="utf-8"))
        conflict_manifest["candidate_keys"].append(contradiction["external_key"])
        conflict_manifest["typed_candidate_count"] += 1
        candidate_manifest_path.write_text(
            json.dumps(conflict_manifest, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8"
        )
        conflict_report = compare_candidate_bundle(conflict_candidate_dir)
        conflict_keys = {
            row["candidate_key"]
            for row in conflict_report["records"]
            if row.get("target_external_key") == external_key
        }
        assert selected_candidate["external_key"] in conflict_keys
        assert contradiction["external_key"] in conflict_keys

        def write_conflict_review(path: Path, accepted_keys: set[str]) -> None:
            with path.open("w", encoding="utf-8", newline="") as stream:
                writer = csv.DictWriter(
                    stream,
                    fieldnames=("external_key", "decision", "reviewed_at", "target_external_key"),
                )
                writer.writeheader()
                for row in conflict_candidates:
                    if row["candidate_type"] == "canonical_snapshot":
                        decision = "accept_observation"
                    elif row["external_key"] in accepted_keys:
                        decision = "accept_typed_fact"
                    else:
                        decision = "reject"
                    writer.writerow(
                        {
                            "external_key": row["external_key"],
                            "decision": decision,
                            "reviewed_at": datetime.now(timezone.utc).isoformat(),
                            "target_external_key": row["suggested_target"] if decision == "accept_typed_fact" else "",
                        }
                    )

        both_review = tmp_path / "sequence-conflict-both.csv"
        write_conflict_review(both_review, conflict_keys)
        with pytest.raises(IngestionError, match="conflicting accepted sources target the same exact external key"):
            materialize_reviewed_bundle(
                candidate_dir=conflict_candidate_dir,
                decisions_path=both_review,
                output_dir=tmp_path / "sequence-conflict-blocked",
            )
        assert _active_release(engine) == second_release_id
        assert _release_counts(engine, second_release_id) == second_counts
        assert _statistic_values(engine, second_release_id, external_key)[0] == original_count + 1
        assert _statistic_values(engine, second_release_id, added_key) == (7, 210, 310)

        resolved_review = tmp_path / "sequence-conflict-resolved.csv"
        # Reject both contradictory candidates: the already accepted base fact
        # must remain unchanged until an operator deliberately selects a value.
        write_conflict_review(resolved_review, set())
        resolved_bundle = tmp_path / "sequence-conflict-resolved-bundle"
        materialize_reviewed_bundle(
            candidate_dir=conflict_candidate_dir,
            decisions_path=resolved_review,
            output_dir=resolved_bundle,
            actor="sequence-test-reviewer",
        )
        resolved_projection = project_bundle(str(resolved_bundle))
        resolved_commit = commit_projection(engine, settings, resolved_projection)
        assert resolved_commit["outcome"] == "committed"
        resolved_release_id = UUID(resolved_commit["active_release_id"])
        resolved_counts = assert_no_count_loss(second_counts, resolved_release_id)
        assert _statistic_values(engine, resolved_release_id, external_key)[0] == original_count + 1
        assert _statistic_values(engine, resolved_release_id, added_key) == (7, 210, 310)
        assert _release_counts(engine, second_release_id) == second_counts
        assert _release_counts(engine, resolved_release_id) == resolved_counts

        # 5: repeating the resolved import neither creates a release nor duplicates facts.
        repeated = commit_projection(engine, settings, resolved_projection)
        assert repeated["outcome"] == "no_op"
        assert _active_release(engine) == resolved_release_id
        assert _release_counts(engine, resolved_release_id) == resolved_counts
        assert _release_counts(engine, first_release_id)["historical_admission_statistics"] == base_counts["historical_admission_statistics"]
        assert _release_counts(engine, base_release_id) == base_counts
    finally:
        engine.dispose()


def test_concurrent_publishers_allow_only_one_candidate_from_the_same_base(
    tmp_path: Path,
) -> None:
    engine, settings = _test_database()
    concurrent_engine = create_engine(settings.database_url, pool_size=2, max_overflow=0)
    try:
        base_release_id = _active_release(engine)
        assert base_release_id is not None
        base_bundle, base_export = _export_release(
            engine, settings, base_release_id, tmp_path / "concurrent-base"
        )
        base_counts = _release_counts(engine, base_release_id)
        projections = []
        for label in ("left", "right"):
            candidate = _copy_bundle(base_bundle, tmp_path / f"concurrent-{label}")
            _set_release_context(candidate, base_release_id, base_export["source_bundle_sha256"])
            readme = candidate / "README.md"
            readme.write_text(readme.read_text(encoding="utf-8") + f"\n<!-- {label} {uuid4()} -->\n", encoding="utf-8")
            projections.append(project_bundle(str(candidate)))

        gate = Barrier(2)

        def publish(projection):
            gate.wait(timeout=60)
            try:
                return commit_projection(concurrent_engine, settings, projection)
            except BundleImportError as error:
                return {"outcome": "rejected", "error": str(error)}

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(publish, projection) for projection in projections]
            outcomes = [future.result(timeout=300) for future in futures]
        assert sum(item["outcome"] == "committed" for item in outcomes) == 1
        assert sum(item["outcome"] == "rejected" and "candidate base is stale" in item["error"] for item in outcomes) == 1
        winner_id = _active_release(engine)
        assert winner_id is not None and winner_id != base_release_id
        assert _release_counts(engine, base_release_id) == base_counts
        with engine.connect() as connection:
            winners = connection.execute(
                text(
                    "SELECT count(*) FROM release_activation_events "
                    "WHERE operation = 'publish' AND previous_release_id = :previous "
                    "AND active_release_id = :active"
                ),
                {"previous": base_release_id, "active": winner_id},
            ).scalar_one()
        assert winners == 1
        rollback_active_release(
            engine,
            settings,
            target_release_id=base_release_id,
            expected_active_release_id=winner_id,
            reason="restore base after concurrent publication test",
        )
        assert _active_release(engine) == base_release_id
        assert _release_counts(engine, base_release_id) == base_counts
    finally:
        concurrent_engine.dispose()
        engine.dispose()


def test_read_api_uses_one_active_release_and_directus_is_physically_read_only(
    tmp_path: Path,
) -> None:
    from urllib.parse import quote

    from fastapi.testclient import TestClient
    from sqlalchemy import event

    from andromeda_api.main import create_app

    engine, settings = _test_database()
    api_engine = None
    directus_engine = None
    api_password = uuid4().hex
    directus_password = uuid4().hex
    try:
        base_release_id = _active_release(engine)
        if base_release_id is None:
            bootstrap = commit_projection(engine, settings, project_bundle(str(BUNDLE)))
            assert bootstrap["outcome"] == "committed"
            base_release_id = UUID(bootstrap["active_release_id"])
        assert base_release_id is not None
        base_bundle, base_export = _export_release(
            engine, settings, base_release_id, tmp_path / "api-base-release"
        )
        with engine.connect() as connection:
            direction_key, old_direction_name = connection.execute(
                text(
                    "SELECT external_key, name FROM directions "
                    "WHERE release_id=:release_id ORDER BY external_key LIMIT 1"
                ),
                {"release_id": base_release_id},
            ).one()
            requirement_key = connection.execute(
                text(
                    "SELECT requirement.external_key FROM admission_requirement_sets requirement "
                    "JOIN admission_requirement_nodes node "
                    "ON node.release_id=requirement.release_id "
                    "AND node.requirement_set_id=requirement.id "
                    "WHERE requirement.release_id=:release_id AND node.parent_id IS NULL "
                    "ORDER BY requirement.external_key LIMIT 1"
                ),
                {"release_id": base_release_id},
            ).scalar_one()
            plan_key = connection.execute(
                text(
                    "SELECT plan.external_key FROM study_plans plan "
                    "JOIN study_plan_evidence evidence "
                    "ON evidence.release_id=plan.release_id AND evidence.study_plan_id=plan.id "
                    "WHERE plan.release_id=:release_id ORDER BY plan.external_key LIMIT 1"
                ),
                {"release_id": base_release_id},
            ).scalar_one()

        candidate = _copy_bundle(base_bundle, tmp_path / "api-changed-release")
        _set_release_context(candidate, base_release_id, base_export["source_bundle_sha256"])
        changed_direction_name = f"{old_direction_name} — API test release {uuid4().hex[:8]}"
        _set_direction_name(candidate, direction_key, changed_direction_name)
        requirement_key = _wrap_requirement_with_nested_operators(candidate)
        committed = commit_projection(engine, settings, project_bundle(str(candidate)))
        assert committed["outcome"] == "committed"
        new_release_id = UUID(committed["active_release_id"])
        assert new_release_id != base_release_id
        with engine.connect() as connection:
            new_release_key = connection.execute(
                text("SELECT release_key FROM data_releases WHERE id=:release_id"),
                {"release_id": new_release_id},
            ).scalar_one()

        with engine.begin() as connection:
            connection.execute(
                text(f"ALTER ROLE andromeda_api_runtime PASSWORD '{api_password}'")
            )
            connection.execute(
                text(f"ALTER ROLE andromeda_directus_runtime PASSWORD '{directus_password}'")
            )
        api_url = settings.parsed_database_url.set(
            username="andromeda_api_runtime", password=api_password
        )
        directus_url = settings.parsed_database_url.set(
            username="andromeda_directus_runtime", password=directus_password
        )
        api_engine = create_engine(api_url, pool_size=2, max_overflow=0)
        directus_engine = create_engine(directus_url, pool_size=1, max_overflow=0)
        app = create_app(settings=settings, engine=api_engine)

        with TestClient(app) as client:
            health = client.get("/api/v1/health")
            assert health.status_code == 200
            assert health.json()["active_release_key"] == new_release_key

            first_page = client.get("/api/v1/directions", params={"limit": 1}).json()
            assert first_page["page"]["release_key"] == new_release_key
            assert first_page["page"]["total_count"] > 1
            assert first_page["items"][0]["sources"]
            next_cursor = first_page["page"]["next_cursor"]
            assert next_cursor
            second_page = client.get(
                "/api/v1/directions", params={"limit": 1, "cursor": next_cursor}
            ).json()
            first_key = first_page["items"][0]["external_key"]
            second_key = second_page["items"][0]["external_key"]
            assert first_key < second_key

            invalid_cursor = client.get("/api/v1/directions", params={"cursor": "!"})
            assert invalid_cursor.status_code == 422
            assert invalid_cursor.json()["error"]["code"] == "invalid_cursor"
            missing = client.get("/api/v1/directions/no-such-exact-key")
            assert missing.status_code == 404
            assert missing.json()["error"]["code"] == "record_not_found"
            assert client.post("/api/v1/release").status_code == 405

            plan_response = client.get(f"/api/v1/study-plans/{quote(plan_key, safe='')}")
            assert plan_response.status_code == 200
            assert plan_response.json()["sources"]

            requirement_response = client.get(
                f"/api/v1/requirements/{quote(requirement_key, safe='')}"
            )
            tree = requirement_response.json()["root"]
            assert requirement_response.status_code == 200
            assert tree["operator"] == "AT_LEAST"
            assert tree["children"][0]["operator"] == "AND"
            assert tree["children"][0]["children"][0]["operator"] == "OR"

            tuition = client.get("/api/v1/tuition", params={"limit": 100}).json()
            assert all(
                "unspecified" not in (item["academic_year"] or "").casefold()
                for item in tuition["items"]
            )

            flipped = False

            def rollback_between_release_lookup_and_page(
                connection, cursor, statement, parameters, context, executemany
            ):
                nonlocal flipped
                normalized = " ".join(statement.casefold().split())
                if not flipped and normalized.startswith("select count(*)") and "from directions" in normalized:
                    flipped = True
                    rollback_active_release(
                        engine,
                        settings,
                        target_release_id=base_release_id,
                        expected_active_release_id=new_release_id,
                        reason="simulate active release change during one API request",
                        actor="api-integration-test",
                    )

            event.listen(api_engine, "before_cursor_execute", rollback_between_release_lookup_and_page)
            try:
                stable_snapshot = client.get("/api/v1/directions", params={"limit": 1}).json()
            finally:
                event.remove(api_engine, "before_cursor_execute", rollback_between_release_lookup_and_page)
            assert flipped
            assert stable_snapshot["page"]["release_key"] == new_release_key
            assert stable_snapshot["items"][0]["name"] == changed_direction_name

            restored = client.get("/api/v1/directions", params={"limit": 100}).json()
            restored_direction = next(
                item for item in restored["items"] if item["external_key"] == direction_key
            )
            assert restored["page"]["release_key"] == base_export["release_key"]
            assert restored_direction["name"] == old_direction_name

        with engine.connect() as owner_connection:
            academic_direction_view_oid = owner_connection.execute(
                text("SELECT 'academic_read.directions'::regclass::oid")
            ).scalar_one()
        with directus_engine.connect() as connection:
            projection_release_key = connection.execute(
                text("SELECT release_key FROM directus_read.active_release")
            ).scalar_one()
            assert projection_release_key == base_export["release_key"]
            assert connection.execute(
                text("SELECT count(DISTINCT release_id) FROM directus_read.directions")
            ).scalar_one() <= 1
            assert connection.execute(
                text("SELECT has_table_privilege(current_user, 'directus_read.directions', 'SELECT')")
            ).scalar_one()
            assert connection.execute(
                text("SELECT has_table_privilege(current_user, 'directus_read.directions', 'UPDATE')")
            ).scalar_one() is False
            assert connection.execute(
                text("SELECT has_schema_privilege(current_user, 'directus_read', 'CREATE')")
            ).scalar_one() is False
            assert connection.execute(
                text("SELECT has_schema_privilege(current_user, 'academic_read', 'USAGE')")
            ).scalar_one() is False
            assert connection.execute(
                text("SELECT has_table_privilege(current_user, :view_oid, 'SELECT')"),
                {"view_oid": academic_direction_view_oid},
            ).scalar_one() is False
            with pytest.raises(DBAPIError):
                connection.execute(text("SELECT * FROM public.directions LIMIT 1"))
            connection.rollback()
            with pytest.raises(DBAPIError):
                connection.execute(text("UPDATE public.directions SET name=name WHERE false"))
            connection.rollback()
            with pytest.raises(DBAPIError):
                connection.execute(text("UPDATE directus_read.directions SET name=name WHERE false"))
            connection.rollback()
            with pytest.raises(DBAPIError):
                connection.execute(text("DROP TABLE directus_read.directions"))
            connection.rollback()

        with api_engine.connect() as connection:
            assert connection.execute(
                text("SELECT has_table_privilege(current_user, 'public.directions', 'SELECT')")
            ).scalar_one()
            assert connection.execute(
                text("SELECT has_table_privilege(current_user, 'public.admission_result_sources', 'SELECT')")
            ).scalar_one() is False
            assert connection.execute(
                text("SELECT has_schema_privilege(current_user, 'public', 'CREATE')")
            ).scalar_one() is False
            with pytest.raises(DBAPIError):
                connection.execute(text("UPDATE public.directions SET name=name WHERE false"))
            connection.rollback()
            with pytest.raises(DBAPIError):
                connection.execute(text("SELECT * FROM public.admission_result_sources LIMIT 1"))
            connection.rollback()
            with pytest.raises(DBAPIError):
                connection.execute(text("SELECT * FROM directus_read.directions LIMIT 1"))
            connection.rollback()
    finally:
        if api_engine is not None:
            api_engine.dispose()
        if directus_engine is not None:
            directus_engine.dispose()
        with engine.begin() as connection:
            connection.execute(text("ALTER ROLE andromeda_api_runtime PASSWORD NULL"))
            connection.execute(text("ALTER ROLE andromeda_directus_runtime PASSWORD NULL"))
        engine.dispose()
