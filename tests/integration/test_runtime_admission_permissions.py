"""Read-only role checks against an already migrated and seeded local test DB."""

from __future__ import annotations

import os

import pytest
from andromeda_api.application.queries import AcademicDataQueries
from andromeda_api.application.settings import load_settings
from andromeda_db.connection import verify_server_identity
from andromeda_db.repositories.read_repository import (
    SQLAlchemyAcademicDataReadRepository,
)
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import DBAPIError

pytestmark = pytest.mark.integration


@pytest.fixture
def local_seeded_engine():
    if not os.environ.get("ACADEMIC_DATA_DATABASE_URL"):
        pytest.skip("requires an already seeded, dedicated local PostgreSQL 16 test DB")
    settings = load_settings()
    if (
        settings.environment != "test"
        or settings.database_name != "academic_data_test"
        or settings.database_host not in {"localhost", "127.0.0.1"}
    ):
        pytest.fail("runtime role checks require localhost academic_data_test in test mode")
    engine = create_engine(settings.database_url)
    try:
        with engine.connect() as connection:
            identity = verify_server_identity(connection, settings)
            user = connection.execute(text("SELECT current_user")).scalar_one()
            if identity["server_major"] != 16 or user != "andromeda_test":
                pytest.fail("runtime role checks require the dedicated PG16 test owner")
            if not inspect(connection).has_table("active_data_release"):
                pytest.skip("requires an already migrated and seeded test DB")
            if connection.execute(text("SELECT count(*) FROM active_data_release")).scalar_one() == 0:
                pytest.skip("requires an already seeded release; this test does not publish data")
        yield engine
    finally:
        engine.dispose()


def test_runtime_offerings_match_owner_with_scalar_and_shared_links(local_seeded_engine) -> None:
    with (
        local_seeded_engine.connect().execution_options(isolation_level="REPEATABLE READ") as connection,
        connection.begin(),
    ):
        connection.execute(text("SET TRANSACTION READ ONLY"))
        owner = AcademicDataQueries(SQLAlchemyAcademicDataReadRepository(connection))
        campaigns = [item for item in owner.campaigns(100, None).items
                     if item.campaign_kind == "admission"]
        if not campaigns:
            pytest.skip("the seeded release has no admission campaign")
        campaign = max(campaigns, key=lambda item: item.year)

        def all_offerings(queries):
            pages, cursor = [], None
            while True:
                page = queries.campaign_offerings(campaign.external_key, 100, cursor)
                pages.append(page.model_dump(mode="json"))
                cursor = page.page.next_cursor
                if cursor is None:
                    return pages

        expected = all_offerings(owner)
        connection.execute(text("SET LOCAL ROLE andromeda_api_runtime"))
        assert connection.execute(text("SELECT current_user")).scalar_one() == "andromeda_api_runtime"
        assert connection.execute(text("SELECT count(*) FROM public.source_relationships")).scalar_one() >= 0
        runtime = AcademicDataQueries(SQLAlchemyAcademicDataReadRepository(connection))
        assert all_offerings(runtime) == expected


@pytest.mark.parametrize("statement", [
    "INSERT INTO public.source_relationships SELECT * FROM public.source_relationships WHERE false",
    "UPDATE public.source_relationships SET source_key = source_key WHERE false",
    "DELETE FROM public.source_relationships WHERE false",
    "SELECT * FROM public.source_observations LIMIT 0",
])
def test_runtime_cannot_write_links_or_read_raw_observations(local_seeded_engine, statement: str) -> None:
    with local_seeded_engine.connect() as connection:
        transaction = connection.begin()
        try:
            connection.execute(text("SET LOCAL ROLE andromeda_api_runtime"))
            with pytest.raises(DBAPIError) as denied:
                connection.execute(text(statement))
            assert getattr(denied.value.orig, "sqlstate", None) == "42501"
        finally:
            transaction.rollback()
