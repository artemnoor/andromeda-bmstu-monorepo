from __future__ import annotations

from unittest.mock import Mock
from uuid import uuid4

import pytest
from andromeda_api.application.queries import AcademicDataQueries
from andromeda_contracts.api.v1.models import AdmissionOfferingRecord
from andromeda_db.repositories.read_repository import (
    SQLAlchemyAcademicDataReadRepository,
)
from andromeda_ontology.ports import PageRows
from pydantic import ValidationError


def _fixture():
    release_id, campaign_id, direction_id = uuid4(), uuid4(), uuid4()
    offering = {
        "id": uuid4(), "release_id": release_id, "external_key": "offering:shared",
        "campaign_id": campaign_id, "direction_id": direction_id,
        "direction_code": "09.03.01", "program_id": None, "department_id": None,
        "department_code": None, "program_name_in_document": "Первая / Вторая",
        "study_form": "full_time", "language": None, "study_duration_label": "4 года",
        "campus_scope": "head_moscow",
    }
    programs = [{
        "id": uuid4(), "release_id": release_id, "external_key": f"program:{index}",
        "direction_id": direction_id, "campus_scope": "head_moscow",
    } for index in (1, 2)]
    relations = [{
        "id": uuid4(), "release_id": release_id, "external_key": f"relation:{index}",
        "source_key": offering["external_key"], "target_key": program["external_key"],
        "relation_type": "offering_includes_catalog_program",
        "evidence_kind": "explicit_appendix_8_1_profile_group",
        "source_artifact_id": uuid4(), "source_locator": {"page": 1, "table": 1, "row": 2},
    } for index, program in enumerate(programs)]
    direction = {"id": direction_id, "release_id": release_id,
                 "external_key": "direction:09.03.01", "code": "09.03.01"}
    repository = Mock()
    repository.active_release_id = release_id
    repository.active_release_key = "release:fixture"
    repository.get.return_value = offering
    repository.get_by_id.side_effect = lambda table, key: (
        direction if table == "directions" else {"external_key": "campaign:fixture"}
    )
    repository.get_by_ids.return_value = {direction_id: direction}
    repository.get_by_keys.side_effect = lambda table, keys: {
        program["external_key"]: program for program in programs if program["external_key"] in keys
    }
    repository.related_many.side_effect = lambda table, field, keys, **kwargs: {
        key: [relation for relation in relations if relation["source_key"] == key] for key in keys
    }
    repository.manual_reviews_for.return_value = []
    repository.page.side_effect = lambda *args, **kwargs: PageRows([offering], None, 1)
    queries = AcademicDataQueries(repository)
    queries._sourced = Mock(return_value={})
    return queries, repository, offering, programs, relations, direction


def test_shared_offering_publishes_evidenced_program_group_without_scalar_link() -> None:
    queries, _, _, _, _, _ = _fixture()
    result = queries.offering("offering:shared")
    assert result.shared_program_keys == ["program:1", "program:2"]
    assert result.program_key is None
    assert result.program_link_status == "unresolved"


@pytest.mark.parametrize("invalid", [
    "artifact", "locator", "evidence_kind", "relation_type", "relation_release",
    "program_release", "campus", "unknown_campus", "direction", "missing_program",
    "single_program",
])
def test_invalid_shared_group_is_not_published(invalid: str) -> None:
    queries, repository, offering, programs, relations, direction = _fixture()
    if invalid == "artifact":
        relations[0]["source_artifact_id"] = None
    elif invalid == "locator":
        relations[0]["source_locator"] = None
    elif invalid in {"evidence_kind", "relation_type"}:
        relations[0][invalid] = "name_similarity"
    elif invalid == "relation_release":
        relations[0]["release_id"] = uuid4()
    elif invalid == "program_release":
        programs[0]["release_id"] = uuid4()
    elif invalid == "campus":
        programs[0]["campus_scope"] = "other"
    elif invalid == "unknown_campus":
        offering["campus_scope"] = "unknown"
        programs[0]["campus_scope"] = "unknown"
        programs[1]["campus_scope"] = "unknown"
    elif invalid == "direction":
        direction["code"] = "09.03.02"
    elif invalid == "missing_program":
        programs.pop()
    elif invalid == "single_program":
        relations.pop()
    result = queries.offering("offering:shared")
    assert result.shared_program_keys == []
    assert result.program_key is None
    repository.get_by_keys.assert_called_once()


