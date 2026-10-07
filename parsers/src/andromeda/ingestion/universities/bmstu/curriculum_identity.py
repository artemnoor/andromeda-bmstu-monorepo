"""Conservative identity reconciliation for BMSTU study-plan rows.

The PDF layouts inspected so far do not expose a stable discipline code. This
module therefore separates a version-independent source signature from the
canonical importer key and treats locators as provenance only.
"""

from __future__ import annotations

from dataclasses import dataclass
from difflib import SequenceMatcher
from hashlib import sha256
import json
import re
import unicodedata
from typing import Any, Literal


IDENTITY_ALGORITHM = "bmstu-curriculum-identity-v1"
_SIMILARITY_HINT_THRESHOLD = 0.72
IdentityStatus = Literal["matched", "new", "ambiguous"]


class CurriculumIdentityError(ValueError):
    """An exact curriculum plan or item identity is invalid or duplicated."""


@dataclass(frozen=True, slots=True)
class CurriculumIdentityResolution:
    status: IdentityStatus
    canonical_external_key: str | None
    source_identity_key: str | None
    suggested_existing_keys: tuple[str, ...]
    reason: str
    metadata: dict[str, Any]


@dataclass(frozen=True, slots=True)
class CurriculumIdentityReconciliation:
    rows: tuple[CurriculumIdentityResolution, ...]
    potentially_removed: tuple[str, ...]

    @property
    def counts(self) -> dict[str, int]:
        result = {"matched": 0, "new": 0, "ambiguous": 0, "potentially_removed": len(self.potentially_removed)}
        for row in self.rows:
            result[row.status] += 1
        return result


def normalize_curriculum_label(value: Any) -> str:
    """Normalize only lossless presentation differences; preserve spelling."""

    if not isinstance(value, str):
        return ""
    return " ".join(unicodedata.normalize("NFKC", value.replace("\xa0", " ")).casefold().split())


def stable_source_identity_key(
    study_plan_key: str,
    row: dict[str, Any],
    *,
    duplicate_title: bool = False,
) -> str:
    """Return a deterministic exact-source identity hash, independent of order.

    Semester is included only to distinguish otherwise identical repeated
    titles. A later semester change in such a group must be reviewed.
    """

    if not _valid_plan_key(study_plan_key):
        raise CurriculumIdentityError("curriculum source identity requires an exact study-plan key")
    name = _row_name(row)
    if not name:
        raise CurriculumIdentityError("curriculum source identity requires a non-empty exact discipline name")
    signals = _identity_signals(row)
    identity: dict[str, Any] = {
        "algorithm": IDENTITY_ALGORITHM,
        "study_plan_key": study_plan_key,
        **signals,
    }
    if duplicate_title:
        semester = row.get("semester")
        if isinstance(semester, bool) or not isinstance(semester, int) or semester < 1:
            raise CurriculumIdentityError("repeated curriculum titles need an exact semester or manual identity review")
        identity["duplicate_title_semester"] = semester
    return _identity_key(identity)


def observation_identity_key(
    study_plan_key: str,
    row: dict[str, Any],
    *,
    source_sha256: str | None = None,
) -> str:
    """Return an observation-only key for a row that cannot be canonicalized."""

    if not _valid_plan_key(study_plan_key):
        raise CurriculumIdentityError("curriculum observation requires an exact study-plan key")
    locator = _source_locator(row)
    observation = {
        "algorithm": IDENTITY_ALGORITHM,
        "study_plan_key": study_plan_key,
        "source_sha256": source_sha256 or row.get("source_sha256"),
        "page": locator.get("page"),
        "printed_row_no": locator.get("printed_row_no"),
        "parsed_position": locator.get("parsed_position"),
        "semester": row.get("semester"),
        "name": normalize_curriculum_label(_row_name(row)),
    }
    return f"curriculum_observation:{study_plan_key}:sha256:{_identity_key(observation)}"


