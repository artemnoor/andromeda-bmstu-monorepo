from __future__ import annotations

import hashlib

import pytest

from andromeda.ingestion.universities.bmstu.curriculum_identity import (
    CurriculumIdentityError,
    observation_identity_key,
    reconcile_curriculum_rows,
    stable_source_identity_key,
)
from andromeda.ingestion.universities.bmstu.normalizers.canonical import _append_curriculum_item
from andromeda.modules.curricula.contracts.public import CurriculumItem


PLAN_KEY = "study_plan:bmstu:01.03.02-01:2026"


def _current(name: str, row: int, *, semester: int = 1, **values: object) -> dict[str, object]:
    return {
        "external_key": f"curriculum_item:{PLAN_KEY}:row:{row}",
        "curriculum_key": PLAN_KEY,
        "discipline": name,
        "semester": semester,
        "hours": 72,
        "assessment_type": "Зачёт",
        **values,
    }


def _incoming(name: str, position: int, *, semester: int = 1, **values: object) -> dict[str, object]:
    return {
        "discipline": name,
        "semester": semester,
        "hours": 72,
        "assessment_type": "Зачёт",
        "parsed_position": position,
        "source_page": 1,
        "printed_row_no": position,
        "source_sha256": hashlib.sha256(b"official curriculum PDF").hexdigest(),
        "source_locator": {"page": 1, "printed_row_no": position, "parsed_position": position},
        **values,
    }


def _keys(result) -> dict[str, str]:
    return {
        row.metadata["signals"]["discipline_name"]: row.canonical_external_key
        for row in result.rows
        if row.status == "matched"
    }


def _publish_rows(rows: list[dict[str, object]], result) -> list[dict[str, object]]:
    published: list[dict[str, object]] = []
    for row, resolution in zip(rows, result.rows, strict=True):
        assert resolution.status in {"matched", "new"}
        assert resolution.canonical_external_key and resolution.source_identity_key
        published.append({
            **row,
            "external_key": resolution.canonical_external_key,
            "curriculum_key": PLAN_KEY,
            "source_row": {
                "identity": {
                    "source_identity_id": resolution.source_identity_key,
                    "signals": resolution.metadata["signals"],
                }
            },
        })
    return published


def test_insert_reorder_and_mutable_changes_preserve_legacy_keys() -> None:
    current = [_current(name, index) for index, name in enumerate("ABCD", start=1)]
    v1_rows = [_incoming(name, index) for index, name in enumerate(("A", "NEW", "B", "C", "D"), start=1)]
    inserted = reconcile_curriculum_rows(
        PLAN_KEY,
        v1_rows,
        current,
    )
    matched = _keys(inserted)
    assert matched == {
        name.casefold(): f"curriculum_item:{PLAN_KEY}:row:{index}"
        for index, name in enumerate("ABCD", start=1)
    }
    new = next(row for row in inserted.rows if row.status == "new")
    assert new.canonical_external_key and ":identity:" in new.canonical_external_key
    current_v1 = _publish_rows(v1_rows, inserted)

    v2_rows = [_incoming(name, index) for index, name in enumerate(("B", "A", "NEW", "C", "D"), start=1)]
    reordered = reconcile_curriculum_rows(
        PLAN_KEY,
        v2_rows,
        current_v1,
    )
    assert {key: value for key, value in _keys(reordered).items() if key != "new"} == {
        "a": matched["a"], "b": matched["b"], "c": matched["c"], "d": matched["d"]
    }
    assert next(row for row in reordered.rows if row.metadata["signals"]["discipline_name"] == "new").canonical_external_key == new.canonical_external_key

    changed_facts = reconcile_curriculum_rows(
        PLAN_KEY,
        [
            _incoming("B", 3, semester=3, hours=180, assessment_type="Экзамен"),
        ],
        current_v1,
    )
    assert changed_facts.rows[0].status == "matched"
    assert changed_facts.rows[0].canonical_external_key == matched["b"]

    deleted = reconcile_curriculum_rows(
        PLAN_KEY,
        [_incoming(name, index) for index, name in enumerate(("A", "NEW", "B", "D"), start=1)],
        current_v1,
        complete_scope=True,
    )
    assert deleted.potentially_removed == (matched["c"],)
    assert len(current_v1) == 5  # a potential removal does not mutate the published state

    repeated = reconcile_curriculum_rows(PLAN_KEY, v2_rows, current_v1, complete_scope=True)
    assert repeated.potentially_removed == ()
    assert all(row.status == "matched" for row in repeated.rows)
    assert {row.canonical_external_key for row in repeated.rows} == {
        row["external_key"] for row in current_v1
    }


