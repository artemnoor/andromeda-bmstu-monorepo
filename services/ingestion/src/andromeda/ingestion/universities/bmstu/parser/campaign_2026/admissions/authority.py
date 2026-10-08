from __future__ import annotations

import re
from collections import defaultdict
from typing import Any, Iterable

from ..common import clean_text


AUTHORITATIVE_PLAN_REFERENCE = "local://user-attachment/bmstu-2026/admission-plan-appendix-8-1.pdf"
AUTHORITATIVE_PLAN_SOURCE_TYPE = "user_provided_authoritative_admission_plan"
AUTHORITATIVE_PLAN_NOTE = (
    "Original user attachment: БС.pdf. The user designated its BMSTU 2026 Appendix 8.1 as the primary source. "
    "No public download URL for this exact byte file was supplied."
)
EXPECTED_MOSCOW_OFFERING_ROWS = 127


def _title_key(value: object) -> str:
    return re.sub(r"[^0-9a-zа-яё]+", " ", clean_text(value).casefold()).strip()


def _official_tokens(value: str, known_codes: Iterable[str]) -> list[str]:
    found: list[str] = []
    for code in sorted({clean_text(code) for code in known_codes if clean_text(code)}, key=len, reverse=True):
        if re.search(rf"(?<![0-9A-Za-zА-Яа-яЁё]){re.escape(code)}(?![0-9A-Za-zА-Яа-яЁё])", value, re.IGNORECASE):
            found.append(code)
    return found


