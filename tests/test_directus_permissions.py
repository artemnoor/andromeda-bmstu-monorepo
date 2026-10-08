from __future__ import annotations

import os
from pathlib import Path
from uuid import uuid4

import pytest
from andromeda_api.application.publication import publish_reviewed_bundle
from andromeda_api.application.settings import Settings, load_settings
from andromeda_db.connection import (
    verify_server_identity,
)
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import URL
from sqlalchemy.exc import DBAPIError

pytestmark = pytest.mark.integration
PROJECT_ROOT = Path(__file__).resolve().parents[1]
BUNDLE = PROJECT_ROOT / "data" / "bmstu-2026"


def _isolated_test_database() -> tuple[Engine, Settings]:
    if not os.environ.get("ACADEMIC_DATA_DATABASE_URL"):
        pytest.skip("set ACADEMIC_DATA_DATABASE_URL to the dedicated local PostgreSQL 16 test DB")
    settings = load_settings()
    if (
        settings.environment != "test"
        or settings.database_name != "academic_data_test"
        or settings.database_host not in {"localhost", "127.0.0.1"}
    ):
        pytest.fail("Directus permission tests may only use localhost academic_data_test in test mode")

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
            pytest.fail("Directus permission tests require the dedicated local PostgreSQL 16 test database")
    except Exception:
        engine.dispose()
        raise
    return engine, settings


def _ensure_active_release(engine: Engine) -> None:
    with engine.connect() as connection:
        release_id = connection.execute(
            text("SELECT release_id FROM active_data_release WHERE slot_key='active'")
        ).scalar_one_or_none()
    if release_id is None:
        result = publish_reviewed_bundle(str(BUNDLE))
        assert result["outcome"] == "committed"


def _engine_for_role(settings: Settings, role: str, password: str) -> Engine:
    role_url: URL = settings.parsed_database_url.set(username=role, password=password)
    return create_engine(role_url, pool_size=1, max_overflow=0)


def _execute_as_runtime_and_require_sqlstate(
    engine: Engine, statement: str, *, expected_sqlstate: str = "42501"
) -> None:
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            connection.execute(text(statement))
        except DBAPIError as error:
            sqlstate = getattr(error.orig, "sqlstate", None)
            transaction.rollback()
            assert sqlstate == expected_sqlstate, (
                f"expected PostgreSQL SQLSTATE {expected_sqlstate} for {statement!r}, got {sqlstate}"
            )
        else:
            transaction.rollback()
            pytest.fail(f"Directus runtime unexpectedly executed: {statement}")


def _academic_schema_fingerprint(engine: Engine) -> tuple[tuple[object, ...], ...]:
    with engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT namespace.nspname, relation.oid, relation.relname, relation.relkind, attribute.attname, "
                "attribute.atttypid, attribute.attnotnull "
                "FROM pg_catalog.pg_class AS relation "
                "JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=relation.relnamespace "
                "LEFT JOIN pg_catalog.pg_attribute AS attribute "
                "ON attribute.attrelid=relation.oid AND attribute.attnum > 0 AND NOT attribute.attisdropped "
                "WHERE namespace.nspname IN ('public','academic_read','directus_read') "
                "AND relation.relkind IN ('r','p','v','m','S') "
                "ORDER BY relation.oid, attribute.attnum"
            )
        ).all()
    return tuple(tuple(row) for row in rows)