def reconcile_curriculum_rows(
    study_plan_key: str,
    incoming_rows: list[dict[str, Any]],
    current_rows: list[dict[str, Any]],
    *,
    complete_scope: bool = False,
) -> CurriculumIdentityReconciliation:
    """Reconcile incoming rows to current exact-plan rows without fuzzy merges.

    Matching order:

    1. A persisted exact identity signature, one-to-one.
    2. A unique exact normalized title within the exact plan and compatible
       chair/block context, regardless of semester.
    3. Repeated exact titles are disambiguated only by unique exact context and
       semester pairs. Residual rows are ambiguous.
    4. Similarity is returned only as a reviewer hint.
    """

    if not _valid_plan_key(study_plan_key):
        raise CurriculumIdentityError("curriculum reconciliation requires an exact study-plan key")
    _validate_rows(incoming_rows, "incoming")
    _validate_rows(current_rows, "current")

    incoming_count = len(incoming_rows)
    results: list[CurriculumIdentityResolution | None] = [None] * incoming_count
    matched_current: set[int] = set()
    protected_current: set[int] = set()

    current_by_key: dict[str, int] = {}
    for index, row in enumerate(current_rows):
        key = row.get("external_key")
        row_plan_key = row.get("curriculum_key") or row.get("study_plan_key")
        if row_plan_key != study_plan_key:
            continue
        if isinstance(key, str) and key:
            if key in current_by_key:
                raise CurriculumIdentityError("current curriculum rows contain duplicate exact external keys")
            current_by_key[key] = index

    # Exact persisted source identities survive reviewed title changes and
    # subsequent exports. Only use them when both sides identify one row.
    incoming_by_identity: dict[str, list[int]] = {}
    current_by_identity: dict[str, list[int]] = {}
    for index, row in enumerate(incoming_rows):
        identity = _persisted_identity(row)
        if identity:
            incoming_by_identity.setdefault(identity, []).append(index)
    for index, row in enumerate(current_rows):
        if (row.get("curriculum_key") or row.get("study_plan_key")) != study_plan_key:
            continue
        identity = _persisted_identity(row)
        if identity:
            current_by_identity.setdefault(identity, []).append(index)
    for identity, incoming_indices in incoming_by_identity.items():
        current_indices = current_by_identity.get(identity, [])
        if len(incoming_indices) != 1 or len(current_indices) != 1:
            continue
        incoming_index, current_index = incoming_indices[0], current_indices[0]
        if _is_ambiguous(incoming_rows[incoming_index]) or _is_ambiguous(current_rows[current_index]):
            continue
        key = current_rows[current_index].get("external_key")
        if not isinstance(key, str) or not key:
            continue
        results[incoming_index] = _resolution(
            "matched", key, identity, (), "persisted exact source identity matches one current canonical row",
            study_plan_key, incoming_rows[incoming_index], duplicate_title=False,
        )
        matched_current.add(current_index)

    incoming_by_name: dict[str, list[int]] = {}
    current_by_name: dict[str, list[int]] = {}
    for index, row in enumerate(incoming_rows):
        if results[index] is None and (name := normalize_curriculum_label(_row_name(row))):
            incoming_by_name.setdefault(name, []).append(index)
    for index, row in enumerate(current_rows):
        if index not in matched_current and (row.get("curriculum_key") or row.get("study_plan_key")) == study_plan_key:
            if name := normalize_curriculum_label(_row_name(row)):
                current_by_name.setdefault(name, []).append(index)

    for name, incoming_indices in incoming_by_name.items():
        current_indices = current_by_name.get(name, [])
        if not current_indices:
            continue
        if len(incoming_indices) == 1 and len(current_indices) == 1:
            incoming_index, current_index = incoming_indices[0], current_indices[0]
            if _is_ambiguous(incoming_rows[incoming_index]) or _is_ambiguous(current_rows[current_index]):
                continue
            if _contexts_compatible(incoming_rows[incoming_index], current_rows[current_index]):
                key = current_rows[current_index].get("external_key")
                if isinstance(key, str) and key:
                    results[incoming_index] = _resolution(
                        "matched", key,
                        stable_source_identity_key(study_plan_key, incoming_rows[incoming_index]),
                        (), "unique exact title and plan match; mutable fields are excluded",
                        study_plan_key, incoming_rows[incoming_index], duplicate_title=False,
                    )
                    matched_current.add(current_index)
                    continue
            for candidate_index in incoming_indices:
                results[candidate_index] = _ambiguous_resolution(
                    study_plan_key, incoming_rows[candidate_index], current_rows,
                    [current_index], "exact title exists but exact chair/block context conflicts",
                )
            protected_current.add(current_index)
            continue

        # Repeated labels are grouped by exact context. When a context is
        # absent on one side it is a wildcard only if the pair remains unique.
        unresolved_incoming = set(incoming_indices)
        unresolved_current = set(current_indices)
        for incoming_index in incoming_indices:
            if results[incoming_index] is not None:
                unresolved_incoming.discard(incoming_index)
                continue
            compatible_current = [
                current_index for current_index in unresolved_current
                if _contexts_compatible(incoming_rows[incoming_index], current_rows[current_index])
                and _row_semester(incoming_rows[incoming_index]) == _row_semester(current_rows[current_index])
            ]
            if len(compatible_current) == 1:
                current_index = compatible_current[0]
                reverse = [
                    other_incoming for other_incoming in unresolved_incoming
                    if _contexts_compatible(incoming_rows[other_incoming], current_rows[current_index])
                    and _row_semester(incoming_rows[other_incoming]) == _row_semester(current_rows[current_index])
                ]
                if len(reverse) == 1 and not _is_ambiguous(incoming_rows[incoming_index]) and not _is_ambiguous(current_rows[current_index]):
                    if _row_semester(incoming_rows[incoming_index]) == _row_semester(current_rows[current_index]):
                        key = current_rows[current_index].get("external_key")
                        if isinstance(key, str) and key:
                            results[incoming_index] = _resolution(
                                "matched", key,
                                stable_source_identity_key(
                                    study_plan_key, incoming_rows[incoming_index], duplicate_title=True
                                ), (),
                                "repeated exact title matched by unique exact semester and source context",
                                study_plan_key, incoming_rows[incoming_index], duplicate_title=True,
                            )
                            matched_current.add(current_index)
                            unresolved_incoming.discard(incoming_index)
                            unresolved_current.discard(current_index)

        # Every unmatched row in a repeated title group is ambiguous, even if
        # the proposed semester happens to resemble one old row. A moved,
        # inserted, or deleted duplicate cannot be identified from this PDF.
        for incoming_index in sorted(unresolved_incoming):
            candidate_indices = [
                current_index for current_index in current_indices
                if current_index not in matched_current
                if _contexts_compatible(incoming_rows[incoming_index], current_rows[current_index])
            ] or [current_index for current_index in current_indices if current_index not in matched_current]
            results[incoming_index] = _ambiguous_resolution(
                study_plan_key, incoming_rows[incoming_index], current_rows,
                candidate_indices, "repeated exact title has no unique one-to-one source identity",
            )
            protected_current.update(candidate_indices)

    # Rows with no exact label counterpart may be renamed rows or genuinely
    # new courses. Similarity is only an explanation/hint and never a target.
    unmatched_current = [
        index for index, row in enumerate(current_rows)
        if index not in matched_current
        and (row.get("curriculum_key") or row.get("study_plan_key")) == study_plan_key
    ]
    for incoming_index, row in enumerate(incoming_rows):
        if results[incoming_index] is not None:
            continue
        if _is_ambiguous(row):
            candidates = [
                index for index in unmatched_current
                if _contexts_compatible(row, current_rows[index])
                and _row_semester(row) == _row_semester(current_rows[index])
            ]
            results[incoming_index] = _ambiguous_resolution(
                study_plan_key, row, current_rows, candidates,
                "parser marked duplicate source identity as ambiguous",
            )
            protected_current.update(candidates)
            continue
        hints = _similarity_hints(row, current_rows, unmatched_current)
        if hints:
            results[incoming_index] = _ambiguous_resolution(
                study_plan_key, row, current_rows, hints,
                "similar source labels are reviewer hints only; exact identity is unresolved",
            )
            protected_current.update(hints)
            continue

        name = normalize_curriculum_label(_row_name(row))
        incoming_same_name = [
            other for other in incoming_rows
            if normalize_curriculum_label(_row_name(other)) == name
            and _context_signature(other) == _context_signature(row)
        ]
        duplicate_title = len(incoming_same_name) > 1
        if duplicate_title:
            semesters = [_row_semester(other) for other in incoming_same_name]
            if any(value is None for value in semesters) or len(semesters) != len(set(semesters)):
                results[incoming_index] = _ambiguous_resolution(
                    study_plan_key, row, current_rows, (),
                    "new duplicate titles lack a unique exact semester/context discriminator",
                )
                continue
        identity = stable_source_identity_key(study_plan_key, row, duplicate_title=duplicate_title)
        key = _canonical_external_key(study_plan_key, identity)
        results[incoming_index] = _resolution(
            "new", key, identity, (), "no exact existing item or reviewer hint; deterministic source identity assigned",
            study_plan_key, row, duplicate_title=duplicate_title,
        )

    removed: tuple[str, ...] = ()
    if complete_scope:
        removed = tuple(sorted(
            str(row["external_key"])
            for index, row in enumerate(current_rows)
            if (row.get("curriculum_key") or row.get("study_plan_key")) == study_plan_key
            and index not in matched_current
            and index not in protected_current
            and isinstance(row.get("external_key"), str)
        ))
    return CurriculumIdentityReconciliation(tuple(value for value in results if value is not None), removed)