def build_authoritative_intake_records(
    source_offers: list[dict[str, Any]],
    source_rows: list[dict[str, Any]],
    *,
    directions: list[dict[str, Any]],
    departments: list[dict[str, Any]],
    programs: list[dict[str, Any]],
    campaign_key: str,
    source_url: str,
    source_artifact_key: str | None,
    source_retrieved_at: str | None,
    source_sha256: str,
    previous_offerings: list[dict[str, Any]] | None = None,
) -> tuple[
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
]:
    """Join Appendix 8.1 rows without weakening its explicit-code evidence.

    Returns Moscow offerings, derived competition pools, table source rows,
    manual-review entries, and exact offering-to-pool relationships. The source
    Appendix reports general and quota seat counts at offering-row grain; values
    from different offers are never consolidated into a direction-wide pool.
    """
    direction_by_code = {clean_text(item.get("code")): item for item in directions if item.get("code")}
    department_by_code = {clean_text(item.get("code")): item for item in departments if item.get("code")}
    department_codes = set(department_by_code)
    program_signatures: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for program in programs:
        signature = (
            clean_text(program.get("direction_code")),
            clean_text(program.get("department_code")),
            _title_key(program.get("name")),
        )
        program_signatures[signature].append(program)

    old_by_program: dict[str, dict[str, Any]] = {}
    for old in previous_offerings or []:
        key = old.get("educational_program_key")
        if key:
            old_by_program[key] = old

    manual: list[dict[str, Any]] = []
    offerings: list[dict[str, Any]] = []
    relationships: list[dict[str, Any]] = []
    relationship_keys: set[tuple[str, str]] = set()
    source_row_key_by_locator: dict[tuple[int, int, int], str] = {}
    pools: dict[str, dict[str, Any]] = {}

    def review(record_key: str, issue: str, details: str) -> None:
        manual.append({
            "record_key": record_key,
            "issue_type": issue,
            "source_url": source_url,
            "details": re.sub(r"\s+", " ", clean_text(details)),
        })

    def add_offering_pool(pool: dict[str, Any], offering_key: str, *, quota_type: str) -> None:
        key = pool["external_key"]
        locator = pool["places_by_source_row"][0]["locator"]
        existing = pools.get(key)
        if existing is None:
            pools[key] = pool
        else:
            observed = {item["places"] for item in existing["places_by_source_row"]}
            observed.add(pool["places"])
            for item in pool["places_by_source_row"]:
                if item not in existing["places_by_source_row"]:
                    existing["places_by_source_row"].append(item)
            for source_locator in pool["source_locators"]:
                if source_locator not in existing["source_locators"]:
                    existing["source_locators"].append(source_locator)
            if len(observed) > 1:
                existing["places"] = None
                existing["conflicting_reported_places"] = sorted(observed)
                review(
                    key,
                    "authoritative_offering_quota_conflict",
                    f"The same exact offering/quota identity has conflicting {quota_type} values {sorted(observed)}.",
                )
        relation_identity = (offering_key, key)
        if relation_identity not in relationship_keys:
            relationship_keys.add(relation_identity)
            relation_key = f"relationship:bmstu:offering-pool:{offering_key}:{key}"
            relationships.append({
                "external_key": relation_key,
                "relation_type": "offering_competes_in_pool",
                "source_key": offering_key,
                "target_key": key,
                "evidence_kind": "explicit_appendix_8_1_offering_row",
                "source_artifact_key": pool.get("source_artifact_key"),
                "source_url": pool.get("source_url"),
                "source_locator": locator,
            })

    def add_offering_quota(offer: dict[str, Any], field: str, legacy_field: str, quota_type: str) -> None:
        code = offer.get("direction_code")
        amount = offer.get(field)
        if amount is None:
            amount = offer.get(legacy_field)
        if not code or amount is None:
            return
        offering_key = offer["external_key"]
        key = f"competition_pool:bmstu:2026:{offering_key}:budget:{quota_type}"
        source_locators = offer.get("source_locators")
        if not isinstance(source_locators, list) or not source_locators:
            source_locators = [offer["source_locator"]]
        pool = {
            "external_key": key,
            "campaign_year": 2026,
            "direction_code": code,
            "department_code": offer.get("department_code"),
            "quota_type": quota_type,
            "funding_type": "budget",
            "places": amount,
            "places_by_source_row": [{"places": amount, "locator": offer["source_locator"]}],
            "scope_level": "offering",
            "program_offering_key": offering_key,
            "source_url": source_url,
            "source_locators": list(source_locators),
            "source_authority": "user_assigned_primary_source",
            "source_artifact_key": offer.get("source_artifact_key"),
            "source_retrieved_at": offer.get("source_retrieved_at"),
            "source_sha256": offer.get("source_sha256"),
        }
        add_offering_pool(pool, offering_key, quota_type=quota_type)

    for source in source_offers:
        raw_department = clean_text(source.get("department_code_in_document"))
        source_department_values = [raw_department]
        source_department_values.extend(
            clean_text(row.get("department_code_in_document"))
            for row in source.get("department_rows_in_document", [])
            if isinstance(row, dict)
        )
        explicit_department_codes = list(dict.fromkeys(
            code
            for value in source_department_values
            for code in _official_tokens(value, department_codes)
        ))
        direction_codes = [clean_text(code) for code in source.get("direction_codes_in_document", []) if clean_text(code)]
        exact_candidates: list[dict[str, Any]] = []
        for direction_code in direction_codes:
            for department_code in explicit_department_codes:
                exact_candidates.extend(program_signatures.get((
                    direction_code,
                    department_code,
                    _title_key(source.get("program_name_in_document")),
                ), []))
        # One profile can be encountered twice when source cells repeat a code;
        # dedupe by its stable external key before deciding if the link is exact.
        candidates = {item["external_key"]: item for item in exact_candidates if item.get("external_key")}
        program = next(iter(candidates.values())) if len(candidates) == 1 else None
        direction_code = clean_text(program.get("direction_code")) if program else (
            direction_codes[0] if len(direction_codes) == 1 else None
        )
        department_code = explicit_department_codes[0] if len(explicit_department_codes) == 1 else None
        direction = direction_by_code.get(direction_code or "")
        department = department_by_code.get(department_code or "")
        department_keys = [
            department_by_code[code]["external_key"]
            for code in explicit_department_codes
            if code in department_by_code
        ]
        profile_key = program.get("external_key") if program else None
        locator = source["source_locator"]
        offering_key = source["external_key"]
        for source_locator in source.get("source_locators", [locator]):
            source_row_key_by_locator[(source_locator["page"], source_locator["table"], source_locator["row"])] = offering_key

        prior = old_by_program.get(profile_key) if profile_key else None
        record = {
            "external_key": offering_key,
            "campaign_key": campaign_key,
            "campaign_year": 2026,
            "direction_key": direction.get("external_key") if direction else None,
            "educational_program_key": profile_key,
            "department_key": department.get("external_key") if department else None,
            "direction_code": direction_code,
            "direction_codes_in_document": direction_codes,
            "department_code": department_code,
            "department_codes_in_document": explicit_department_codes,
            "department_keys_in_document": department_keys,
            "department_code_in_document": raw_department,
            "department_rows_in_document": source.get("department_rows_in_document", []),
            "department_name_in_document": source.get("department_name_in_document"),
            "program_name_in_document": source.get("program_name_in_document"),
            "study_form": prior.get("study_form") if prior else None,
            "language": prior.get("language") if prior else None,
            "campus_scope": "head_moscow",
            "study_duration_label": source.get("study_duration_label"),
            "seat_scope_in_document": source.get("seat_scope_in_document"),
            "budget_places_at_department": source.get("budget_places_at_department"),
            "paid_places_at_department": source.get("paid_places_at_department"),
            "special_quota_places_at_offering": source.get("special_quota_places_at_offering")
            if source.get("special_quota_places_at_offering") is not None
            else source.get("special_quota_places_direction"),
            "separate_quota_places_at_offering": source.get("separate_quota_places_at_offering")
            if source.get("separate_quota_places_at_offering") is not None
            else source.get("separate_quota_places_direction"),
            "source_url": source_url,
            "source_locator": locator,
            "source_locators": source.get("source_locators", [locator]),
            "source_row": source.get("source_row", []),
            "source_authority": "user_assigned_primary_source",
            "source_authority_note": "For values printed in the attached 2026 Appendix 8.1, this source overrides conflicting website captures.",
            "source_artifact_key": source_artifact_key,
            "source_retrieved_at": source_retrieved_at,
            "source_sha256": source_sha256,
            "catalog_join_status": "exact_official_codes_and_profile_name" if program else "unresolved",
        }
        offerings.append(record)

        if not direction_codes:
            review(offering_key, "authoritative_offering_direction_code_missing", "The row has no recoverable direction code; the original row is retained with a null direction link.")
        elif direction_code and not direction:
            review(offering_key, "authoritative_offering_direction_not_in_catalog", f"Direction {direction_code} from the primary PDF is not present in the included Moscow catalog; the printed code is retained.")
        elif len(direction_codes) > 1 and not program:
            review(offering_key, "authoritative_offering_direction_code_composite", f"The source row lists multiple direction codes {direction_codes}; no single catalog direction was selected.")
        if len(explicit_department_codes) > 1 and not program:
            review(offering_key, "authoritative_offering_department_codes_composite", f"The source row names multiple catalog department codes {explicit_department_codes}; no single department was selected.")
        if not explicit_department_codes:
            review(offering_key, "authoritative_offering_department_code_unresolved", f"Could not map the source chair field {raw_department!r} to an official department code in the included catalog.")
        elif department_code and not department:
            review(offering_key, "authoritative_offering_department_not_in_catalog", f"Department {department_code} from the primary PDF is not present in the included Moscow catalog; the printed chair field is retained.")
        if not program:
            review(offering_key, "offering_to_catalog_profile_unresolved", f"Exact direction code, an explicit department code in the source chair cell, and profile name yielded {len(candidates)} catalog profiles; the authoritative offer remains unlinked.")
        if len(direction_codes) > 1 and program:
            review(offering_key, "authoritative_offering_has_combined_direction_codes", f"The row prints {direction_codes}; the exact department and profile-name match identifies catalog direction {direction_code}, while the full source cell remains preserved.")
        if len(explicit_department_codes) > 1 and program:
            review(offering_key, "authoritative_offering_has_combined_department_codes", f"The row prints department codes {explicit_department_codes}; the exact profile match identifies {department_code}, while all printed codes remain preserved.")
            review(offering_key, "authoritative_offering_department_group_requires_relational_load", "The PDF merges this profile across multiple department rows. All explicit department keys are retained as record values and relationships; the current ORM has no offer-to-many-departments field.")

        for funding_type, field in (("budget", "budget_places_at_department"), ("paid", "paid_places_at_department")):
            amount = source.get(field)
            if amount is None or not direction_code:
                if amount is not None:
                    review(offering_key, "authoritative_seat_count_scope_unresolved", f"{field}={amount} is preserved on the offer but cannot be linked to one direction/department pool.")
                continue
            pool_key = f"competition_pool:bmstu:2026:{offering_key}:{funding_type}:general_competition"
            pool = {
                "external_key": pool_key,
                "campaign_year": 2026,
                "direction_code": direction_code,
                "department_code": department_code,
                "quota_type": "general_competition",
                "funding_type": funding_type,
                "places": amount,
                "places_by_source_row": [{"places": amount, "locator": locator}],
                "scope_level": "offering",
                "program_offering_key": offering_key,
                "source_url": source_url,
                "source_locators": [locator],
                "source_authority": "user_assigned_primary_source",
                "source_artifact_key": source_artifact_key,
                "source_retrieved_at": source_retrieved_at,
                "source_sha256": source_sha256,
            }
            add_offering_pool(pool, offering_key, quota_type="general_competition")
        add_offering_quota(
            record,
            "special_quota_places_at_offering",
            "special_quota_places_direction",
            "special",
        )
        add_offering_quota(
            record,
            "separate_quota_places_at_offering",
            "separate_quota_places_direction",
            "separate",
        )

    for row in source_rows:
        locator = row.get("source_locator", {})
        locator_key = (locator.get("page"), locator.get("table"), locator.get("row"))
        row["normalized_offering_key"] = source_row_key_by_locator.get(locator_key) or row.get("normalized_offering_key")
        if source_artifact_key:
            row["source_artifact_key"] = source_artifact_key
            row["source_retrieved_at"] = source_retrieved_at
            row["source_sha256"] = source_sha256
        row["source_authority"] = "user_assigned_primary_source"

    if len(offerings) != EXPECTED_MOSCOW_OFFERING_ROWS:
        review(
            "admission_plan:bmstu:2026:moscow",
            "authoritative_moscow_row_count_differs_from_reviewed_attachment",
            f"The reviewed attachment has {EXPECTED_MOSCOW_OFFERING_ROWS} Moscow offering rows; the current parse produced {len(offerings)}. Confirm any corrected official version before loading.",
        )
    return offerings, list(pools.values()), source_rows, manual, relationships


__all__ = [
    "AUTHORITATIVE_PLAN_NOTE",
    "AUTHORITATIVE_PLAN_REFERENCE",
    "AUTHORITATIVE_PLAN_SOURCE_TYPE",
    "EXPECTED_MOSCOW_OFFERING_ROWS",
    "build_authoritative_intake_records",
]
