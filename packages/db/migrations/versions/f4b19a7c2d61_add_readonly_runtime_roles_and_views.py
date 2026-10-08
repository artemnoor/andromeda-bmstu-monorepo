"""Add least-privilege API roles and active-release Directus views.

Revision ID: f4b19a7c2d61
Revises: e91532f013ac
Create Date: 2026-10-07
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "f4b19a7c2d61"
down_revision: str | None = "e91532f013ac"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

API_READ_TABLES = (
    "active_data_release",
    "data_releases",
    "universities",
    "directions",
    "departments",
    "direction_departments",
    "educational_programs",
    "educational_program_departments",
    "catalog_courses",
    "study_plans",
    "curriculum_items",
    "admission_campaigns",
    "campaign_calendar_events",
    "program_offerings",
    "competition_pools",
    "competition_pool_offerings",
    "place_quota_assertions",
    "admission_exams",
    "admission_requirement_sets",
    "admission_requirement_nodes",
    "offering_requirement_links",
    "tuition_assertions",
    "historical_admission_statistics",
    "admission_statistics",
    "individual_achievement_policies",
    "funding_types",
    "quota_types",
    "source_artifacts",
    "source_evidence",
    "manual_review_items",
    "university_evidence",
    "direction_evidence",
    "department_evidence",
    "direction_department_evidence",
    "program_evidence",
    "program_department_evidence",
    "catalog_course_evidence",
    "study_plan_evidence",
    "curriculum_evidence",
    "campaign_evidence",
    "calendar_event_evidence",
    "offering_evidence",
    "competition_pool_evidence",
    "pool_offering_evidence",
    "place_quota_evidence",
    "exam_evidence",
    "requirement_set_evidence",
    "requirement_node_evidence",
    "offering_requirement_evidence",
    "tuition_evidence",
    "historical_statistic_evidence",
    "admission_statistic_evidence",
    "achievement_evidence",
    "funding_type_evidence",
    "quota_type_evidence",
    "manual_review_evidence",
    "subject_classifications",
    "subject_classification_runs",
    "subject_taxonomy_categories",
)

DIRECTUS_RELEASE_TABLES = (
    "universities",
    "directions",
    "departments",
    "direction_departments",
    "educational_programs",
    "educational_program_departments",
    "catalog_courses",
    "study_plans",
    "curriculum_items",
    "admission_campaigns",
    "campaign_calendar_events",
    "program_offerings",
    "competition_pools",
    "competition_pool_offerings",
    "place_quota_assertions",
    "admission_exams",
    "admission_requirement_sets",
    "admission_requirement_nodes",
    "offering_requirement_links",
    "tuition_assertions",
    "historical_admission_statistics",
    "admission_statistics",
    "individual_achievement_policies",
    "funding_types",
    "quota_types",
    "manual_review_items",
    "source_relationships",
    "university_evidence",
    "direction_evidence",
    "department_evidence",
    "direction_department_evidence",
    "program_evidence",
    "program_department_evidence",
    "catalog_course_evidence",
    "study_plan_evidence",
    "curriculum_evidence",
    "campaign_evidence",
    "calendar_event_evidence",
    "offering_evidence",
    "competition_pool_evidence",
    "pool_offering_evidence",
    "place_quota_evidence",
    "exam_evidence",
    "requirement_set_evidence",
    "requirement_node_evidence",
    "offering_requirement_evidence",
    "tuition_evidence",
    "historical_statistic_evidence",
    "admission_statistic_evidence",
    "achievement_evidence",
    "funding_type_evidence",
    "quota_type_evidence",
    "manual_review_evidence",
    "source_artifacts",
    "source_evidence",
)
DIRECTUS_READ_TABLES = ("active_release", *DIRECTUS_RELEASE_TABLES, "source_observations")


def _create_role(name: str, options: str) -> None:
    op.execute(
        f"""DO $role$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '{name}') THEN
                CREATE ROLE {name} {options};
            END IF;
        END
        $role$"""
    )
    op.execute(f"ALTER ROLE {name} {options}")


def upgrade() -> None:
    _create_role(
        "andromeda_api_readonly",
        "NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS",
    )
    _create_role(
        "andromeda_directus_readonly",
        "NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS",
    )
    _create_role(
        "andromeda_api_runtime",
        "LOGIN INHERIT PASSWORD NULL NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS",
    )
    _create_role(
        "andromeda_directus_runtime",
        "LOGIN INHERIT PASSWORD NULL NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS",
    )
    op.execute("GRANT andromeda_api_readonly TO andromeda_api_runtime")
    op.execute("GRANT andromeda_directus_readonly TO andromeda_directus_runtime")

    op.execute("CREATE SCHEMA IF NOT EXISTS academic_read")
    op.execute("CREATE SCHEMA IF NOT EXISTS directus_meta")
    op.execute("CREATE SCHEMA IF NOT EXISTS directus_read")
    op.execute("REVOKE ALL ON SCHEMA academic_read FROM PUBLIC")
    op.execute("REVOKE ALL ON SCHEMA directus_meta FROM PUBLIC")
    op.execute("REVOKE ALL ON SCHEMA directus_read FROM PUBLIC")
    op.execute("GRANT USAGE, CREATE ON SCHEMA directus_meta TO andromeda_directus_runtime")
    op.execute("GRANT USAGE ON SCHEMA directus_read TO andromeda_directus_readonly")
    op.execute("GRANT USAGE ON SCHEMA public TO andromeda_api_readonly")
    op.execute("REVOKE CREATE ON SCHEMA public FROM andromeda_api_runtime")
    op.execute("REVOKE CREATE ON SCHEMA public FROM andromeda_directus_runtime")

    op.execute(
        """CREATE OR REPLACE VIEW academic_read.active_release
        WITH (security_barrier = true) AS
        SELECT release.id, release.release_key, release.source_bundle_sha256,
               release.mapper_version, release.committed_at,
               release.reconciliation_status, release.schema_revision
        FROM public.active_data_release AS pointer
        JOIN public.data_releases AS release ON release.id = pointer.release_id
        WHERE pointer.slot_key = 'active'
          AND release.status = 'committed'
          AND release.reconciliation_status IN ('passed', 'passed_with_gaps')"""
    )
    for table_name in DIRECTUS_RELEASE_TABLES:
        if table_name == "source_artifacts":
            projection = (
                "record.id, record.release_id, record.external_key, record.source_type, "
                "record.requested_url, record.final_url, record.fetched_at, record.sha256, "
                "record.content_type, record.byte_size, record.status_code, "
                "record.storage_status, record.note, record.created_at"
            )
        elif table_name == "source_evidence":
            projection = (
                "record.id, record.release_id, record.external_key, record.source_artifact_id, "
                "record.field_path, record.locator, record.observed_at, "
                "record.verification_status, record.created_at"
            )
        else:
            projection = "record.*"
        op.execute(
            f"""CREATE OR REPLACE VIEW academic_read.{table_name}
            WITH (security_barrier = true) AS
            SELECT {projection}
            FROM public.{table_name} AS record
            JOIN public.active_data_release AS pointer
              ON pointer.slot_key = 'active' AND pointer.release_id = record.release_id"""
        )

    op.execute(
        """CREATE OR REPLACE VIEW academic_read.source_observations
        WITH (security_barrier = true) AS
        SELECT observation.id, observation.release_id, observation.external_key,
               observation.dataset_name, observation.source_artifact_id
        FROM public.source_observations AS observation
        JOIN public.active_data_release AS pointer
          ON pointer.slot_key = 'active' AND pointer.release_id = observation.release_id"""
    )

    # Directus 12's PostgreSQL inspector only enumerates ordinary tables. Keep
    # its projection as a transactionally refreshed read model sourced from
    # these safe, active-release views; Directus cannot access canonical tables.
    for table_name in DIRECTUS_READ_TABLES:
        op.execute(
            f"""CREATE TABLE directus_read.{table_name} AS
                SELECT * FROM academic_read.{table_name} WITH NO DATA"""
        )
        op.execute(
            f"ALTER TABLE directus_read.{table_name} "
            f"ADD CONSTRAINT pk_directus_read_{table_name} PRIMARY KEY (id)"
        )
        op.execute(
            f"INSERT INTO directus_read.{table_name} "
            f"SELECT * FROM academic_read.{table_name}"
        )

    table_list = ", ".join(f"'{name}'" for name in DIRECTUS_READ_TABLES)
    op.execute(
        f"""CREATE OR REPLACE FUNCTION public.refresh_directus_read_model()
        RETURNS trigger
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = pg_catalog
        AS $function$
        DECLARE table_name text;
        BEGIN
            FOREACH table_name IN ARRAY ARRAY[{table_list}] LOOP
                EXECUTE format('TRUNCATE TABLE directus_read.%I', table_name);
                EXECUTE format(
                    'INSERT INTO directus_read.%I SELECT * FROM academic_read.%I',
                    table_name,
                    table_name
                );
            END LOOP;
            RETURN NULL;
        END
        $function$"""
    )
    op.execute(
        "REVOKE ALL ON FUNCTION public.refresh_directus_read_model() "
        "FROM PUBLIC, andromeda_api_readonly, andromeda_api_runtime, "
        "andromeda_directus_readonly, andromeda_directus_runtime"
    )
    op.execute(
        """CREATE TRIGGER refresh_directus_read_model_after_active_release_change
        AFTER INSERT OR UPDATE OR DELETE ON public.active_data_release
        FOR EACH STATEMENT EXECUTE FUNCTION public.refresh_directus_read_model()"""
    )
    op.execute(
        """REVOKE ALL ON ALL TABLES IN SCHEMA public FROM andromeda_api_readonly,
            andromeda_api_runtime, andromeda_directus_readonly, andromeda_directus_runtime"""
    )
    op.execute(
        """REVOKE ALL
            ON ALL TABLES IN SCHEMA academic_read
            FROM PUBLIC, andromeda_directus_readonly, andromeda_directus_runtime"""
    )
    op.execute(
        """REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
            ON ALL TABLES IN SCHEMA directus_read
            FROM andromeda_directus_readonly, andromeda_directus_runtime"""
    )
    op.execute(
        """GRANT SELECT ON ALL TABLES IN SCHEMA directus_read
            TO andromeda_directus_readonly"""
    )
    for table_name in API_READ_TABLES:
        op.execute(
            f"GRANT SELECT ON TABLE public.{table_name} TO andromeda_api_readonly"
        )
    op.execute("GRANT SELECT ON ALL TABLES IN SCHEMA directus_read TO andromeda_directus_runtime")


def downgrade() -> None:
    # Directus creates its own tables in this schema. Never cascade-delete those
    # tables during an academic-data migration rollback.
    op.execute(
        """DO $guard$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM pg_catalog.pg_class AS relation
                JOIN pg_catalog.pg_namespace AS namespace
                  ON namespace.oid = relation.relnamespace
                WHERE namespace.nspname = 'directus_meta'
                  AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
            ) THEN
                RAISE EXCEPTION
                    'Refusing to downgrade while Directus metadata objects exist in directus_meta';
            END IF;
        END
        $guard$"""
    )
    op.execute("REVOKE andromeda_api_readonly FROM andromeda_api_runtime")
    op.execute("REVOKE andromeda_directus_readonly FROM andromeda_directus_runtime")
    op.execute(
        """REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
            FROM andromeda_api_readonly, andromeda_api_runtime,
                 andromeda_directus_readonly, andromeda_directus_runtime"""
    )
    op.execute(
        """REVOKE ALL PRIVILEGES ON SCHEMA public
            FROM andromeda_api_readonly, andromeda_api_runtime,
                 andromeda_directus_readonly, andromeda_directus_runtime"""
    )
    op.execute(
        "DROP TRIGGER IF EXISTS refresh_directus_read_model_after_active_release_change "
        "ON public.active_data_release"
    )
    op.execute("DROP FUNCTION IF EXISTS public.refresh_directus_read_model()")
    op.execute("DROP SCHEMA IF EXISTS academic_read CASCADE")
    op.execute("DROP SCHEMA IF EXISTS directus_read CASCADE")
    op.execute("DROP SCHEMA IF EXISTS directus_meta CASCADE")
    op.execute("DROP ROLE IF EXISTS andromeda_api_runtime")
    op.execute("DROP ROLE IF EXISTS andromeda_directus_runtime")
    op.execute("DROP ROLE IF EXISTS andromeda_api_readonly")
    op.execute("DROP ROLE IF EXISTS andromeda_directus_readonly")