def _resolution(
    status: IdentityStatus,
    key: str | None,
    source_identity: str | None,
    candidates: tuple[str, ...],
    reason: str,
    plan_key: str,
    row: dict[str, Any],
    *,
    duplicate_title: bool,
) -> CurriculumIdentityResolution:
    identity_metadata: dict[str, Any] = {
        "algorithm": IDENTITY_ALGORITHM,
        "source_identity_key": source_identity,
        "signals": _identity_signals(row),
        "duplicate_title_semester": _row_semester(row) if duplicate_title else None,
    }
    metadata: dict[str, Any] = {
        **identity_metadata,
        "status": status,
        "canonical_external_key": key if status == "matched" else None,
    }
    return CurriculumIdentityResolution(status, key, source_identity, candidates, reason, metadata)


def _ambiguous_resolution(
    plan_key: str,
    row: dict[str, Any],
    current_rows: list[dict[str, Any]],
    candidate_indices: list[int],
    reason: str,
) -> CurriculumIdentityResolution:
    candidate_keys = tuple(sorted({
        str(current_rows[index]["external_key"])
        for index in candidate_indices
        if isinstance(current_rows[index].get("external_key"), str)
    }))
    observation = observation_identity_key(plan_key, row, source_sha256=row.get("source_sha256"))
    metadata = {
        "algorithm": IDENTITY_ALGORITHM,
        "status": "ambiguous",
        "source_identity_key": None,
        "signals": _identity_signals(row),
        "canonical_external_key": None,
        "observation_external_key": observation,
        "suggested_existing_keys": list(candidate_keys),
        "reason": reason,
    }
    return CurriculumIdentityResolution("ambiguous", observation, None, candidate_keys, reason, metadata)