def test_composite_direction_codes_match_after_order_and_whitespace_normalization() -> None:
    queries, _, offering, _, _, direction = _fixture()
    offering["direction_code"] = "40.05.03 / 40.05.01"
    direction["code"] = "40.05.01/40.05.03"
    assert queries.offering("offering:shared").shared_program_keys == ["program:1", "program:2"]


def test_shared_group_page_reads_relationships_and_programs_in_batches() -> None:
    queries, repository, offering, _, relations, _ = _fixture()
    rows = [dict(offering, id=uuid4(), external_key=f"offering:{index}") for index in range(100)]
    repository.page.return_value = PageRows(rows, None, 100)
    repository.page.side_effect = None
    for row in rows:
        relations.extend([dict(relation, id=uuid4(), source_key=row["external_key"])
                          for relation in relations[:2]])
    result = queries.campaign_offerings("campaign:fixture", 100, None)
    assert all(item.shared_program_keys == ["program:1", "program:2"] for item in result.items)
    repository.related_many.assert_called_once()
    repository.get_by_keys.assert_called_once()
    repository.related.assert_not_called()


@pytest.mark.parametrize("masked", [
    ("related_many",), ("get_by_keys",), ("get_by_ids",),
    ("related_many", "get_by_keys", "get_by_ids"),
])
def test_shared_group_fallback_matches_batch_semantics(masked: tuple[str, ...]) -> None:
    queries, repository, offering, programs, relations, _ = _fixture()
    expected = queries.offering("offering:shared").model_dump(mode="json")
    offering.pop("shared_program_keys")
    repository.get.side_effect = lambda table, key: (
        next((program for program in programs if program["external_key"] == key), None)
        if table == "educational_programs" else offering
    )
    repository.related.side_effect = lambda table, field, key, **kwargs: [
        relation for relation in relations if relation["source_key"] == key
    ]
    for method in masked:
        setattr(repository, method, None)
    assert queries.offering("offering:shared").model_dump(mode="json") == expected


def test_scalar_program_link_contract_remains_strict() -> None:
    with pytest.raises(ValidationError, match="exact program links require"):
        AdmissionOfferingRecord(external_key="offering:one", campaign_key="campaign:one",
                                program_link_status="exact", shared_program_keys=["program:one"])


def test_existing_scalar_contract_defaults_to_an_empty_shared_group() -> None:
    record = AdmissionOfferingRecord(external_key="offering:one", campaign_key="campaign:one",
                                    program_link_status="exact", program_key="program:one")
    assert record.shared_program_keys == []


def test_repository_bulk_external_keys_are_release_scoped_and_warm_id_cache() -> None:
    release_id = uuid4()
    program = {"id": uuid4(), "external_key": "program:one", "release_id": release_id}
    connection = Mock()
    connection.execute.return_value.mappings.return_value.all.return_value = [program]
    repository = SQLAlchemyAcademicDataReadRepository(connection)
    repository._release_id = release_id
    repository._release_key = "release:fixture"
    assert repository.get_by_keys("educational_programs", ["program:one", "program:one"]) == {
        "program:one": program,
    }
    statement = connection.execute.call_args.args[0]
    assert "educational_programs.release_id =" in str(statement)
    assert release_id in statement.compile().params.values()
    assert repository.get_by_id("educational_programs", program["id"]) == program
    connection.execute.assert_called_once()
    assert repository.get_by_keys("educational_programs", []) == {}
    connection.execute.assert_called_once()


def test_repository_bulk_relationships_accept_stable_source_keys_and_cache_empty_groups() -> None:
    release_id = uuid4()
    relation = {"id": uuid4(), "external_key": "relation:one", "release_id": release_id,
                "source_key": "offering:one", "target_key": "program:one"}
    connection = Mock()
    connection.execute.return_value.mappings.return_value.all.return_value = [relation]
    repository = SQLAlchemyAcademicDataReadRepository(connection)
    repository._release_id = release_id
    repository._release_key = "release:fixture"
    expected = {"offering:one": [relation], "offering:two": []}
    assert repository.related_many("source_relationships", "source_key", list(expected)) == expected
    statement = connection.execute.call_args.args[0]
    assert "source_relationships.release_id =" in str(statement)
    assert release_id in statement.compile().params.values()
    assert repository.related("source_relationships", "source_key", "offering:one") == [relation]
    assert repository.related("source_relationships", "source_key", "offering:two") == []
    connection.execute.assert_called_once()
