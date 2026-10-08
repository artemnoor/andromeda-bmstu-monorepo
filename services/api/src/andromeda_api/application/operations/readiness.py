"""Fail-closed readiness checks for the API's database and active release."""

from __future__ import annotations

from andromeda_contracts.api.v1.models import ReadinessRecord
from andromeda_db.repositories.health import load_readiness_facts
from andromeda_db.revisions import SERVICE_SCHEMA_HEAD
from sqlalchemy.engine import Connection


def check_readiness(connection: Connection, expected_database: str) -> ReadinessRecord:
    """Check only safe readiness facts; never return connection or schema details."""

    if connection.dialect.name != "postgresql":
        return _not_ready("database_version_unsupported")

    facts = load_readiness_facts(connection)
    if facts["database_name"] != expected_database:
        return _not_ready("database_identity_mismatch")
    if facts["server_version_number"] // 10000 != 16:
        return _not_ready("database_version_unsupported")
    if not facts["version_table_exists"]:
        return _not_ready("schema_outdated")
    schema_revision = facts["schema_revision"]
    if schema_revision != SERVICE_SCHEMA_HEAD:
        return _not_ready("schema_outdated", schema_revision=schema_revision)
    if not facts["release_tables_exist"]:
        return _not_ready("schema_outdated", schema_revision=schema_revision)
    release = facts["active_release"]
    if release is None:
        return _not_ready("active_release_unavailable", schema_revision=schema_revision)
    if release["status"] != "committed" or release["reconciliation_status"] not in {
        "passed",
        "passed_with_gaps",
    }:
        return _not_ready("release_not_reconciled", schema_revision=schema_revision)

    return ReadinessRecord(
        status="ready",
        reason_code="ready",
        required_schema_revision=SERVICE_SCHEMA_HEAD,
        schema_revision=schema_revision,
        release_key=release["release_key"],
        bundle_digest_prefix=release["source_bundle_sha256"][:12],
    )


def _not_ready(reason_code: str, *, schema_revision: str | None = None) -> ReadinessRecord:
    return ReadinessRecord(
        status="not_ready",
        reason_code=reason_code,  # type: ignore[arg-type]
        required_schema_revision=SERVICE_SCHEMA_HEAD,
        schema_revision=schema_revision,
    )