def _similarity_hints(row: dict[str, Any], current_rows: list[dict[str, Any]], indices: list[int]) -> list[int]:
    name = normalize_curriculum_label(_row_name(row))
    hints: list[tuple[float, int]] = []
    for index in indices:
        current = current_rows[index]
        if not _contexts_compatible(row, current):
            continue
        if not isinstance(current.get("external_key"), str):
            continue
        ratio = SequenceMatcher(None, name, normalize_curriculum_label(_row_name(current)), autojunk=False).ratio()
        if ratio >= _SIMILARITY_HINT_THRESHOLD:
            hints.append((ratio, index))
    hints.sort(key=lambda value: (-value[0], str(current_rows[value[1]].get("external_key"))))
    return [index for _, index in hints[:5]]


def _contexts_compatible(left: dict[str, Any], right: dict[str, Any]) -> bool:
    left_context = _context_signature(left)
    right_context = _context_signature(right)
    return all(not a or not b or a == b for a, b in zip(left_context, right_context))


def _context_signature(row: dict[str, Any]) -> tuple[str, str, str]:
    source_row = row.get("source_row")
    identity = source_row.get("identity") if isinstance(source_row, dict) else None
    signals = identity.get("signals") if isinstance(identity, dict) else None
    signals = signals if isinstance(signals, dict) else {}
    return (
        normalize_curriculum_label(row.get("chair") or row.get("chair_code") or signals.get("chair_code")),
        normalize_curriculum_label(row.get("course_block") or row.get("block") or signals.get("course_block")),
        normalize_curriculum_label(row.get("source_part") or row.get("block_part") or signals.get("source_part")),
    )


