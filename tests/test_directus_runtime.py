from __future__ import annotations

import json
import os
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
from uuid import UUID, uuid4

import pytest
from academic_data_service.importer.mapping import project_bundle
from academic_data_service.importer.persistence import commit_projection
from academic_data_service.operations.releases import export_release_bundle
from academic_data_service.settings import load_settings
from sqlalchemy import create_engine, text

pytestmark = pytest.mark.integration
PROJECT_ROOT = Path(__file__).resolve().parents[1]
METADATA_ROOT = PROJECT_ROOT / "infra" / "directus" / "metadata"


def _runtime_config() -> tuple[str, str, str]:
    url = os.environ.get("DIRECTUS_TEST_URL", "").strip()
    email = os.environ.get("DIRECTUS_ADMIN_EMAIL", "").strip()
    password = os.environ.get("DIRECTUS_ADMIN_PASSWORD", "")
    if not url or not email or not password:
        pytest.skip("set DIRECTUS_TEST_URL and local Directus admin credentials to run Directus smoke")

    parsed = urlsplit(url)
    if parsed.scheme != "http" or parsed.hostname not in {"localhost", "127.0.0.1"}:
        pytest.fail("Directus runtime smoke may target only a local HTTP Directus instance")
    settings = load_settings()
    if (
        settings.environment != "test"
        or settings.database_name != "academic_data_test"
        or settings.database_host not in {"localhost", "127.0.0.1"}
    ):
        pytest.fail("Directus runtime smoke requires the dedicated localhost academic_data_test DB")
    return url.rstrip("/"), email, password


def _request(base_url: str, token: str, path: str) -> dict:
    request = Request(
        f"{base_url}{path}",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    )
    with urlopen(request, timeout=20) as response:
        result = json.loads(response.read())
    assert isinstance(result, dict) and "data" in result
    return result["data"]


def _required_get(base_url: str, token: str, collection: str, query: list[tuple[str, str]]) -> list[dict]:
    path = f"/items/{collection}?{urlencode(query)}"
    result = _request(base_url, token, path)
    assert isinstance(result, list) and result, f"no Directus rows returned for {collection}"
    return result