def test_directus_runtime_sees_one_active_release_and_resolvable_read_relations() -> None:
    engine, settings = _isolated_test_database()
    runtime_engine = None
    password = uuid4().hex
    try:
        _ensure_active_release(engine)
        with engine.connect() as connection:
            active_id = connection.execute(
                text("SELECT release_id FROM active_data_release WHERE slot_key='active'")
            ).scalar_one()
            with engine.begin() as role_connection:
                role_connection.execute(
                    text(f"ALTER ROLE andromeda_directus_runtime PASSWORD '{password}'")
                )
        runtime_engine = _engine_for_role(settings, "andromeda_directus_runtime", password)

        with runtime_engine.connect() as connection:
            active = connection.execute(
                text("SELECT id, release_key, reconciliation_status FROM directus_read.active_release")
            ).one()
            assert active.id == active_id
            assert active.reconciliation_status in {"passed", "passed_with_gaps"}

            projected_tables = {
                row.table_name
                for row in connection.execute(
                    text(
                        "SELECT table_name FROM information_schema.tables "
                        "WHERE table_schema='directus_read' AND table_type='BASE TABLE'"
                    )
                )
            }
            required_collections = {
                "universities",
                "directions",
                "educational_programs",
                "departments",
                "study_plans",
                "curriculum_items",
                "catalog_courses",
                "admission_campaigns",
                "campaign_calendar_events",
                "program_offerings",
                "competition_pools",
                "admission_exams",
                "admission_requirement_sets",
                "place_quota_assertions",
                "tuition_assertions",
                "individual_achievement_policies",
                "funding_types",
                "quota_types",
                "admission_statistics",
                "historical_admission_statistics",
                "source_artifacts",
                "source_evidence",
                "source_observations",
                "manual_review_items",
                "active_release",
            }
            assert required_collections <= projected_tables
            assert "admission_result_sources" not in projected_tables

            for table_name in projected_tables - {"active_release"}:
                releases = connection.execute(
                    text(f"SELECT DISTINCT release_id FROM directus_read.{table_name}")
                ).scalars().all()
                assert set(releases) <= {active_id}, f"{table_name} mixes release rows: {releases}"

            assert connection.execute(
                text(
                    "SELECT count(*) FROM directus_read.educational_programs AS program "
                    "JOIN directus_read.directions AS direction "
                    "ON direction.id=program.direction_id AND direction.release_id=program.release_id"
                )
            ).scalar_one() > 0
            assert connection.execute(
                text(
                    "SELECT count(*) FROM directus_read.educational_program_departments AS link "
                    "JOIN directus_read.educational_programs AS program "
                    "ON program.id=link.program_id AND program.release_id=link.release_id "
                    "JOIN directus_read.departments AS department "
                    "ON department.id=link.department_id AND department.release_id=link.release_id"
                )
            ).scalar_one() > 0
            assert connection.execute(
                text(
                    "SELECT count(*) FROM directus_read.study_plans AS plan "
                    "JOIN directus_read.educational_programs AS program "
                    "ON program.id=plan.program_id AND program.release_id=plan.release_id "
                    "JOIN directus_read.curriculum_items AS item "
                    "ON item.study_plan_id=plan.id AND item.release_id=plan.release_id"
                )
            ).scalar_one() > 0
            assert connection.execute(
                text(
                    "SELECT count(*) FROM directus_read.program_offerings AS offering "
                    "JOIN directus_read.admission_campaigns AS campaign "
                    "ON campaign.id=offering.campaign_id AND campaign.release_id=offering.release_id"
                )
            ).scalar_one() > 0
            assert connection.execute(
                text(
                    "SELECT count(*) FROM directus_read.source_evidence AS evidence "
                    "JOIN directus_read.source_artifacts AS artifact "
                    "ON artifact.id=evidence.source_artifact_id AND artifact.release_id=evidence.release_id"
                )
            ).scalar_one() > 0

            observation_columns = {
                row.column_name
                for row in connection.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_schema='directus_read' AND table_name='source_observations'"
                    )
                )
            }
            assert observation_columns == {
                "id",
                "release_id",
                "external_key",
                "dataset_name",
                "source_artifact_id",
            }
            assert "payload" not in observation_columns
            assert connection.execute(
                text("SELECT has_schema_privilege(current_user, 'academic_read', 'USAGE')")
            ).scalar_one() is False
            assert connection.execute(
                text(
                    "SELECT CASE WHEN has_schema_privilege(current_user, 'public', 'USAGE') "
                    "THEN has_table_privilege(current_user, 'public.admission_result_sources', 'SELECT') "
                    "ELSE false END"
                )
            ).scalar_one() is False

        _execute_as_runtime_and_require_sqlstate(
            runtime_engine, "SELECT * FROM public.admission_result_sources LIMIT 1"
        )
    finally:
        if runtime_engine is not None:
            runtime_engine.dispose()
        with engine.begin() as connection:
            connection.execute(text("ALTER ROLE andromeda_directus_runtime PASSWORD NULL"))
        engine.dispose()