def test_delete_is_only_potential_removal_and_partial_scope_protects_data() -> None:
    current = [_current(name, index) for index, name in enumerate("ABCD", start=1)]
    incoming = [_incoming(name, index) for index, name in enumerate(("A", "B", "D"), start=1)]

    partial = reconcile_curriculum_rows(PLAN_KEY, incoming, current, complete_scope=False)
    assert partial.potentially_removed == ()

    complete = reconcile_curriculum_rows(PLAN_KEY, incoming, current, complete_scope=True)
    assert complete.potentially_removed == (f"curriculum_item:{PLAN_KEY}:row:3",)
    assert all(row.status == "matched" for row in complete.rows)


def test_duplicate_titles_do_not_merge_and_ambiguous_rows_get_observation_keys() -> None:
    duplicates = [
        _incoming("Общая физика", 1, semester=1, identity_status="ambiguous"),
        _incoming("Общая физика", 2, semester=1, identity_status="ambiguous"),
    ]
    result = reconcile_curriculum_rows(PLAN_KEY, duplicates, [])
    keys = [row.canonical_external_key for row in result.rows]
    assert all(row.status == "ambiguous" for row in result.rows)
    assert len(set(keys)) == 2
    assert all(key and key.startswith("curriculum_observation:") for key in keys)


def test_exact_duplicate_labels_in_distinct_semesters_are_separate_and_repeatable() -> None:
    source = [
        _incoming("Общая физика", 1, semester=1),
        _incoming("Общая физика", 2, semester=2),
    ]
    first = reconcile_curriculum_rows(PLAN_KEY, source, [])
    repeated = reconcile_curriculum_rows(PLAN_KEY, source, [])
    first_keys = [row.canonical_external_key for row in first.rows]
    assert first_keys == [row.canonical_external_key for row in repeated.rows]
    assert len(set(first_keys)) == 2
    assert all(row.status == "new" for row in first.rows)

    current = [
        _current("Общая физика", 10, semester=1),
        _current("Общая физика", 11, semester=2),
    ]
    matched = reconcile_curriculum_rows(PLAN_KEY, source, current)
    assert [row.canonical_external_key for row in matched.rows] == [
        f"curriculum_item:{PLAN_KEY}:row:10",
        f"curriculum_item:{PLAN_KEY}:row:11",
    ]


def test_semester_change_in_repeated_title_group_requires_review() -> None:
    current = [
        _current("Общая физика", 10, semester=1),
        _current("Общая физика", 11, semester=2),
    ]
    revised = reconcile_curriculum_rows(
        PLAN_KEY,
        [
            _incoming("Общая физика", 1, semester=1),
            _incoming("Общая физика", 2, semester=3),
        ],
        current,
        complete_scope=True,
    )
    assert [row.status for row in revised.rows] == ["matched", "ambiguous"]
    assert revised.rows[0].canonical_external_key == f"curriculum_item:{PLAN_KEY}:row:10"
    assert revised.rows[1].suggested_existing_keys == (f"curriculum_item:{PLAN_KEY}:row:11",)
    assert revised.potentially_removed == ()


def test_rename_is_ambiguous_and_similarity_never_becomes_identity() -> None:
    current = [_current("Математический анализ", 1)]
    renamed = reconcile_curriculum_rows(
        PLAN_KEY,
        [_incoming("Математический анализ II", 1)],
        current,
    )
    row = renamed.rows[0]
    assert row.status == "ambiguous"
    assert row.canonical_external_key.startswith("curriculum_observation:")
    assert row.suggested_existing_keys == (f"curriculum_item:{PLAN_KEY}:row:1",)


def test_source_signature_ignores_locator_and_mutable_academic_facts() -> None:
    first = _incoming("Математический анализ", 1, semester=1, hours=72)
    repeated = _incoming("Математический анализ", 18, semester=4, hours=180, assessment_type="Экзамен")
    assert stable_source_identity_key(PLAN_KEY, first) == stable_source_identity_key(PLAN_KEY, repeated)
    assert observation_identity_key(PLAN_KEY, first) != observation_identity_key(PLAN_KEY, repeated)


def test_missing_plan_identity_fails_closed() -> None:
    with pytest.raises(CurriculumIdentityError, match="exact study-plan key"):
        reconcile_curriculum_rows("plan:unknown", [_incoming("A", 1)], [])


def test_normalizer_preserves_same_discipline_semester_rows_for_review() -> None:
    base_id = "curriculum-item:program:bmstu:01.03.02-01:discipline:0123456789abcdef:1"
    first = CurriculumItem(
        id=base_id,
        discipline_id="discipline:0123456789abcdef",
        source_name="Физика",
        semester=1,
        hours=72,
        parsed_position=1,
    )
    second = first.model_copy(update={"parsed_position": 2, "hours": 108})
    items: list[CurriculumItem] = []

    _append_curriculum_item(items, first)
    _append_curriculum_item(items, second)

    assert len(items) == 2
    assert {item.identity_status for item in items} == {"ambiguous"}
    assert len({item.id for item in items}) == 2
    assert [item.hours for item in items] == [72, 108]