def test_authenticated_directus_viewer_navigation_and_release_data(tmp_path: Path) -> None:
    base_url, email, password = _runtime_config()
    collection_manifest = json.loads((METADATA_ROOT / "collections.json").read_text(encoding="utf-8"))
    relation_manifest = json.loads((METADATA_ROOT / "relations.json").read_text(encoding="utf-8"))

    login = Request(
        f"{base_url}/auth/login",
        data=json.dumps({"email": email, "password": password, "mode": "json"}).encode(),
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    with urlopen(login, timeout=20) as response:
        auth = json.loads(response.read()).get("data", {})
    token = auth.get("access_token")
    assert token

    actual_collections = _request(base_url, token, "/collections?limit=-1")
    collection_map = {item["collection"]: item for item in actual_collections}
    expected_collections = {item["collection"] for item in collection_manifest["collections"]}
    assert expected_collections <= collection_map.keys()
    visible_manifest = [item for item in collection_manifest["collections"] if not item.get("hidden", False)]
    visible_names = {item["collection"] for item in visible_manifest}
    registered_names = {
        item["collection"]
        for item in actual_collections
        if item["collection"] in expected_collections
        and (item.get("meta") or {}).get("display_template")
    }
    assert registered_names == visible_names
    assert len(registered_names) == 25
    for item in visible_manifest:
        actual = collection_map[item["collection"]]
        assert (actual.get("meta") or {}).get("group") == item.get("group")
        assert bool((actual.get("meta") or {}).get("hidden")) == bool(item.get("hidden", False))
        assert (actual.get("meta") or {}).get("display_template") == item.get("display_template")
    for folder in collection_manifest["folders"]:
        if folder.get("hidden", False):
            continue
        actual = collection_map[folder["collection"]]
        assert actual.get("schema") is None
        assert (actual.get("meta") or {}).get("group") is None

    curriculum_fields = _request(base_url, token, "/fields/curriculum_items")
    evidence_alias = next(item for item in curriculum_fields if item.get("field") == "evidence_links")
    evidence_alias_special = (evidence_alias.get("meta") or {}).get("special") or []
    if isinstance(evidence_alias_special, str):
        evidence_alias_special = evidence_alias_special.split(",")
    assert evidence_alias.get("type") == "alias"
    assert evidence_alias.get("schema") is None
    assert "o2m" in evidence_alias_special
    assert (evidence_alias.get("meta") or {}).get("readonly") is True

    actual_relations = _request(base_url, token, "/relations?limit=-1")
    relation_map = {(item.get("collection"), item.get("field")): item for item in actual_relations}
    for item in relation_manifest["relations"]:
        relation = relation_map[(item["collection"], item["field"])]
        assert relation.get("related_collection") == item["related_collection"]
        assert relation.get("schema") is None, f"{item['collection']}.{item['field']} acquired a physical FK"
        assert (relation.get("meta") or {}).get("one_field") == item["one_field"]

    presets = _request(
        base_url,
        token,
        "/presets?limit=-1&fields=id,collection,bookmark,user,role,layout,layout_query",
    )
    for expected in collection_manifest["presets"]:
        matching = [
            item
            for item in presets
            if item.get("collection") == expected["collection"]
            and item.get("bookmark") is None
            and item.get("user") is None
            and item.get("role") is None
        ]
        assert len(matching) == 1, f"expected one global default for {expected['collection']}"
        assert matching[0]["layout_query"]["tabular"]["fields"] == expected["fields"]

    programs = _required_get(
        base_url,
        token,
        "educational_programs",
        [
            ("limit", "1"),
            ("fields", "id,code,name,direction_id.code,direction_id.name,study_plans.id,department_links.department_id.official_code"),
        ],
    )
    program = programs[0]
    assert isinstance(program.get("direction_id"), dict)
    assert program["direction_id"].get("code")
    assert isinstance(program.get("study_plans"), list)
    assert isinstance(program.get("department_links"), list)
    department_linked_programs = _required_get(
        base_url,
        token,
        "educational_programs",
        [
            ("limit", "25"),
            ("fields", "id,department_links.department_id.official_code"),
        ],
    )
    assert any(
        link.get("department_id", {}).get("official_code")
        for row in department_linked_programs
        for link in row.get("department_links", [])
        if isinstance(link.get("department_id"), dict)
    )

    study_plans = _required_get(
        base_url,
        token,
        "study_plans",
        [
            ("limit", "1"),
            ("fields", "id,profile_code,education_year,study_form,program_id.code,curriculum_items.id,curriculum_items.semester"),
        ],
    )
    plan = study_plans[0]
    assert isinstance(plan.get("program_id"), dict)
    assert isinstance(plan.get("curriculum_items"), list) and plan["curriculum_items"]
    semester = plan["curriculum_items"][0].get("semester")
    assert semester is not None
    filtered_items = _required_get(
        base_url,
        token,
        "curriculum_items",
        [
            ("limit", "5"),
            ("filter[semester][_eq]", str(semester)),
            ("fields", "discipline_name,semester,total_hours,assessment_type,study_plan_id.profile_code"),
        ],
    )
    assert all(str(item["semester"]) == str(semester) for item in filtered_items)
    assert all(isinstance(item.get("study_plan_id"), dict) for item in filtered_items)

    campaigns = _required_get(
        base_url,
        token,
        "admission_campaigns",
        [("limit", "1"), ("fields", "year,campaign_kind,title,program_offerings.id,program_offerings.program_name_in_document")],
    )
    assert isinstance(campaigns[0].get("program_offerings"), list)

    requirements = _required_get(
        base_url,
        token,
        "admission_requirement_sets",
        [("limit", "1"), ("fields", "direction_code,applicant_category_text,nodes.id,nodes.node_kind,nodes.operator,nodes.exam_id.code,nodes.children.id")],
    )
    assert isinstance(requirements[0].get("nodes"), list)
    exams = _required_get(base_url, token, "admission_exams", [("limit", "1"), ("fields", "code,name")])
    assert exams[0].get("name")
    _required_get(
        base_url,
        token,
        "admission_statistics",
        [("limit", "1"), ("fields", "admission_year,direction_code,funding_type_code,score,status")],
    )
    evidence = _required_get(
        base_url,
        token,
        "source_evidence",
        [("limit", "1"), ("fields", "field_path,locator,verification_status,source_artifact_id.source_type,source_artifact_id.sha256")],
    )
    assert isinstance(evidence[0].get("source_artifact_id"), dict)
    curriculum_with_evidence = _required_get(
        base_url,
        token,
        "curriculum_items",
        [
            ("limit", "100"),
            ("sort", "id"),
            (
                "fields",
                (
                    "discipline_name,semester,evidence_links.id,evidence_links.evidence_id.field_path,"
                    "evidence_links.evidence_id.source_artifact_id.sha256"
                ),
            ),
        ],
    )
    linked_item = next(
        (item for item in curriculum_with_evidence if item.get("evidence_links")),
        None,
    )
    assert linked_item is not None
    evidence_link = linked_item["evidence_links"][0]
    assert isinstance(evidence_link.get("evidence_id"), dict)
    assert evidence_link["evidence_id"].get("source_artifact_id")
    release = _request(
        base_url,
        token,
        "/items/active_release?limit=1&fields=id,release_key,committed_at,source_bundle_sha256,mapper_version,reconciliation_status,schema_revision",
    )
    assert isinstance(release, dict) and release.get("release_key")

    source_observation_fields = _request(base_url, token, "/fields/source_observations")
    assert "payload" not in {item["field"] for item in source_observation_fields}
    try:
        _request(base_url, token, "/items/admission_result_sources?limit=1")
    except HTTPError as error:
        assert error.code in {403, 404}
    else:
        pytest.fail("applicant-level admission result source must not be exposed in Directus")

    # Commit a second verified release in the dedicated test database and
    # assert that Directus follows the active projection without mixing rows.
    settings = load_settings()
    engine = create_engine(settings.database_url)
    exported_path: Path | None = None
    try:
        with engine.connect() as connection:
            base_release_id = UUID(str(connection.execute(
                text("SELECT release_id FROM active_data_release WHERE slot_key='active'")
            ).scalar_one()))
            base_digest = connection.execute(
                text("SELECT source_bundle_sha256 FROM data_releases WHERE id=:release_id"),
                {"release_id": base_release_id},
            ).scalar_one()
        exported_path = tmp_path / "directus-release"
        with engine.connect() as connection:
            archive_format = connection.execute(
                text(
                    "SELECT archive_format FROM data_release_bundle_artifacts "
                    "WHERE release_id=:release_id"
                ),
                {"release_id": base_release_id},
            ).scalar_one()
        if archive_format == "source_zip_v1":
            exported_path = exported_path.with_suffix(".zip")
        export_release_bundle(engine, settings, output_path=exported_path, release_id=base_release_id)
        if archive_format == "source_zip_v1":
            pytest.skip("Directus active-release switch smoke requires the directory-export test fixture")
        context = {
            "schema_version": 1,
            "base_release_id": str(base_release_id),
            "base_source_bundle_sha256": base_digest,
        }
        (exported_path / "release_context.json").write_text(
            json.dumps(context, sort_keys=True) + "\n", encoding="utf-8"
        )
        readme = exported_path / "README.md"
        readme.write_text(
            readme.read_text(encoding="utf-8") + f"\n<!-- Directus switch smoke {uuid4()} -->\n",
            encoding="utf-8",
        )
        next_projection = project_bundle(str(exported_path))
        committed = commit_projection(engine, settings, next_projection)
        assert committed["outcome"] == "committed"
        assert committed["active_release_id"] != str(base_release_id)
        new_release = _request(
            base_url,
            token,
            "/items/active_release?limit=1&fields=id,release_key,committed_at",
        )
        assert new_release["id"] == committed["active_release_id"]
        assert new_release["release_key"] != release["release_key"]
        with engine.connect() as connection:
            active_ids = {
                str(row[0])
                for row in connection.execute(
                    text("SELECT DISTINCT release_id FROM directus_read.educational_programs")
                )
            }
        assert active_ids == {committed["active_release_id"]}
    finally:
        engine.dispose()