def test_directus_runtime_cannot_change_academic_data_or_schema() -> None:
    engine, settings = _isolated_test_database()
    runtime_engine = None
    password = uuid4().hex
    try:
        _ensure_active_release(engine)
        before = _academic_schema_fingerprint(engine)
        with engine.begin() as connection:
            connection.execute(
                text(f"ALTER ROLE andromeda_directus_runtime PASSWORD '{password}'")
            )
        runtime_engine = _engine_for_role(settings, "andromeda_directus_runtime", password)

        with runtime_engine.connect() as connection:
            assert connection.execute(
                text("SELECT current_user")
            ).scalar_one() == "andromeda_directus_runtime"
            role_flags = connection.execute(
                text(
                    "SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls "
                    "FROM pg_catalog.pg_roles WHERE rolname=current_user"
                )
            ).one()
            assert tuple(role_flags) == (True, False, False, False, False)
            assert connection.execute(
                text("SELECT has_schema_privilege(current_user, 'directus_meta', 'USAGE')")
            ).scalar_one()
            assert connection.execute(
                text("SELECT has_schema_privilege(current_user, 'directus_meta', 'CREATE')")
            ).scalar_one()
            assert connection.execute(
                text("SELECT has_schema_privilege(current_user, 'directus_read', 'CREATE')")
            ).scalar_one() is False
            assert connection.execute(
                text("SELECT has_schema_privilege(current_user, 'public', 'CREATE')")
            ).scalar_one() is False

            projection_tables = connection.execute(
                text(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema='directus_read' AND table_type='BASE TABLE'"
                )
            ).scalars().all()
            for table_name in projection_tables:
                relation = f"directus_read.{table_name}"
                assert connection.execute(
                    text("SELECT has_table_privilege(current_user, :relation, 'SELECT')"),
                    {"relation": relation},
                ).scalar_one(), f"Directus runtime cannot read {relation}"
                for privilege in ("INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"):
                    assert connection.execute(
                        text("SELECT NOT has_table_privilege(current_user, :relation, :privilege)"),
                        {"relation": relation, "privilege": privilege},
                    ).scalar_one(), f"Directus runtime has {privilege} on {relation}"

        denied_statements = (
            (
                "INSERT INTO directus_read.directions (id, release_id) "
                "SELECT gen_random_uuid(), gen_random_uuid() WHERE false"
            ),
            "UPDATE directus_read.directions SET name=name WHERE false",
            "DELETE FROM directus_read.directions WHERE false",
            "TRUNCATE TABLE directus_read.directions",
            "ALTER TABLE directus_read.directions ADD COLUMN codex_permission_probe integer",
            "DROP TABLE directus_read.directions",
            (
                "INSERT INTO public.directions (id, release_id) "
                "SELECT gen_random_uuid(), gen_random_uuid() WHERE false"
            ),
            "ALTER TABLE public.directions ADD COLUMN codex_permission_probe integer",
            "UPDATE public.directions SET name=name WHERE false",
            "DELETE FROM public.directions WHERE false",
            "TRUNCATE TABLE public.directions",
            "DROP TABLE public.directions",
            "CREATE TABLE directus_read.codex_permission_probe (id integer)",
            "CREATE TABLE public.codex_permission_probe (id integer)",
        )
        for statement in denied_statements:
            _execute_as_runtime_and_require_sqlstate(runtime_engine, statement)

        metadata_table = f"directus_meta.codex_permission_probe_{uuid4().hex}"
        with runtime_engine.begin() as connection:
            connection.execute(text(f"CREATE TABLE {metadata_table} (id integer PRIMARY KEY)"))
            connection.execute(text(f"DROP TABLE {metadata_table}"))

        assert _academic_schema_fingerprint(engine) == before
    finally:
        if runtime_engine is not None:
            runtime_engine.dispose()
        with engine.begin() as connection:
            connection.execute(text("ALTER ROLE andromeda_directus_runtime PASSWORD NULL"))
        engine.dispose()
