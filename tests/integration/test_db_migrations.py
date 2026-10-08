from __future__ import annotations

from pathlib import Path

from alembic.script import ScriptDirectory
from andromeda_db.migration_config import build_alembic_config, resolve_migrations_path

EXPECTED_PARENTS = {
    "0001_initial_service_metadata": None,
    "e0784a907d45": "0001_initial_service_metadata",
    "a0337fe46f54": "e0784a907d45",
    "c81b2907f4a1": "a0337fe46f54",
    "db957c691c30": "c81b2907f4a1",
    "f3090f70ec32": "db957c691c30",
    "a7d2c91e4f60": "f3090f70ec32",
    "de41afbb52c8": "a7d2c91e4f60",
    "bb3f647a29c1": "de41afbb52c8",
    "e91532f013ac": "bb3f647a29c1",
    "f4b19a7c2d61": "e91532f013ac",
    "71d8c4a29f30": "f4b19a7c2d61",
}


def test_migrations_are_discoverable_from_the_source_checkout() -> None:
    config = build_alembic_config()
    script = ScriptDirectory.from_config(config)

    assert Path(config.get_main_option("script_location"), "env.py").is_file()
    assert script.get_heads() == ["71d8c4a29f30"]
    revisions = {revision.revision: revision.down_revision for revision in script.walk_revisions()}
    assert revisions == EXPECTED_PARENTS


def test_migrations_fall_back_to_non_editable_install_data(tmp_path: Path) -> None:
    source_migrations = tmp_path / "site-packages" / "andromeda_db" / "migrations"
    installed_migrations = tmp_path / "venv" / "share" / "andromeda-db" / "migrations"
    (installed_migrations / "versions").mkdir(parents=True)
    (installed_migrations / "env.py").write_text("# installed migration environment\n", encoding="utf-8")
    (installed_migrations / "script.py.mako").write_text("# installed revision template\n", encoding="utf-8")
    (installed_migrations / "versions" / "revision.py").write_text(
        "revision = 'installed'\n", encoding="utf-8"
    )

    assert resolve_migrations_path(source_migrations, installed_migrations) == installed_migrations


def test_checkout_migrations_take_precedence_when_both_locations_exist(tmp_path: Path) -> None:
    source_migrations = tmp_path / "packages" / "db" / "migrations"
    installed_migrations = tmp_path / "venv" / "share" / "andromeda-db" / "migrations"
    source_migrations.mkdir(parents=True)
    installed_migrations.mkdir(parents=True)

    assert resolve_migrations_path(source_migrations, installed_migrations) == source_migrations