def _identity_signals(row: dict[str, Any]) -> dict[str, Any]:
    chair, block, part = _context_signature(row)
    return {
        "discipline_name": normalize_curriculum_label(_row_name(row)),
        "chair_code": chair or None,
        "course_block": block or None,
        "source_part": part or None,
    }


def _source_locator(row: dict[str, Any]) -> dict[str, Any]:
    locator = row.get("source_locator")
    locator = locator if isinstance(locator, dict) else {}
    result = {
        "page": row.get("source_page", locator.get("page")),
        "printed_row_no": row.get("row_no", row.get("printed_row_no", locator.get("printed_row_no", locator.get("row")))),
        "parsed_position": row.get("parsed_position", locator.get("parsed_position", row.get("source_position"))),
    }
    return {key: value for key, value in result.items() if value is not None}


def _row_name(row: dict[str, Any]) -> Any:
    return row.get("discipline") or row.get("source_name")


def _row_semester(row: dict[str, Any]) -> int | None:
    value = row.get("semester")
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _persisted_identity(row: dict[str, Any]) -> str | None:
    source_row = row.get("source_row")
    identity = source_row.get("identity") if isinstance(source_row, dict) else None
    key = (
        identity.get("source_identity_id") or identity.get("source_identity_key")
        if isinstance(identity, dict) else None
    )
    return key if isinstance(key, str) and key.startswith("curriculum-source-identity:") else None


def _is_ambiguous(row: dict[str, Any]) -> bool:
    if row.get("identity_status") == "ambiguous":
        return True
    source_row = row.get("source_row")
    identity = source_row.get("identity") if isinstance(source_row, dict) else None
    return isinstance(identity, dict) and identity.get("status") == "ambiguous"


def _identity_key(identity: dict[str, Any]) -> str:
    encoded = json.dumps(identity, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return f"curriculum-source-identity:{sha256(encoded.encode('utf-8')).hexdigest()}"


def _canonical_external_key(plan_key: str, source_identity_key: str) -> str:
    digest = source_identity_key.removeprefix("curriculum-source-identity:")
    return f"curriculum_item:{plan_key}:identity:{digest}"


def _valid_plan_key(value: str) -> bool:
    return isinstance(value, str) and value.startswith("study_plan:") and len(value) <= 160 and not value.endswith(":")


def _validate_rows(rows: list[dict[str, Any]], label: str) -> None:
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            raise CurriculumIdentityError(f"{label} curriculum row {index} is not an object")
        if not normalize_curriculum_label(_row_name(row)):
            raise CurriculumIdentityError(f"{label} curriculum row {index} has no exact discipline name")


__all__ = [
    "IDENTITY_ALGORITHM",
    "CurriculumIdentityError",
    "CurriculumIdentityReconciliation",
    "CurriculumIdentityResolution",
    "normalize_curriculum_label",
    "observation_identity_key",
    "reconcile_curriculum_rows",
    "stable_source_identity_key",
]
