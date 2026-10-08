"""Review-gated bridge from canonical BMSTU output to the existing importer."""

from __future__ import annotations

import csv
from datetime import datetime
import hashlib
import json
import logging
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tempfile
from typing import Any
from urllib.parse import urlsplit, urlunsplit
from uuid import UUID

from andromeda_parser.ingest import IngestionError, _assert_safe_payload
from andromeda.ingestion.universities.bmstu.curriculum_identity import (
    observation_identity_key,
    reconcile_curriculum_rows,
)


logger = logging.getLogger("andromeda.ingestion.bundle")
CANDIDATE_FILE = "data/bmstu_ingestion_candidates.jsonl"
CANDIDATE_MANIFEST = "ingestion_candidate_manifest.json"
SOURCE_ARTIFACTS = "source_artifacts.jsonl"
OBSERVATION_DATASET = "data/admission_information_source_tables.jsonl"
REVIEW_HEADERS = ("record_key", "issue_type", "source_url", "details")
DECISION_HEADERS = (
    "external_key",
    "decision",
    "reviewed_at",
    "target_external_key",
)


def _fact_candidate_key(dataset: str, source_key: str, capture_digest: str) -> str:
    identity = hashlib.sha256(f"{dataset}\0{source_key}\0{capture_digest}".encode("utf-8")).hexdigest()
    return f"bmstu_fact_candidate:{identity}"


def _candidate_ref(candidate_key: str) -> dict[str, str]:
    return {"$candidate_ref": candidate_key}


def _resolve_candidate_refs(value: Any, targets: dict[str, str]) -> Any:
    if isinstance(value, dict):
        if set(value) == {"$candidate_ref"}:
            reference = value["$candidate_ref"]
            if reference not in targets:
                raise IngestionError("accepted fact references a missing or rejected exact-key candidate")
            return targets[reference]
        return {key: _resolve_candidate_refs(child, targets) for key, child in value.items()}
    if isinstance(value, list):
        return [_resolve_candidate_refs(child, targets) for child in value]
    return value


def _source_provenance(
    *,
    sources: list[dict[str, Any]],
    source_url: Any = None,
    source_hash: Any = None,
    captured_at: Any = None,
    locator: Any = None,
) -> dict[str, Any]:
    source: dict[str, Any] | None = None
    if isinstance(source_hash, str):
        source = next((row for row in sources if row.get("sha256") == source_hash), None)
    if source is None and isinstance(source_url, str):
        safe_url = _safe_source_url(source_url)
        source = next(
            (row for row in sources if row.get("requested_url") == safe_url or row.get("final_url") == safe_url),
            None,
        )
    if source is None and sources:
        source = sources[0]
    if source is None:
        raise IngestionError("typed fact has no source-artifact provenance")
    return {
        "source_artifact_key": source["source_artifact_key"],
        "source_sha256": source["sha256"],
        "source_url": _safe_source_url(source_url) if isinstance(source_url, str) else source["requested_url"],
        "source_retrieved_at": captured_at or source["captured_at"],
        "source_locator": locator,
    }


def _build_typed_candidates(
    *,
    normalized: dict[str, Any],
    sources: list[dict[str, Any]],
    capture_digest: str,
    existing_campaign_keys: set[str],
    existing_funding_keys: set[str],
    existing_quota_keys: set[str],
    current_curriculum_rows: list[dict[str, Any]],
    current_study_plans: list[dict[str, Any]],
    current_directions: list[dict[str, Any]],
    current_departments: list[dict[str, Any]],
    current_programs: list[dict[str, Any]],
    current_offerings: list[dict[str, Any]],
    current_competition_pools: list[dict[str, Any]],
    current_relationships: list[dict[str, Any]],
    current_manual_review_rows: list[dict[str, str]],
) -> tuple[list[dict[str, Any]], list[dict[str, str]], list[dict[str, Any]]]:
    """Project canonical parser facts into review-gated existing bundle contracts."""

    candidates: list[dict[str, Any]] = []
    manual_findings: list[dict[str, Any]] = []

    def add(
        dataset: str,
        source_key: str,
        suggested_target: str,
        row: dict[str, Any],
        provenance: dict[str, Any],
    ) -> str:
        candidate_key = _fact_candidate_key(dataset, source_key, capture_digest)
        payload = {
            **row,
            "external_key": suggested_target,
            **provenance,
        }
        _assert_safe_payload(payload)
        payload_json = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        candidates.append(
            {
                "external_key": candidate_key,
                "candidate_type": "typed_record",
                "target_dataset": dataset,
                "source_identity": source_key,
                "suggested_target": suggested_target,
                "source_capture_digest": capture_digest,
                "source_artifact_key": provenance["source_artifact_key"],
                "review_state": "pending",
                "payload_json": payload_json,
                "payload_sha256": hashlib.sha256(payload_json.encode("utf-8")).hexdigest(),
            }
        )
        return candidate_key

    def artifact_for(
        provenance_rows: Any = (),
        *,
        source_url: Any = None,
        fallback_url: Any = None,
        locator: Any = None,
    ) -> dict[str, Any]:
        attribution = next(iter(provenance_rows), {}) if isinstance(provenance_rows, (list, tuple)) else {}
        return _source_provenance(
            sources=sources,
            source_url=attribution.get("url") or attribution.get("source_url") or source_url or fallback_url,
            source_hash=attribution.get("content_sha256"),
            captured_at=attribution.get("captured_at"),
            locator=attribution.get("locator") or locator,
        )

    authoritative_plan = normalized.get("authoritative_admission_plan")
    if isinstance(authoritative_plan, dict):
        year = authoritative_plan.get("campaign_year")
        campaign_key = f"campaign:bmstu:{year}"
        if not isinstance(year, int) or campaign_key not in existing_campaign_keys:
            raise IngestionError("authoritative admission plan requires its exact campaign in the active release")
        source_hash = authoritative_plan.get("source_sha256")
        captured_at = authoritative_plan.get("source_retrieved_at")
        if not isinstance(source_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", source_hash):
            raise IngestionError("authoritative admission plan has an invalid PDF SHA-256")
        source = next((row for row in sources if row.get("sha256") == source_hash), None)
        if source is None:
            raise IngestionError("authoritative admission plan PDF is absent from parser provenance")
        source_artifact_key = source["source_artifact_key"]
        source_offers = authoritative_plan.get("source_offers")
        source_rows = authoritative_plan.get("source_rows")
        if not isinstance(source_offers, list) or not isinstance(source_rows, list):
            raise IngestionError("authoritative admission plan parse output is incomplete")

        from andromeda.ingestion.universities.bmstu.parser.campaign_2026.admissions.authority import (
            AUTHORITATIVE_PLAN_REFERENCE,
            build_authoritative_intake_records,
        )

        offers, pools, _raw_rows, findings, relationships = build_authoritative_intake_records(
            source_offers,
            source_rows,
            directions=current_directions,
            departments=current_departments,
            programs=current_programs,
            campaign_key=campaign_key,
            source_url=AUTHORITATIVE_PLAN_REFERENCE,
            source_artifact_key=source_artifact_key,
            source_retrieved_at=captured_at,
            source_sha256=source_hash,
            previous_offerings=current_offerings,
        )
        if len(offers) != len(source_offers):
            raise IngestionError("authoritative admission plan rows did not map one-to-one")

        existing_offering_keys = {str(row.get("external_key")) for row in current_offerings}
        if any(str(row.get("external_key")) not in existing_offering_keys for row in offers):
            raise IngestionError(
                "the active release does not contain every exact Appendix 8.1 offering; review offer identity first"
            )

        existing_pools = {str(row.get("external_key")): row for row in current_competition_pools}
        pool_candidate_by_key: dict[str, str] = {}
        for pool in pools:
            pool_key = str(pool["external_key"])
            current = existing_pools.get(pool_key)
            if current is not None:
                comparable_fields = (
                    "campaign_year", "direction_code", "department_code", "funding_type",
                    "quota_type", "places", "scope_level",
                )
                if any(current.get(field) != pool.get(field) for field in comparable_fields):
                    provenance = artifact_for(
                        [{"content_sha256": source_hash, "captured_at": captured_at}],
                        locator=(pool.get("source_locators") or [None])[0],
                    )
                    add(
                        "competition_pools.jsonl",
                        pool_key,
                        pool_key,
                        {
                            "linked_campaign_key": campaign_key,
                            "campaign_year": year,
                            "direction_code": pool.get("direction_code"),
                            "department_code": pool.get("department_code"),
                            "funding_type": pool.get("funding_type"),
                            "funding_type_key": f"funding_type:{pool.get('funding_type')}",
                            "quota_type": pool.get("quota_type"),
                            "quota_type_key": f"quota_type:{pool.get('quota_type')}",
                            "places": pool.get("places"),
                            "scope_level": pool.get("scope_level"),
                            "places_by_source_row": pool.get("places_by_source_row"),
                            "source_locators": pool.get("source_locators"),
                        },
                        provenance,
                    )
                continue
            if pool.get("places") is None:
                findings.append({
                    "record_key": pool_key,
                    "issue_type": "authoritative_offering_quota_conflict",
                    "source_url": AUTHORITATIVE_PLAN_REFERENCE,
                    "details": "The same exact offering/quota identity has conflicting source values; the pool was not staged.",
                })
                continue
            provenance = artifact_for(
                [{"content_sha256": source_hash, "captured_at": captured_at}],
                locator=(pool.get("source_locators") or [None])[0],
            )
            candidate_key = add(
                "competition_pools.jsonl",
                pool_key,
                pool_key,
                {
                    "linked_campaign_key": campaign_key,
                    "campaign_year": year,
                    "direction_code": pool.get("direction_code"),
                    "department_code": pool.get("department_code"),
                    "funding_type": pool.get("funding_type"),
                    "funding_type_key": f"funding_type:{pool.get('funding_type')}",
                    "quota_type": pool.get("quota_type"),
                    "quota_type_key": f"quota_type:{pool.get('quota_type')}",
                    "places": pool.get("places"),
                    "scope_level": pool.get("scope_level"),
                    "places_by_source_row": pool.get("places_by_source_row"),
                    "source_locators": pool.get("source_locators"),
                },
                provenance,
            )
            pool_candidate_by_key[pool_key] = candidate_key

        def canonical_digest(value: Any) -> str:
            encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            return hashlib.sha256(encoded.encode("utf-8")).hexdigest()

        expected_direction_rows: dict[tuple[str, str], dict[str, dict[str, Any]]] = {}
        for pool in pools:
            if pool.get("funding_type") not in {"budget", "paid"} or pool.get("quota_type") not in {
                "special", "separate"
            }:
                continue
            identity = (str(pool.get("direction_code") or ""), str(pool.get("quota_type")))
            source_rows_by_digest = expected_direction_rows.setdefault(identity, {})
            for source_row in pool.get("places_by_source_row") or []:
                source_rows_by_digest[canonical_digest(source_row)] = source_row

        for legacy in current_competition_pools:
            direction_code = legacy.get("direction_code")
            quota_code = legacy.get("quota_type")
            legacy_key = str(legacy.get("external_key") or "")
            if (
                legacy.get("scope_level") != "direction"
                or legacy.get("funding_type") != "budget"
                or quota_code not in {"special", "separate"}
                or not legacy_key.startswith(f"competition_pool:bmstu:{year}:{direction_code}:budget:")
            ):
                continue
            identity = (str(direction_code or ""), str(quota_code))
            old_rows = legacy.get("places_by_source_row") or []
            new_rows = list(expected_direction_rows.get(identity, {}).values())
            if not old_rows or canonical_digest(sorted(old_rows, key=lambda item: json.dumps(item, sort_keys=True))) != canonical_digest(
                sorted(new_rows, key=lambda item: json.dumps(item, sort_keys=True))
            ):
                manual_findings.append({
                    "record_key": legacy_key,
                    "issue_type": "legacy_direction_quota_identity_not_reconciled",
                    "source_url": "[user-provided BMSTU Appendix 8.1 PDF]",
                    "details": "The old direction-scoped quota could not be proven to be an exact aggregation of this PDF; it was retained for individual review.",
                    "source_artifact_key": source_artifact_key,
                    "source_locator_json": json.dumps(
                        {"source_locators": legacy.get("source_locators") or []},
                        ensure_ascii=False,
                        sort_keys=True,
                    ),
                })
                continue

            related_rows = [
                row for row in current_relationships
                if row.get("target_key") == legacy_key
            ]
            if any(row.get("relation_type") != "offering_competes_in_pool" for row in related_rows):
                manual_findings.append({
                    "record_key": legacy_key,
                    "issue_type": "legacy_direction_quota_unexpected_relationship",
                    "source_url": "[user-provided BMSTU Appendix 8.1 PDF]",
                    "details": "The legacy quota has a non-offering relationship; it was retained for individual review.",
                    "source_artifact_key": source_artifact_key,
                    "source_locator_json": json.dumps(
                        {"source_locators": legacy.get("source_locators") or []},
                        ensure_ascii=False,
                        sort_keys=True,
                    ),
                })
                continue
            stale_reviews = [
                row for row in current_manual_review_rows
                if row.get("record_key") == legacy_key
                and row.get("issue_type") == "authoritative_direction_quota_conflict"
            ]
            replacement_keys = sorted(
                str(pool.get("external_key")) for pool in pools
                if pool.get("direction_code") == direction_code
                and pool.get("quota_type") == quota_code
                and pool.get("funding_type") == "budget"
            )
            provenance = artifact_for(
                [{"content_sha256": source_hash, "captured_at": captured_at}],
                locator={
                    "scope": "legacy_direction_quota_rows",
                    "direction_code": direction_code,
                    "source_locators": legacy.get("source_locators") or [],
                },
            )
            retirement_payload = {
                "retire_existing_record": True,
                "retirement_reason": "legacy_direction_scope_replaced_by_exact_offering_scope",
                "retired_record_sha256": canonical_digest(legacy),
                "retired_record_snapshot": {
                    "external_key": legacy_key,
                    "direction_code": direction_code,
                    "quota_type": quota_code,
                    "places": legacy.get("places"),
                    "places_by_source_row": old_rows,
                    "source_locators": legacy.get("source_locators") or [],
                },
                "retired_relationships": [
                    {
                        "external_key": row.get("external_key"),
                        "row_sha256": canonical_digest(row),
                        "relation_type": row.get("relation_type"),
                        "source_key": row.get("source_key"),
                        "target_key": row.get("target_key"),
                    }
                    for row in related_rows
                ],
                "resolved_manual_review_rows": stale_reviews,
                "replaced_by_external_keys": replacement_keys,
            }
            add(
                "competition_pools.jsonl",
                f"retire:{legacy_key}:{source_hash}",
                legacy_key,
                retirement_payload,
                provenance,
            )

        existing_pairs = {
            (row.get("relation_type"), row.get("source_key"), row.get("target_key"))
            for row in current_relationships
        }
        for relation in relationships:
            pair = (relation.get("relation_type"), relation.get("source_key"), relation.get("target_key"))
            if pair in existing_pairs:
                continue
            target_candidate = pool_candidate_by_key.get(str(relation.get("target_key")))
            if target_candidate is None:
                # A pre-existing exact pool can be related without re-creating
                # its fact. New relationships are still source-backed candidates.
                if str(relation.get("target_key")) not in existing_pools:
                    continue
                target_key: Any = relation.get("target_key")
            else:
                target_key = _candidate_ref(target_candidate)
            locator = relation.get("source_locator")
            add(
                "relationships.jsonl",
                str(relation["external_key"]),
                str(relation["external_key"]),
                {
                    "relation_type": relation["relation_type"],
                    "source_key": relation["source_key"],
                    "target_key": target_key,
                    "evidence_kind": relation.get("evidence_kind"),
                    "source_url": None,
                    "source_locator": locator,
                },
                artifact_for(
                    [{"content_sha256": source_hash, "captured_at": captured_at}],
                    locator=locator,
                ),
            )

        offer_by_key = {str(row.get("external_key")): row for row in offers}
        for finding in findings:
            record_key = str(finding.get("record_key") or "")
            source_offer = offer_by_key.get(record_key)
            locator = source_offer.get("source_locator") if source_offer else None
            manual_findings.append({
                "record_key": record_key,
                "issue_type": str(finding.get("issue_type") or "authoritative_admission_plan_review"),
                "source_url": "[user-provided BMSTU Appendix 8.1 PDF]",
                "details": str(finding.get("details") or "") + f" PDF SHA-256: {source_hash}.",
                "source_artifact_key": source_artifact_key,
                "source_locator_json": json.dumps(locator, ensure_ascii=False, sort_keys=True) if locator else "",
            })

    university = normalized.get("university")
    university_candidate: str | None = None
    if isinstance(university, dict):
        university_key = university.get("id")
        if isinstance(university_key, str):
            university_candidate = add(
                "universities.jsonl",
                university_key,
                university_key,
                {
                    "code": university_key.removeprefix("university:"),
                    "name": university.get("name"),
                    "city": university.get("city"),
                    "official_site": university.get("official_site"),
                },
                artifact_for(source_url=university.get("official_site")),
            )

    direction_candidates: dict[str, str] = {}
    directions = normalized.get("directions") or [normalized.get("direction")]
    for direction in directions:
        if not isinstance(direction, dict) or not isinstance(direction.get("id"), str):
            continue
        direction_key = direction["id"]
        direction_candidates[direction_key] = add(
            "directions.jsonl",
            direction_key,
            direction_key,
            {
                "code": direction.get("code"),
                "name": direction.get("name"),
                "university_key": _candidate_ref(university_candidate) if university_candidate else university.get("id"),
            },
            artifact_for(),
        )

    programs = [row for row in normalized.get("programs", []) if isinstance(row, dict)]
    department_candidates: dict[str, str] = {}
    for program in programs:
        code, name = program.get("department_code"), program.get("department_name")
        if not isinstance(code, str) or not code or not isinstance(name, str) or not name:
            continue
        department_key = f"department:bmstu:{code}"
        if department_key in department_candidates:
            continue
        department_candidates[department_key] = add(
            "departments.jsonl",
            department_key,
            department_key,
            {
                "code": code,
                "name": name,
                "university_key": _candidate_ref(university_candidate) if university_candidate else "university:bmstu",
            },
            artifact_for(program.get("provenance", []), source_url=program.get("source_url")),
        )

    program_candidates: dict[str, str] = {}
    programs_by_id = {
        row["id"]: row for row in programs if isinstance(row.get("id"), str)
    }
    for program in programs:
        source_key = program.get("id")
        direction_key = program.get("direction_id")
        if not isinstance(source_key, str) or not isinstance(direction_key, str):
            continue
        department_key = (
            f"department:bmstu:{program['department_code']}"
            if isinstance(program.get("department_code"), str)
            else None
        )
        row: dict[str, Any] = {
            "code": program.get("code"),
            "name": program.get("name"),
            "direction_key": _candidate_ref(direction_candidates[direction_key])
            if direction_key in direction_candidates else direction_key,
            "study_plan_url": program.get("study_plan_url"),
            "source_url": program.get("source_url"),
        }
        if department_key:
            row["department_code"] = program["department_code"]
            row["department_key"] = _candidate_ref(department_candidates[department_key])
        program_candidates[source_key] = add(
            "educational_programs.jsonl",
            source_key,
            source_key,
            row,
            artifact_for(program.get("provenance", []), source_url=program.get("source_url")),
        )
        if department_key and department_key in department_candidates:
            relationship_key = f"relationship:bmstu:program-department:{source_key}:{department_key}"
            add(
                "relationships.jsonl",
                relationship_key,
                relationship_key,
                {
                    "relation_type": "profile_is_issued_by_department",
                    "source_key": _candidate_ref(program_candidates[source_key]),
                    "target_key": _candidate_ref(department_candidates[department_key]),
                    "evidence_kind": "explicit_bmstu_program_card_relation",
                },
                artifact_for(program.get("provenance", []), source_url=program.get("source_url")),
            )

    curriculum_candidates: dict[str, str] = {}
    complete_curriculum_scopes: list[dict[str, str]] = []
    for curriculum in normalized.get("curricula", []):
        if not isinstance(curriculum, dict) or not isinstance(curriculum.get("id"), str):
            continue
        source_key = curriculum["id"]
        program_key = curriculum.get("program_id")
        program = programs_by_id.get(program_key) if isinstance(program_key, str) else None
        row: dict[str, Any] = {
            "status": "parsed_via_user_confirmed_catalog_link",
            "program_key": _candidate_ref(program_candidates[program_key])
            if isinstance(program_key, str) and program_key in program_candidates else program_key,
            "education_year": curriculum.get("education_year"),
            "profile_code": program.get("code") if program else None,
            "study_plan_url": curriculum.get("source_url"),
        }
        curriculum_candidates[source_key] = add(
            "study_plans.jsonl",
            source_key,
            f"study_plan:{source_key.removeprefix('curriculum:')}",
            row,
            artifact_for(curriculum.get("provenance", []), source_url=curriculum.get("source_url")),
        )
        if isinstance(program_key, str) and program_key in program_candidates:
            plan_relation_key = f"relationship:bmstu:program-plan:{program_key}:{source_key}"
            add(
                "relationships.jsonl",
                plan_relation_key,
                plan_relation_key,
                {
                    "relation_type": "profile_has_profile_specific_curriculum",
                    "source_key": _candidate_ref(program_candidates[program_key]),
                    "target_key": _candidate_ref(curriculum_candidates[source_key]),
                    "evidence_kind": "human_reviewed_exact_program_plan_link",
                },
                artifact_for(curriculum.get("provenance", []), source_url=curriculum.get("source_url")),
            )
        profile_code = program.get("code") if program else None
        education_year = curriculum.get("education_year")
        exact_plan_matches = [
            row for row in current_study_plans
            if row.get("profile_code") == profile_code
            and row.get("education_year") == education_year
            and isinstance(row.get("external_key"), str)
        ]
        generated_plan_key = f"study_plan:{source_key.removeprefix('curriculum:')}"
        identity_plan_key = (
            exact_plan_matches[0]["external_key"]
            if len(exact_plan_matches) == 1
            else generated_plan_key
        )
        base_items = [
            row for row in current_curriculum_rows
            if row.get("curriculum_key") == identity_plan_key
        ]
        incoming_identity_rows: list[dict[str, Any]] = []
        items = [item for item in curriculum.get("items", []) if isinstance(item, dict)]
        for item in items:
            provenance_rows = item.get("provenance", [])
            provenance = provenance_rows[0] if isinstance(provenance_rows, list) and provenance_rows else {}
            locator = {
                "page": item.get("source_page"),
                "printed_row_no": item.get("printed_row_no"),
                "parsed_position": item.get("parsed_position") or item.get("source_position"),
                "semester": item.get("semester"),
            }
            incoming_identity_rows.append({
                "discipline": item.get("source_name"),
                "semester": item.get("semester"),
                "chair": item.get("chair_code"),
                "course_block": item.get("course_block"),
                "source_part": item.get("source_part"),
                "source_page": item.get("source_page"),
                "printed_row_no": item.get("printed_row_no"),
                "parsed_position": locator["parsed_position"],
                "source_position": item.get("source_position"),
                "source_sha256": provenance.get("content_sha256"),
                "source_locator": locator,
                "identity_status": (
                    "ambiguous" if len(exact_plan_matches) > 1 else item.get("identity_status")
                ),
            })
        reconciled = reconcile_curriculum_rows(identity_plan_key, incoming_identity_rows, base_items)
        for item, identity_row, resolution in zip(items, incoming_identity_rows, reconciled.rows, strict=True):
            assessment_types = item.get("assessment_types")
            observation_key = observation_identity_key(
                identity_plan_key, identity_row, source_sha256=identity_row.get("source_sha256")
            )
            if resolution.status == "ambiguous":
                target_key = observation_key
                stable_identity = {
                    "algorithm": "bmstu-curriculum-identity-v1",
                    "status": "ambiguous",
                    "signals": resolution.metadata.get("signals"),
                    "suggested_existing_keys": list(resolution.suggested_existing_keys),
                    "reason": resolution.reason,
                }
            else:
                target_key = resolution.canonical_external_key
                stable_identity = {
                    key: resolution.metadata.get(key)
                    for key in ("algorithm", "source_identity_key", "signals", "duplicate_title_semester")
                    if resolution.metadata.get(key) is not None
                }
                stable_identity["source_identity_id"] = stable_identity.pop("source_identity_key")
            if not isinstance(target_key, str):
                raise IngestionError("curriculum identity resolver produced no exact or observation key")
            row_item: dict[str, Any] = {
                "curriculum_key": _candidate_ref(curriculum_candidates[source_key]),
                "record_type": "discipline",
                "is_data_row": True,
                "discipline": item.get("source_name"),
                "semester": item.get("semester"),
                "hours": item.get("hours"),
                "credits": item.get("credits"),
                "assessment_type": " / ".join(assessment_types) if isinstance(assessment_types, list) else assessment_types,
                "chair": item.get("chair_code"),
                "course_block": item.get("course_block"),
                "source_part": item.get("source_part"),
                "source_row": {"identity": stable_identity},
                "source_document_url": curriculum.get("source_url"),
                "study_plan_url": curriculum.get("source_url"),
                "observed_at": curriculum.get("captured_at"),
            }
            item_provenance = artifact_for(
                item.get("provenance", []),
                source_url=curriculum.get("source_url"),
                locator=identity_row.get("source_locator"),
            )
            add(
                "curriculum_items.jsonl",
                observation_key,
                target_key,
                row_item,
                item_provenance,
            )
            candidates[-1]["identity_status"] = resolution.status
            candidates[-1]["identity_reason"] = resolution.reason
            candidates[-1]["suggested_existing_keys"] = list(resolution.suggested_existing_keys)

        curriculum_source_url = curriculum.get("source_url")
        safe_curriculum_source_url = (
            _safe_source_url(curriculum_source_url) if isinstance(curriculum_source_url, str) else None
        )
        source_document_captured = any(
            source.get("source_kind") == "bmstu_curriculum_document"
            and safe_curriculum_source_url in {source.get("requested_url"), source.get("final_url")}
            for source in sources
        )
        normalized_source_gaps = normalized.get("source_gaps", [])
        source_scope_has_gap = not isinstance(normalized_source_gaps, list) or any(
            isinstance(gap, dict)
            and isinstance(gap.get("source_url"), str)
            and _safe_source_url(gap["source_url"]) == safe_curriculum_source_url
            for gap in normalized_source_gaps
        )
        if items and source_document_captured and not source_scope_has_gap:
            complete_curriculum_scopes.append({
                "dataset": "curriculum_items.jsonl",
                "field": "curriculum_key",
                "value": identity_plan_key,
            })

    for statistic in normalized.get("historical_results", []):
        if not isinstance(statistic, dict) or not isinstance(statistic.get("external_key"), str):
            continue
        direction_key = statistic.get("direction_key")
        department_key = statistic.get("department_key")
        row = {
            key: statistic.get(key)
            for key in (
                "direction_code", "direction_key", "department_code", "department_key",
                "scope_type", "scope_label", "admission_year", "study_form", "funding_type",
                "outcome_type", "admitted_count", "minimum_score", "maximum_score",
                "average_score", "snapshot_date", "finality_note", "source_locator",
            )
            if statistic.get(key) is not None
        }
        if isinstance(direction_key, str) and direction_key in direction_candidates:
            row["direction_key"] = _candidate_ref(direction_candidates[direction_key])
        elif isinstance(direction_key, str):
            row["direction_key"] = direction_key
        if isinstance(row.get("funding_type"), str):
            row["funding_type_key"] = f"funding_type:{row['funding_type']}"
        if isinstance(department_key, str) and department_key in department_candidates:
            row["department_key"] = _candidate_ref(department_candidates[department_key])
        add(
            "historical_admission_statistics.jsonl",
            statistic["external_key"],
            statistic["external_key"],
            row,
            artifact_for(source_url=statistic.get("source_url"), locator=statistic.get("source_locator")),
        )

    campaign_years = {
        int(key.rsplit(":", 1)[-1])
        for key in existing_campaign_keys
        if key.startswith("campaign:bmstu:") and key.rsplit(":", 1)[-1].isdigit()
    }
    for envelope in normalized.get("admissions", []):
        if not isinstance(envelope, dict):
            continue
        program_key = envelope.get("program_id")
        program = programs_by_id.get(program_key) if isinstance(program_key, str) else None
        if not program:
            continue
        direction_key = program.get("direction_id")
        for offering in envelope.get("offerings", []):
            if not isinstance(offering, dict):
                continue
            year = offering.get("admission_year")
            direction_code = program.get("code", "").split("-")[0]
            campaign_key = f"campaign:bmstu:{year}"
            scope = offering.get("scope")
            provenance = artifact_for(
                offering.get("provenance", []), source_url=program.get("source_url")
            )
            if scope == "direction" and isinstance(year, int):
                for passing_score in offering.get("passing_scores", []):
                    if not isinstance(passing_score, dict) or passing_score.get("score") is None:
                        continue
                    funding = offering.get("funding_type")
                    if funding not in {"budget", "paid"}:
                        continue
                    score_key = (
                        f"admission_statistic:bmstu:{year}:{direction_code}:{funding}:"
                        f"{passing_score.get('competition_type', 'general')}:{passing_score.get('score_type', 'other')}"
                    )
                    add(
                        "admission_statistics.jsonl",
                        f"{offering.get('id')}:{passing_score.get('score_type')}:{passing_score.get('competition_type')}",
                        score_key,
                        {
                            "direction_code": direction_code,
                            "direction_key": _candidate_ref(direction_candidates[direction_key])
                            if direction_key in direction_candidates else direction_key,
                            "admission_year": year,
                            "admission_stage": "historical",
                            "competition_type": passing_score.get("competition_type"),
                            "funding_type": funding,
                            "funding_type_key": f"funding_type:{funding}",
                            "score": passing_score.get("score"),
                            "status": passing_score.get("status"),
                            "study_form": offering.get("study_form"),
                            "source_locator": passing_score.get("provenance", {}).get("locator"),
                        },
                        artifact_for([passing_score.get("provenance", {})], source_url=program.get("source_url")),
                    )

            # These typed categories need an exact campaign in the imported base.
            # Older parser summaries without that campaign remain observations.
            if not isinstance(year, int) or year not in campaign_years:
                continue
            offering_key = offering.get("id")
            if not isinstance(offering_key, str):
                continue
            add(
                "program_offerings.jsonl",
                offering_key,
                offering_key,
                {
                    "campaign_key": campaign_key,
                    "campaign_year": year,
                    "direction_code": direction_code,
                    "direction_key": _candidate_ref(direction_candidates[direction_key])
                    if direction_key in direction_candidates else direction_key,
                    "educational_program_key": _candidate_ref(program_candidates[program_key])
                    if program_key in program_candidates else program_key,
                    "program_name_in_document": program.get("name"),
                    "study_form": offering.get("study_form"),
                    "catalog_join_status": "reviewed_exact_source_key",
                },
                provenance,
            )

            if scope == "direction":
                pool_facts: list[tuple[str, str, int]] = []
                places = offering.get("places")
                if isinstance(places, int):
                    pool_facts.append(("general_competition", "General competition places", places))
                for quota in offering.get("quotas", []):
                    if isinstance(quota, dict) and isinstance(quota.get("places"), int):
                        pool_facts.append((str(quota.get("quota_type")), str(quota.get("source_name")), quota["places"]))
                for quota_code, source_name, count in pool_facts:
                    quota_key = f"quota_type:{quota_code}"
                    funding = offering.get("funding_type")
                    funding_key = f"funding_type:{funding}"
                    if quota_key not in existing_quota_keys or funding_key not in existing_funding_keys:
                        continue
                    pool_identity = hashlib.sha256((offering_key + "\0" + quota_code).encode()).hexdigest()[:16]
                    pool_key = f"competition_pool:bmstu:{year}:parser:{pool_identity}"
                    add(
                        "competition_pools.jsonl",
                        f"{offering_key}:{quota_code}",
                        pool_key,
                        {
                            "linked_campaign_key": campaign_key,
                            "campaign_year": year,
                            "direction_code": direction_code,
                            "direction_key": _candidate_ref(direction_candidates[direction_key])
                            if direction_key in direction_candidates else direction_key,
                            "funding_type": funding,
                            "funding_type_key": funding_key,
                            "quota_type": quota_code,
                            "quota_type_key": quota_key,
                            "places": count,
                            "scope_level": "direction",
                            "source_locators": [{"description": source_name}],
                        },
                        provenance,
                    )

            exams = offering.get("exams", [])
            if scope == "direction" and exams:
                exam_candidate_keys: dict[str, str] = {}
                exam_code_keys: dict[str, str] = {}
                for exam in exams:
                    if not isinstance(exam, dict):
                        continue
                    subject = exam.get("subject")
                    source_name = exam.get("source_name")
                    if not isinstance(subject, str) or not isinstance(source_name, str):
                        continue
                    code = "src_" + hashlib.sha256(subject.encode("utf-8")).hexdigest()[:16]
                    exam_key = f"exam:bmstu:source:{code[4:]}"
                    exam_candidate = add(
                        "exams.jsonl",
                        f"exam:{offering_key}:{subject}",
                        exam_key,
                        {"code": code, "name": source_name},
                        artifact_for([exam.get("provenance", {})], source_url=program.get("source_url")),
                    )
                    exam_candidate_keys[subject] = exam_candidate
                    exam_code_keys[subject] = exam_key

                def leaf(exam: dict[str, Any]) -> dict[str, Any]:
                    return {
                        "exam": {"exam_key": _candidate_ref(exam_candidate_keys[exam["subject"]])},
                        "subject_code": exam.get("subject"),
                        "minimum_score": exam.get("minimum_score"),
                        "is_choice": exam.get("is_choice", False),
                        "tiebreak_rank": None,
                    }

                required = [item for item in exams if isinstance(item, dict) and item.get("is_required", True) and not item.get("choice_group_id")]
                groups: dict[str, list[dict[str, Any]]] = {}
                representable = all(
                    isinstance(item, dict)
                    and (item.get("is_required", True) or item.get("choice_group_id"))
                    and (not item.get("choice_group_id") or item.get("choice_group_min") in {None, 1})
                    and (not item.get("choice_group_id") or item.get("choice_group_max") in {None, len(exams)})
                    for item in exams
                )
                for item in exams:
                    if isinstance(item, dict) and item.get("choice_group_id"):
                        groups.setdefault(str(item["choice_group_id"]), []).append(item)
                children = [leaf(item) for item in required]
                for group in groups.values():
                    children.append({"operator": "OR", "children": [leaf(item) for item in group]})
                if representable and children:
                    requirement_key = f"requirement-set:bmstu:{year}:{direction_code}:{hashlib.sha256(offering_key.encode()).hexdigest()[:16]}"
                    add(
                        "admission_exam_requirements.jsonl",
                        f"requirements:{offering_key}",
                        requirement_key,
                        {
                            "campaign_key": campaign_key,
                            "direction_code": direction_code,
                            "direction_key": _candidate_ref(direction_candidates[direction_key])
                            if direction_key in direction_candidates else direction_key,
                            "requirement_set_key": requirement_key,
                            "requirement_tree": {"operator": "AND", "children": children},
                        },
                        provenance,
                    )

            if scope == "direction":
                for index, tuition in enumerate(offering.get("tuition", [])):
                    if not isinstance(tuition, dict) or tuition.get("academic_year") is None:
                        continue
                    tuition_key = f"tuition:bmstu:{direction_code}:{tuition['academic_year']}:{hashlib.sha256(f'{offering_key}:{index}'.encode()).hexdigest()[:12]}"
                    add(
                        "tuition.jsonl",
                        f"{offering_key}:tuition:{index}",
                        tuition_key,
                        {
                            "direction_code": direction_code,
                            "direction_key": _candidate_ref(direction_candidates[direction_key])
                            if direction_key in direction_candidates else direction_key,
                            "direction_name": next((item.get("name") for item in directions if item.get("id") == direction_key), None),
                            "annual_amount_rub": tuition.get("amount") if tuition.get("currency") == "RUB" else None,
                            "currency": tuition.get("currency"),
                            "study_year_label": tuition.get("academic_year"),
                            "study_level_or_table_category": "undergraduate",
                            "campus_scope": "not_separately_stated_in_source",
                            "raw_cells": [tuition.get("amount"), tuition.get("currency"), tuition.get("period")],
                        },
                        artifact_for([tuition.get("provenance", {})], source_url=program.get("source_url")),
                    )

    return candidates, complete_curriculum_scopes, manual_findings


def _validate_bundle() -> Any:
    try:
        from andromeda_api.application.importer.bundle import validate_bundle
    except ImportError as error:
        raise IngestionError(
            "bundle operations require the API application package; run `uv sync --all-packages`"
        ) from error
    return validate_bundle


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise IngestionError(f"invalid JSON input: {path.name}") from error
    if not isinstance(value, dict):
        raise IngestionError(f"JSON root must be an object: {path.name}")
    return value


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
        records = [json.loads(line) for line in lines if line.strip()]
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise IngestionError(f"invalid JSONL input: {path.name}") from error
    if not all(isinstance(row, dict) for row in records):
        raise IngestionError(f"JSONL records must be objects: {path.name}")
    return records


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )


def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.write_text(
        "".join(
            json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
            for row in rows
        ),
        encoding="utf-8",
    )


def _safe_source_url(value: Any) -> str:
    if not isinstance(value, str):
        raise IngestionError("candidate source URL is missing")
    parsed = urlsplit(value)
    host = (parsed.hostname or "").casefold().rstrip(".")
    allowed = (
        host == "bmstu.ru"
        or host.endswith(".bmstu.ru")
        or host in {"disk.yandex.ru", "clck.ru", "clck.su", "cloud-api.yandex.net"}
        or host.endswith(".yandex.ru")
        or host.endswith(".yandex.net")
    )
    if (
        parsed.scheme != "https"
        or not allowed
        or parsed.username
        or parsed.password
        or parsed.fragment
    ):
        raise IngestionError("candidate source URL is outside the approved HTTPS source hosts")
    secret_keys = {"token", "access_token", "auth", "authorization", "password", "signature", "sig", "secret", "key", "public_key"}
    if any(part.split("=", 1)[0].casefold() in secret_keys for part in parsed.query.split("&") if part):
        raise IngestionError("candidate source URL contains a credential-like query parameter")
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))


def _prepare_output(output_dir: Path) -> Path:
    target = output_dir.expanduser()
    if target.is_symlink():
        raise IngestionError("bundle output must not be a symbolic link")
    if target.exists():
        if not target.is_dir() or any(target.iterdir()):
            raise IngestionError("bundle output must be a new or empty directory")
    else:
        target.mkdir(parents=True, exist_ok=True)
    return target.resolve(strict=True)


def _base_validation(base_bundle: Path) -> tuple[Any, dict[str, Any]]:
    validate_bundle = _validate_bundle()
    report = validate_bundle(base_bundle)
    if not report.get("valid"):
        raise IngestionError("base BMSTU bundle is invalid; candidate staging stopped")
    return validate_bundle, report


def _copy_import_bundle(base: Path, target: Path) -> None:
    """Copy a validated directory or ZIP using BundleReader's safe path index."""

    try:
        from andromeda_api.application.importer.bundle import BundleReader
    except ImportError as error:
        raise IngestionError("bundle copying requires the API application package") from error
    with BundleReader(base) as reader:
        for relative_path in reader._file_names():
            path = PurePosixPath(relative_path)
            destination = target.joinpath(*path.parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(reader.read_bytes(relative_path))


def build_candidate_bundle(
    *,
    base_bundle: Path,
    parse_report_path: Path,
    output_dir: Path,
    base_release_id: str | None = None,
    base_source_bundle_sha256: str | None = None,
) -> dict[str, Any]:
    """Copy the safe base and stage source-backed typed facts behind manual review."""

    base = base_bundle.expanduser().resolve(strict=True)
    report_path = parse_report_path.expanduser().resolve(strict=True)
    validate_bundle, base_report = _base_validation(base)
    report = _read_json(report_path)
    if report.get("schema_version") != 1:
        raise IngestionError("unsupported parser report schema version")
    capture_digest = report.get("source_capture_digest")
    if not isinstance(capture_digest, str) or not re.fullmatch(r"[0-9a-f]{64}", capture_digest):
        raise IngestionError("parser report has no valid capture digest")
    normalized = report.get("normalized")
    sources = report.get("sources")
    if not isinstance(normalized, dict) or not isinstance(sources, list) or not sources:
        raise IngestionError("parser report must include normalized data and source artifacts")
    _assert_safe_payload(normalized)
    normalized_json = json.dumps(normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    if re.search(r"(?i)olymp|олимп", normalized_json):
        raise IngestionError("olympiad content is not publishable in the BMSTU bundle")
    safe_sources: list[dict[str, Any]] = []
    artifacts: list[dict[str, Any]] = []
    base_artifacts = _read_jsonl(base / SOURCE_ARTIFACTS)
    artifacts_by_sha: dict[str, list[dict[str, Any]]] = {}
    for artifact in base_artifacts:
        if isinstance(artifact.get("sha256"), str):
            artifacts_by_sha.setdefault(artifact["sha256"], []).append(artifact)
    for source in sources:
        if not isinstance(source, dict):
            raise IngestionError("parser report source entries must be objects")
        source_kind = source.get("source_kind")
        source_hash = source.get("sha256")
        size = source.get("byte_size")
        status = source.get("status_code")
        captured_at = source.get("captured_at")
        if not isinstance(source_kind, str) or not source_kind.startswith("bmstu_"):
            raise IngestionError("only BMSTU source artifacts can be staged")
        if not isinstance(source_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", source_hash):
            raise IngestionError("source artifact has an invalid SHA-256")
        if isinstance(size, bool) or not isinstance(size, int) or size < 0:
            raise IngestionError("source artifact byte size must be a non-negative integer")
        if isinstance(status, bool) or not isinstance(status, int) or not 200 <= status < 400:
            raise IngestionError("only successful source artifacts can be staged")
        try:
            captured = datetime.fromisoformat(str(captured_at).replace("Z", "+00:00"))
        except ValueError as error:
            raise IngestionError("source artifact timestamp is invalid") from error
        if captured.tzinfo is None:
            raise IngestionError("source artifact timestamp must include a timezone")
        is_local_attachment = (
            source_kind == "bmstu_user_provided_authoritative_admission_plan"
            and source.get("local_attachment") is True
        )
        if is_local_attachment:
            if source.get("requested_url") is not None or source.get("final_url") is not None:
                raise IngestionError("local admission-plan attachment must not claim a fetched URL")
            matching_artifacts = artifacts_by_sha.get(source_hash, [])
            if len(matching_artifacts) > 1:
                raise IngestionError("local attachment SHA-256 maps to multiple existing source artifacts")
            if matching_artifacts:
                existing_artifact = matching_artifacts[0]
                if (
                    existing_artifact.get("content_type") != "application/pdf"
                    or existing_artifact.get("byte_size") != size
                    or existing_artifact.get("source_type") not in {
                        "user_provided_authoritative_admission_plan",
                        source_kind,
                    }
                ):
                    raise IngestionError("existing source artifact does not verify the local PDF metadata")
                artifact_key = str(existing_artifact["source_key"])
                captured = datetime.fromisoformat(
                    str(existing_artifact.get("retrieved_at")).replace("Z", "+00:00")
                )
                if captured.tzinfo is None:
                    raise IngestionError("existing source artifact timestamp has no timezone")
            else:
                artifact_key = f"source_artifact:sha256:{source_hash}"
                artifacts.append({
                    "source_key": artifact_key,
                    "source_type": "user_provided_authoritative_admission_plan",
                    "requested_url": None,
                    "final_url": None,
                    "retrieved_at": captured.isoformat(),
                    "sha256": source_hash,
                    "content_type": "application/pdf",
                    "byte_size": size,
                    "status_code": status,
                    "raw_path": None,
                    "storage_status": "omitted_by_user_request",
                    "note": "User-provided aggregate source; raw PDF bytes remain in the local attachment workspace.",
                })
            requested = None
            final = None
        else:
            if source.get("local_attachment") is True:
                raise IngestionError("local attachments are supported only for the designated BMSTU admission plan")
            requested = _safe_source_url(source.get("requested_url"))
            final = _safe_source_url(source.get("final_url"))
            source_identity = hashlib.sha256(
                f"{source_kind}\0{requested}\0{source_hash}".encode("utf-8")
            ).hexdigest()
            artifact_key = f"source_artifact:bmstu_capture:{source_identity}"
            artifacts.append(
                {
                    "source_key": artifact_key,
                    "source_type": source_kind,
                    "requested_url": requested,
                    "final_url": final,
                    "retrieved_at": captured.isoformat(),
                    "sha256": source_hash,
                    "content_type": source.get("content_type"),
                    "byte_size": size,
                    "status_code": status,
                    "raw_path": None,
                    "storage_status": "omitted_by_user_request",
                    "note": "Raw source body remains in the local ignored capture workspace.",
                }
            )
        safe_source = {
            "source_kind": source_kind,
            "requested_url": requested,
            "final_url": final,
            "captured_at": captured.isoformat(),
            "status_code": status,
            "content_type": source.get("content_type"),
            "sha256": source_hash,
            "byte_size": size,
            "source_artifact_key": artifact_key,
        }
        safe_sources.append(safe_source)
    candidate_key = f"bmstu_ingestion_candidate:{capture_digest}"
    snapshot_candidate = {
        "external_key": candidate_key,
        "candidate_type": "canonical_snapshot",
        "source_capture_digest": capture_digest,
        "source_artifact_key": safe_sources[0]["source_artifact_key"],
        "source_artifact_keys": [source["source_artifact_key"] for source in safe_sources],
        "source_count": len(safe_sources),
        "review_state": "pending",
        "payload_json": normalized_json,
        "payload_sha256": hashlib.sha256(normalized_json.encode("utf-8")).hexdigest(),
    }
    _assert_safe_payload(snapshot_candidate)

    existing_campaign_keys = {row.get("external_key", "") for row in _read_jsonl(base / "data" / "admission_campaigns.jsonl")}
    existing_funding_keys = {row.get("external_key", "") for row in _read_jsonl(base / "data" / "funding_types.jsonl")}
    existing_quota_keys = {row.get("external_key", "") for row in _read_jsonl(base / "data" / "quota_types.jsonl")}
    base_curriculum_rows = _read_jsonl(base / "data" / "curriculum_items.jsonl")
    base_study_plans = _read_jsonl(base / "data" / "study_plans.jsonl")
    base_directions = _read_jsonl(base / "data" / "directions.jsonl")
    base_departments = _read_jsonl(base / "data" / "departments.jsonl")
    base_programs = _read_jsonl(base / "data" / "educational_programs.jsonl")
    base_offerings = _read_jsonl(base / "data" / "program_offerings.jsonl")
    base_pools = _read_jsonl(base / "data" / "competition_pools.jsonl")
    base_relationships = _read_jsonl(base / "data" / "relationships.jsonl")
    with (base / "manual_review.csv").open("r", encoding="utf-8-sig", newline="") as stream:
        base_manual_review_rows = list(csv.DictReader(stream))
    typed_candidates, complete_curriculum_scopes, manual_findings = _build_typed_candidates(
        normalized=normalized,
        sources=safe_sources,
        capture_digest=capture_digest,
        existing_campaign_keys=existing_campaign_keys,
        existing_funding_keys=existing_funding_keys,
        existing_quota_keys=existing_quota_keys,
        current_curriculum_rows=base_curriculum_rows,
        current_study_plans=base_study_plans,
        current_directions=base_directions,
        current_departments=base_departments,
        current_programs=base_programs,
        current_offerings=base_offerings,
        current_competition_pools=base_pools,
        current_relationships=base_relationships,
        current_manual_review_rows=base_manual_review_rows,
    )


    existing_snapshot = next(
        (
            row
            for row in _read_jsonl(base / OBSERVATION_DATASET)
            if row.get("external_key") == candidate_key
        ),
        None,
    )
    if existing_snapshot is not None:
        existing_artifact_keys = set(existing_snapshot.get("source_artifact_keys", []))
        if existing_snapshot.get("source_artifact_key"):
            existing_artifact_keys.add(existing_snapshot["source_artifact_key"])
        exact_repeat = (
            existing_snapshot.get("source_capture_digest") == capture_digest
            and existing_snapshot.get("payload_sha256") == snapshot_candidate["payload_sha256"]
            and existing_artifact_keys == set(snapshot_candidate["source_artifact_keys"])
        )
        if not exact_repeat:
            raise IngestionError(
                "a canonical observation already uses this capture key with different content or provenance"
            )
        snapshot_candidate = None

    candidates = ([snapshot_candidate] if snapshot_candidate is not None else []) + typed_candidates

    target = _prepare_output(output_dir)
    if base_release_id is None and base_source_bundle_sha256 is not None:
        raise IngestionError("base release digest cannot be set without a release ID")
    if base_release_id is not None:
        try:
            UUID(base_release_id)
        except ValueError as error:
            raise IngestionError("base release ID must be a UUID") from error
        if base_source_bundle_sha256 != base_report["input"]["digest"]:
            raise IngestionError("active release digest does not match the exported base bundle")
    _copy_import_bundle(base, target)
    _write_json(
        target / "release_context.json",
        {
            "schema_version": 1,
            "base_release_id": base_release_id,
            "base_source_bundle_sha256": base_source_bundle_sha256,
        },
    )
    artifacts_path = target / SOURCE_ARTIFACTS
    existing_artifacts = _read_jsonl(artifacts_path)
    existing_keys = {row.get("source_key") for row in existing_artifacts}
    additions = [row for row in artifacts if row["source_key"] not in existing_keys]
    _write_jsonl(artifacts_path, [*existing_artifacts, *additions])
    candidate_path = target / CANDIDATE_FILE
    if candidate_path.exists():
        raise IngestionError("base bundle already contains an ingestion candidate dataset")
    candidate_path.parent.mkdir(parents=True, exist_ok=True)
    _write_jsonl(candidate_path, candidates)

    review_path = target / "manual_review.csv"
    with review_path.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if reader.fieldnames is None or not set(REVIEW_HEADERS) <= set(reader.fieldnames):
            raise IngestionError("base manual-review CSV has invalid headers")
        fields = list(reader.fieldnames)
        review_rows = list(reader)
    manual_identities = {
        (row.get("record_key", ""), row.get("issue_type", ""))
        for row in review_rows
    }
    new_manual_findings = [
        row for row in manual_findings
        if (row.get("record_key", ""), row.get("issue_type", "")) not in manual_identities
    ]
    if new_manual_findings:
        for optional_field in ("source_artifact_key", "source_locator_json"):
            if optional_field not in fields:
                fields.append(optional_field)
        review_rows.extend(new_manual_findings)
    for candidate in candidates:
        artifact = next(
            (source for source in safe_sources if source["source_artifact_key"] == candidate.get("source_artifact_key")),
            safe_sources[0],
        )
        review_rows.append(
            {
                "record_key": candidate["external_key"],
                "issue_type": "bmstu_ingestion_candidate_pending_review",
                "source_url": artifact["requested_url"],
                "details": "Typed source fact requires an explicit exact-key decision before importer mapping."
                if candidate["candidate_type"] == "typed_record"
                else "Canonical parser output requires explicit review before importer mapping.",
            }
        )
    with review_path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(review_rows)

    review_template = target / "review_decisions.csv"
    with review_template.open("w", encoding="utf-8", newline="") as stream:
        fields = (*DECISION_HEADERS, "suggested_target_external_key", "target_dataset", "source_external_key")
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for candidate in candidates:
            writer.writerow(
                {
                    "external_key": candidate["external_key"],
                    "decision": "",
                    "reviewed_at": "",
                    "target_external_key": "",
                    "suggested_target_external_key": candidate.get("suggested_target", ""),
                    "target_dataset": candidate.get("target_dataset", "observation"),
                    "source_external_key": candidate.get("source_identity", candidate["external_key"]),
                }
            )

    candidate_manifest = {
        "schema_version": 1,
        "base_digest": base_report["input"]["digest"],
        "base_release_id": base_release_id,
        "base_source_bundle_sha256": base_source_bundle_sha256,
        "capture_digest": capture_digest,
        "source_gaps": report.get("source_gaps", []),
        "complete_datasets": [],
        "complete_scopes": complete_curriculum_scopes,
        "coverage": "partial",
        "candidate_keys": [row["external_key"] for row in candidates],
        "canonical_snapshot_pending": snapshot_candidate is not None,
        "typed_candidate_count": len(typed_candidates),
        "retirement_candidate_count": sum(
            json.loads(row["payload_json"]).get("retire_existing_record") is True
            for row in typed_candidates
        ),
        "added_source_artifact_keys": [row["source_key"] for row in additions],
        "manual_review_findings_added": len(new_manual_findings),
    }
    _write_json(target / CANDIDATE_MANIFEST, candidate_manifest)

    exported = _read_json(target / "validation_report.json")
    validation = exported.setdefault("validation", {})
    validation["normalized_records"] = int(validation.get("normalized_records", 0)) + len(candidates)
    validation["jsonl_datasets"] = int(validation.get("jsonl_datasets", 0)) + 1
    validation["source_artifacts"] = int(validation.get("source_artifacts", 0)) + len(additions)
    validation["source_keys_unique"] = True
    exported.setdefault("notes", []).append(
        f"{len(typed_candidates)} typed BMSTU candidate(s) and "
        f"{int(snapshot_candidate is not None)} canonical observation(s) are pending manual review."
    )
    _write_json(target / "validation_report.json", exported)
    with (target / "report.md").open("a", encoding="utf-8") as stream:
        stream.write(
            "\n\n## Pending BMSTU ingestion candidates\n\n"
            f"Capture digest: `{capture_digest}`; source artifacts: {len(safe_sources)}; "
            f"typed facts: {len(typed_candidates)}; canonical snapshots pending: "
            f"{int(snapshot_candidate is not None)}. Review `review_decisions.csv` and materialize only "
            "explicitly accepted exact-key facts. "
            "Raw bodies were not copied into this bundle.\n"
        )

    candidate_validation = validate_bundle(target)
    if not candidate_validation.get("valid"):
        raise IngestionError("staged candidate failed bundle validation")
    logger.debug(
        "candidate bundle staged base_digest=%s capture_digest=%s candidate=%s artifacts=%d",
        base_report["input"]["digest"],
        capture_digest,
        candidate_key,
        len(additions),
    )
    return {
        "output_dir": str(target),
        "base_digest": base_report["input"]["digest"],
        "capture_digest": capture_digest,
        "candidate_key": candidate_key,
        "candidate_count": len(candidates),
        "typed_candidate_count": len(typed_candidates),
        "canonical_snapshot_pending": snapshot_candidate is not None,
        "retirement_candidate_count": sum(
            json.loads(row["payload_json"]).get("retire_existing_record") is True
            for row in typed_candidates
        ),
        "source_artifact_count": len(additions),
        "manual_review_findings_added": len(new_manual_findings),
        "validation": candidate_validation,
    }


def _merge_jsonl_rows_preserving_bytes(path: Path, updates: dict[str, dict[str, Any]]) -> None:
    """Replace approved rows while copying every unrelated source line byte-for-byte."""

    if not path.exists():
        _write_jsonl(path, list(updates.values()))
        return
    raw_lines = path.read_bytes().splitlines(keepends=True)
    output: list[bytes] = []
    handled: set[str] = set()
    for raw_line in raw_lines:
        if not raw_line.strip():
            output.append(raw_line)
            continue
        try:
            original = json.loads(raw_line.decode("utf-8-sig"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise IngestionError(f"cannot preserve malformed existing JSONL: {path.name}") from error
        key = original.get("external_key") if isinstance(original, dict) else None
        replacement = updates.get(key) if isinstance(key, str) else None
        if replacement is None:
            output.append(raw_line)
            continue
        handled.add(key)
        if replacement == original:
            output.append(raw_line)
            continue
        line_ending = b"\r\n" if raw_line.endswith(b"\r\n") else b"\n" if raw_line.endswith(b"\n") else b""
        encoded = json.dumps(replacement, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        output.append(encoded + line_ending)

    for key, row in updates.items():
        if key in handled:
            continue
        if output and not output[-1].endswith((b"\n", b"\r")):
            output.append(b"\n")
        encoded = json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        output.append(encoded + b"\n")
    path.write_bytes(b"".join(output))


def _remove_jsonl_rows_exact(path: Path, expected_digests: dict[str, str]) -> None:
    """Remove only exact, reviewed JSONL rows and preserve all other bytes."""

    if not expected_digests:
        return
    if not path.is_file():
        raise IngestionError(f"reviewed retirement target is missing: {path.name}")
    output: list[bytes] = []
    found: set[str] = set()
    for raw_line in path.read_bytes().splitlines(keepends=True):
        if not raw_line.strip():
            output.append(raw_line)
            continue
        try:
            original = json.loads(raw_line.decode("utf-8-sig"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise IngestionError(f"cannot verify retirement rows in {path.name}") from error
        key = original.get("external_key") if isinstance(original, dict) else None
        if not isinstance(key, str) or key not in expected_digests:
            output.append(raw_line)
            continue
        if key in found:
            raise IngestionError(f"reviewed retirement key is duplicated in {path.name}")
        encoded = json.dumps(original, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        digest = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
        if digest != expected_digests[key]:
            raise IngestionError(f"reviewed retirement row changed since candidate preparation: {key}")
        found.add(key)
    if found != set(expected_digests):
        missing = sorted(set(expected_digests) - found)
        raise IngestionError(f"reviewed retirement target is absent from {path.name}: {missing[:3]}")
    path.write_bytes(b"".join(output))


def _remove_exact_manual_review_rows(path: Path, expected_rows: list[dict[str, str]]) -> None:
    """Resolve only the exact prior review rows named by an approved candidate."""

    if not expected_rows:
        return
    if not path.is_file():
        raise IngestionError("reviewed retirement references a missing manual-review CSV")
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        fields = list(reader.fieldnames or [])
        rows = list(reader)
    if not fields:
        raise IngestionError("manual-review CSV has no header")

    def digest(row: dict[str, Any]) -> str:
        encoded = json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(encoded.encode("utf-8")).hexdigest()

    remaining = {}
    for row in expected_rows:
        if row.get("issue_type") != "authoritative_direction_quota_conflict":
            raise IngestionError("retirement cannot resolve an unrelated manual-review issue")
        key = digest(row)
        remaining[key] = remaining.get(key, 0) + 1
    retained: list[dict[str, str]] = []
    for row in rows:
        key = digest(row)
        if remaining.get(key, 0):
            remaining[key] -= 1
        else:
            retained.append(row)
    if any(remaining.values()):
        raise IngestionError("manual-review row changed or disappeared since candidate preparation")
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(retained)


def _merge_reviewed_target_row(previous: dict[str, Any], typed_row: dict[str, Any]) -> dict[str, Any]:
    ignored = {
        "source_artifact_key", "source_artifact_keys", "source_sha256",
        "source_url", "source_retrieved_at",
    }
    for field, value in typed_row.items():
        if field in ignored or field == "external_key" or value is None:
            continue
        if previous.get(field) is not None and previous[field] != value:
            raise IngestionError("conflicting accepted sources target the same exact external key")
        previous[field] = value
    artifacts = list(previous.get("source_artifact_keys", []))
    if previous.get("source_artifact_key"):
        artifacts.append(previous["source_artifact_key"])
    if typed_row.get("source_artifact_key"):
        artifacts.append(typed_row["source_artifact_key"])
    if artifacts:
        previous["source_artifact_keys"] = sorted(set(artifacts))
    return previous


def materialize_reviewed_bundle(
    *,
    candidate_dir: Path,
    decisions_path: Path,
    output_dir: Path,
    actor: str | None = None,
) -> dict[str, Any]:
    """Apply exact-key decisions to typed datasets and preserve the audit observation."""

    candidate = candidate_dir.expanduser().resolve(strict=True)
    decisions_file = decisions_path.expanduser().resolve(strict=True)
    validate_bundle = _validate_bundle()
    candidate_validation = validate_bundle(candidate)
    if not candidate_validation.get("valid"):
        raise IngestionError("candidate bundle is invalid; review materialization stopped")
    candidate_manifest = _read_json(candidate / CANDIDATE_MANIFEST)
    if candidate_manifest.get("schema_version") != 1:
        raise IngestionError("unsupported ingestion candidate manifest version")
    candidate_path = candidate / CANDIDATE_FILE
    if not candidate_path.is_file():
        raise IngestionError("review input contains no pending candidate dataset")
    candidates = _read_jsonl(candidate_path)
    if not candidates:
        raise IngestionError("no candidate facts are pending; this is a no-op and does not need review or commit")

    from andromeda_parser.moderation import compare_candidate_bundle

    diff = compare_candidate_bundle(candidate)
    candidates_by_key = {str(row["external_key"]): row for row in candidates}
    no_action_keys = {
        str(row["candidate_key"])
        for row in diff["records"]
        if isinstance(row.get("candidate_key"), str)
        and row["classification"] == "unchanged"
        and row.get("provenance_verified") is True
        and not candidates_by_key[str(row["candidate_key"])].get("prior_rejection_event_ids")
    }
    review_required_keys = set(candidates_by_key) - no_action_keys

    try:
        with decisions_file.open("r", encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream)
            if reader.fieldnames is None or not set(DECISION_HEADERS) <= set(reader.fieldnames):
                raise IngestionError(
                    "review CSV requires external_key, decision, reviewed_at, and target_external_key headers"
                )
            decision_rows = list(reader)
    except (OSError, UnicodeDecodeError, csv.Error) as error:
        raise IngestionError("review decisions CSV cannot be read") from error
    if len(decision_rows) != len({row.get("external_key") for row in decision_rows}):
        raise IngestionError("review decisions contain duplicate candidate keys")
    candidate_keys = {str(row.get("external_key")) for row in candidates}
    actionable_rows = []
    for decision_row in decision_rows:
        key = str(decision_row.get("external_key"))
        if key in no_action_keys:
            if any(
                (decision_row.get(field) or "").strip()
                for field in ("decision", "reviewed_at", "target_external_key", "reviewed_by")
            ):
                raise IngestionError("unchanged verified facts must not be resubmitted for review")
            continue
        actionable_rows.append(decision_row)
    decision_rows = actionable_rows
    decision_keys = {str(row.get("external_key")) for row in decision_rows}
    if decision_keys != review_required_keys:
        raise IngestionError(
            "review CSV must contain exactly the candidates that require review; "
            "unchanged verified facts are omitted"
        )

    decisions_by_key: dict[str, dict[str, str]] = {}
    from getpass import getuser

    default_actor = (actor or getuser()).strip()
    if not default_actor or len(default_actor) > 256:
        raise IngestionError("review actor must contain 1 to 256 characters")
    for decision_row in decision_rows:
        key = str(decision_row.get("external_key") or "")
        candidate_row = candidates_by_key[key]
        decision = decision_row.get("decision") or ""
        allowed = {"reject", "accept_observation"} if candidate_row.get("candidate_type") == "canonical_snapshot" else {"reject", "accept_typed_fact"}
        if decision not in allowed:
            raise IngestionError(f"unsupported review decision for {key[:80]}")
        try:
            reviewed = datetime.fromisoformat((decision_row.get("reviewed_at") or "").replace("Z", "+00:00"))
        except ValueError as error:
            raise IngestionError("reviewed_at must be an ISO timestamp") from error
        if reviewed.tzinfo is None:
            raise IngestionError("reviewed_at must include a timezone")
        reviewer = (decision_row.get("reviewed_by") or default_actor).strip()
        if not reviewer or len(reviewer) > 256:
            raise IngestionError("reviewed_by must contain 1 to 256 characters")
        target_key = (decision_row.get("target_external_key") or "").strip()
        if decision == "accept_typed_fact" and (not target_key or target_key != decision_row.get("target_external_key")):
            raise IngestionError("accepted typed facts require a non-empty exact target_external_key")
        if decision != "accept_typed_fact" and target_key:
            raise IngestionError("target_external_key is only valid for an accepted typed fact")
        decisions_by_key[key] = {
            "decision": decision,
            "reviewed_at": reviewed.isoformat(),
            "target_external_key": target_key,
            "reviewed_by": reviewer,
        }

    accepted_typed = [
        row for row in candidates
        if row.get("candidate_type") == "typed_record"
        and str(row["external_key"]) not in no_action_keys
        and decisions_by_key[str(row["external_key"])]["decision"] == "accept_typed_fact"
    ]
    target_by_candidate = {
        str(row["external_key"]): decisions_by_key[str(row["external_key"])]["target_external_key"]
        for row in accepted_typed
    }
    rows_by_dataset: dict[str, dict[str, dict[str, Any]]] = {}
    retirement_digests_by_dataset: dict[str, dict[str, str]] = {}
    resolved_manual_review_rows: list[dict[str, str]] = []
    accepted_source_keys: set[str] = set()
    rejected_source_keys: set[str] = set()
    rejected_archive_rows: list[dict[str, Any]] = []
    review_events: list[dict[str, Any]] = []
    observation_rows: list[dict[str, Any]] = []
    decided_candidates: list[dict[str, Any]] = []
    current_observations = _read_jsonl(candidate / OBSERVATION_DATASET)
    existing_observation_keys = {str(row.get("external_key")) for row in current_observations}

    for row in candidates:
        candidate_key = str(row["external_key"])
        if candidate_key in no_action_keys:
            continue
        decision = decisions_by_key[candidate_key]
        payload_json = row.get("payload_json")
        payload_sha256 = row.get("payload_sha256")
        if not isinstance(payload_json, str) or not isinstance(payload_sha256, str):
            raise IngestionError("reviewed candidate payload is missing its serialized content hash")
        if hashlib.sha256(payload_json.encode("utf-8")).hexdigest() != payload_sha256:
            raise IngestionError("reviewed candidate payload hash does not match its contents")
        if re.search(r"(?i)olymp|олимп", payload_json):
            raise IngestionError("olympiad content is not publishable in the BMSTU bundle")
        artifact_key = row.get("source_artifact_key")
        if isinstance(artifact_key, str):
            (rejected_source_keys if decision["decision"] == "reject" else accepted_source_keys).add(artifact_key)
        if row.get("candidate_type") == "canonical_snapshot":
            for source_key in row.get("source_artifact_keys", []):
                if isinstance(source_key, str):
                    (rejected_source_keys if decision["decision"] == "reject" else accepted_source_keys).add(source_key)
        try:
            proposed_value = json.loads(payload_json)
        except json.JSONDecodeError as error:
            raise IngestionError("reviewed candidate payload is invalid JSON") from error
        source_sha256 = proposed_value.get("source_sha256") if isinstance(proposed_value, dict) else None
        event_core = {
            "candidate_key": candidate_key,
            "decision": decision["decision"],
            "reviewed_at": decision["reviewed_at"],
            "reviewed_by": decision["reviewed_by"],
            "target_dataset": row.get("target_dataset"),
            "target_external_key": decision["target_external_key"] or None,
            "source_identity": row.get("source_identity"),
            "source_artifact_key": artifact_key,
            "source_sha256": source_sha256,
            "source_value_json": payload_json,
            "candidate_payload_sha256": payload_sha256,
        }
        event_id = hashlib.sha256(
            json.dumps(event_core, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        review_events.append({"event_id": event_id, **event_core})
        decided_candidates.append(row)
        if decision["decision"] == "reject":
            rejection = {
                **row,
                "external_key": f"rejected_candidate:{event_id}",
                "candidate_reference": candidate_key,
                "rejection_event_id": event_id,
                "reviewed_at": decision["reviewed_at"],
                "reviewed_by": decision["reviewed_by"],
                "review_state": "rejected",
            }
            rejected_archive_rows.append(rejection)
            continue
        if row.get("candidate_type") == "canonical_snapshot":
            if candidate_key in existing_observation_keys:
                raise IngestionError("candidate key already exists in the source observation dataset")
            accepted_source_keys.update(value for value in row.get("source_artifact_keys", []) if isinstance(value, str))
            observation_rows.append(
                {
                    "external_key": candidate_key,
                    "candidate_type": "canonical_snapshot",
                    "source_capture_digest": row.get("source_capture_digest"),
                    "source_artifact_key": artifact_key,
                    "source_artifact_keys": row.get("source_artifact_keys", []),
                    "source_count": row.get("source_count"),
                    "review_decision": "accept_observation",
                    "reviewed_at": decision["reviewed_at"],
                    "payload_json": payload_json,
                    "payload_sha256": payload_sha256,
                }
            )
            continue

        dataset = row.get("target_dataset")
        if not isinstance(dataset, str) or not dataset.endswith(".jsonl"):
            raise IngestionError("typed candidate has no supported target dataset")
        try:
            typed_row = json.loads(payload_json)
        except json.JSONDecodeError as error:
            raise IngestionError("typed candidate payload is invalid JSON") from error
        if not isinstance(typed_row, dict):
            raise IngestionError("typed candidate payload must be an object")
        typed_row = _resolve_candidate_refs(typed_row, target_by_candidate)
        target_key = decision["target_external_key"]
        typed_row["external_key"] = target_key
        if typed_row.get("retire_existing_record") is True:
            if (
                dataset != "competition_pools.jsonl"
                or target_key != row.get("suggested_target")
                or typed_row.get("retirement_reason") != "legacy_direction_scope_replaced_by_exact_offering_scope"
                or typed_row.get("retired_record_snapshot", {}).get("external_key") != target_key
            ):
                raise IngestionError("reviewed retirement is not an exact supported competition-pool decision")
            retired_digest = typed_row.get("retired_record_sha256")
            if not isinstance(retired_digest, str) or not re.fullmatch(r"[0-9a-f]{64}", retired_digest):
                raise IngestionError("reviewed retirement has no exact prior-row digest")
            pool_retirements = retirement_digests_by_dataset.setdefault(dataset, {})
            if target_key in pool_retirements and pool_retirements[target_key] != retired_digest:
                raise IngestionError("conflicting retirements target the same exact competition pool")
            pool_retirements[target_key] = retired_digest
            for relationship in typed_row.get("retired_relationships", []):
                if not isinstance(relationship, dict):
                    raise IngestionError("retirement contains an invalid relationship snapshot")
                relation_key = relationship.get("external_key")
                relation_digest = relationship.get("row_sha256")
                if (
                    not isinstance(relation_key, str)
                    or not relation_key
                    or not isinstance(relation_digest, str)
                    or not re.fullmatch(r"[0-9a-f]{64}", relation_digest)
                    or relationship.get("relation_type") != "offering_competes_in_pool"
                    or not isinstance(relationship.get("source_key"), str)
                    or relationship.get("target_key") != target_key
                ):
                    raise IngestionError("retirement relationship snapshot is incomplete or points elsewhere")
                relation_retirements = retirement_digests_by_dataset.setdefault("relationships.jsonl", {})
                if relation_key in relation_retirements and relation_retirements[relation_key] != relation_digest:
                    raise IngestionError("conflicting retirements target the same exact relationship")
                relation_retirements[relation_key] = relation_digest
            review_rows = typed_row.get("resolved_manual_review_rows", [])
            if not isinstance(review_rows, list) or any(not isinstance(item, dict) for item in review_rows):
                raise IngestionError("retirement manual-review resolution is malformed")
            resolved_manual_review_rows.extend(review_rows)
            continue
        bucket = rows_by_dataset.setdefault(dataset, {})
        previous = bucket.get(target_key)
        if previous is not None:
            _merge_reviewed_target_row(previous, typed_row)
        else:
            bucket[target_key] = typed_row

    target_input = output_dir.expanduser()
    if target_input.is_symlink():
        raise IngestionError("bundle output must not be a symbolic link")
    if target_input.exists() and (not target_input.is_dir() or any(target_input.iterdir())):
        raise IngestionError("bundle output must be a new or empty directory")
    target_input.parent.mkdir(parents=True, exist_ok=True)
    target_input = target_input.resolve()
    temporary = Path(tempfile.mkdtemp(prefix=f".{target_input.name}.review-", dir=target_input.parent))
    if temporary.resolve().parent != target_input.parent.resolve():
        temporary.rmdir()
        raise IngestionError("temporary review output escaped the requested output directory")
    shutil.copytree(candidate, temporary, dirs_exist_ok=True)
    try:
        for dataset, expected_digests in retirement_digests_by_dataset.items():
            _remove_jsonl_rows_exact(temporary / "data" / dataset, expected_digests)

        for dataset, accepted_rows in rows_by_dataset.items():
            dataset_path = temporary / "data" / dataset
            existing = _read_jsonl(dataset_path) if dataset_path.exists() else []
            by_key = {str(item.get("external_key")): item for item in existing}
            replacements: dict[str, dict[str, Any]] = {}
            for target_key, update in accepted_rows.items():
                current = by_key.get(target_key)
                if current is None:
                    replacements[target_key] = {key: value for key, value in update.items() if value is not None}
                    continue
                merged = dict(current)
                old_artifacts = list(current.get("source_artifact_keys", []))
                if current.get("source_artifact_key"):
                    old_artifacts.append(current["source_artifact_key"])
                new_artifacts = list(update.get("source_artifact_keys", []))
                if update.get("source_artifact_key"):
                    new_artifacts.append(update["source_artifact_key"])
                for field, value in update.items():
                    if field in {"external_key", "source_artifact_key", "source_artifact_keys", "source_sha256", "source_url", "source_retrieved_at"} or value is None:
                        continue
                    merged[field] = value
                if old_artifacts or new_artifacts:
                    merged["source_artifact_keys"] = sorted(set(old_artifacts + new_artifacts))
                if merged != current:
                    replacements[target_key] = merged
            _merge_jsonl_rows_preserving_bytes(dataset_path, replacements)

        observation_path = temporary / OBSERVATION_DATASET
        _merge_jsonl_rows_preserving_bytes(
            observation_path,
            {row["external_key"]: row for row in observation_rows},
        )
        (temporary / CANDIDATE_FILE).unlink()
        (temporary / "review_decisions.csv").unlink(missing_ok=True)

        decisions_manifest = [
            {
                "event_id": event["event_id"],
                "external_key": row["external_key"],
                "candidate_key": event["candidate_key"],
                **{
                    key: value
                    for key, value in event.items()
                    if key not in {"event_id", "candidate_key"}
                },
            }
            for row, event in zip(decided_candidates, review_events, strict=True)
        ]
        decision_history = _read_jsonl(temporary / "review_decisions.jsonl") if (temporary / "review_decisions.jsonl").is_file() else []
        seen_event_ids = {row.get("event_id") for row in decision_history}
        decision_history.extend(event for event in decisions_manifest if event.get("event_id") not in seen_event_ids)
        _write_jsonl(temporary / "review_decisions.jsonl", decision_history)

        rejected_path = temporary / "data" / "bmstu_rejected_candidates.jsonl"
        existing_rejected = _read_jsonl(rejected_path) if rejected_path.is_file() else []
        known_rejections = {row.get("rejection_event_id") for row in existing_rejected}
        existing_rejected.extend(
            row for row in rejected_archive_rows if row.get("rejection_event_id") not in known_rejections
        )
        if existing_rejected:
            _write_jsonl(rejected_path, existing_rejected)

        manifest_path = temporary / SOURCE_ARTIFACTS
        all_artifacts = _read_jsonl(manifest_path)
        added_keys = set(candidate_manifest.get("added_source_artifact_keys", []))
        existing_artifact_keys = {row.get("source_key") for row in _read_jsonl(candidate / SOURCE_ARTIFACTS)} - added_keys
        retained_keys = existing_artifact_keys | accepted_source_keys | rejected_source_keys
        _write_jsonl(
            manifest_path,
            [row for row in all_artifacts if row.get("source_key") not in added_keys or row.get("source_key") in retained_keys],
        )

        review_path = temporary / "manual_review.csv"
        _remove_exact_manual_review_rows(review_path, resolved_manual_review_rows)
        with review_path.open("r", encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream)
            fields = list(reader.fieldnames or REVIEW_HEADERS)
            review_rows = [row for row in reader if row.get("record_key") not in candidate_keys]
        with review_path.open("w", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(review_rows)

        exported = _read_json(temporary / "validation_report.json")
        typed_count = sum(len(rows) for rows in rows_by_dataset.values())
        retired_pool_count = len(retirement_digests_by_dataset.get("competition_pools.jsonl", {}))
        retired_relationship_count = len(retirement_digests_by_dataset.get("relationships.jsonl", {}))
        rejected_count = sum(decision["decision"] == "reject" for decision in decisions_by_key.values())
        exported.setdefault("notes", []).append(
            f"Review materialization accepted {len(observation_rows)} canonical observation(s), "
            f"{len(accepted_typed)} typed candidate(s) into {typed_count} exact target row(s); "
            f"retired {retired_pool_count} exact prior pool(s) and {retired_relationship_count} exact relationship(s); "
            "rejected facts were not applied."
        )
        exported.setdefault("validation", {})["source_artifacts"] = len(_read_jsonl(manifest_path))
        _write_json(temporary / "validation_report.json", exported)
        with (temporary / "report.md").open("a", encoding="utf-8") as stream:
            stream.write(
                "\n\n## Reviewed BMSTU source facts\n\n"
                f"Accepted canonical observations: {len(observation_rows)}; accepted typed facts: "
                f"{len(accepted_typed)} across {typed_count} exact target row(s); retired pools: "
                f"{retired_pool_count}; retired relationships: {retired_relationship_count}; rejected candidates: "
                f"{rejected_count}. "
                "Existing rows were updated only at exact reviewed keys; omitted fields and rows were retained.\n"
            )

        reviewed_validation = validate_bundle(temporary)
        if not reviewed_validation.get("valid"):
            error_codes = ", ".join(
                str(item.get("code", "unknown")) for item in reviewed_validation.get("errors", [])[:8]
            )
            raise IngestionError(f"reviewed bundle failed validation: {error_codes or 'see validation report'}")
        from andromeda_api.application.importer.mapping import project_bundle

        project_bundle(str(temporary))
        exported["validation"]["normalized_records"] = reviewed_validation["counts"]["normalized_records"]
        exported["validation"]["jsonl_datasets"] = reviewed_validation["counts"]["normalized_datasets"]
        _write_json(temporary / "validation_report.json", exported)
        reviewed_validation = validate_bundle(temporary)
        if target_input.exists():
            target_input.rmdir()
        os.replace(temporary, target_input)
    except Exception:
        if temporary.exists():
            shutil.rmtree(temporary)
        raise

    typed_count = sum(len(rows) for rows in rows_by_dataset.values())
    rejected_count = sum(decision["decision"] == "reject" for decision in decisions_by_key.values())
    logger.debug(
        "candidate review materialized candidates=%d observations=%d typed=%d rejected=%d digest=%s",
        len(candidates), len(observation_rows), typed_count,
        rejected_count,
        reviewed_validation["input"]["digest"],
    )
    return {
        "output_dir": str(target_input),
        "accepted": len(observation_rows) + len(accepted_typed),
        "accepted_typed": len(accepted_typed),
        "unchanged_skipped": len(no_action_keys),
        "materialized_typed_rows": typed_count,
        "retired_pools": retired_pool_count,
        "retired_relationships": retired_relationship_count,
        "resolved_manual_review_rows": len(resolved_manual_review_rows),
        "rejected": rejected_count,
        "validation": reviewed_validation,
    }


def validate_import_bundle(input_dir: Path) -> dict[str, Any]:
    if (input_dir / CANDIDATE_FILE).exists():
        raise IngestionError("unreviewed candidate bundle is not importer-mappable")
    try:
        from andromeda_api.application.publication import validate_import_bundle as validate
    except ImportError as error:
        raise IngestionError(
            "bundle validation requires the API application package; run `uv sync --all-packages`"
        ) from error
    return validate(input_dir)


def dry_run_import(input_dir: Path) -> dict[str, Any]:
    validate_import_bundle(input_dir)
    try:
        from andromeda_api.application.publication import dry_run_bundle
    except ImportError as error:
        raise IngestionError(
            "bundle dry-run requires the API application package; run `uv sync --all-packages`"
        ) from error
    return dry_run_bundle(input_dir)


def commit_import(input_dir: Path) -> dict[str, Any]:
    validate_import_bundle(input_dir)
    try:
        from andromeda_api.application.publication import publish_reviewed_bundle
    except ImportError as error:
        raise IngestionError(
            "bundle publication requires the API application package; run `uv sync --all-packages`"
        ) from error
    return publish_reviewed_bundle(input_dir)


def _summary(report: dict[str, Any]) -> dict[str, Any]:
    counts = report.get("counts", {})
    return {
        "valid": report.get("valid"),
        "digest": report.get("input", {}).get("digest"),
        "normalized_records": counts.get("normalized_records"),
        "source_artifacts": counts.get("source_artifacts"),
        "errors": len(report.get("errors", [])),
        "warnings": len(report.get("warnings", [])),
    }


def run_bundle_command(args: Any, parser: Any) -> int:
    from andromeda_parser.ingest import configure_verbose_logging

    configure_verbose_logging(args.log_level)
    try:
        if args.ingest_command == "stage":
            if args.base is not None and not args.bootstrap:
                parser.error("--base requires --bootstrap; normal updates export the active release")
            try:
                from andromeda_api.application.publication import (
                    assert_empty_active_slot,
                    export_active_release_bundle,
                    get_release_status,
                )
            except ImportError as error:
                raise IngestionError(
                    "release bundle operations require the API application package; run `uv sync --all-packages`"
                ) from error

            if args.bootstrap:
                assert_empty_active_slot()
                seed_bundle = args.base or Path("data/bmstu-2026")
                result = build_candidate_bundle(
                    base_bundle=seed_bundle,
                    parse_report_path=args.parse_report,
                    output_dir=args.output,
                )
            else:
                active = get_release_status()
                if not active["archive_available"]:
                    raise IngestionError(
                        "active release bundle is missing; explicitly adopt its exact-digest legacy bundle"
                    )
                with tempfile.TemporaryDirectory(prefix="andromeda-active-release-") as temporary:
                    filename = "base.zip" if active["archive_format"] == "source_zip_v1" else "base"
                    base_bundle = Path(temporary) / filename
                    exported = export_active_release_bundle(base_bundle)
                    if (
                        exported["release_id"] != active["release_id"]
                        or exported["source_bundle_sha256"] != active["source_bundle_sha256"]
                    ):
                        raise IngestionError(
                            "active release changed during candidate staging; retry the stage command"
                        )
                    result = build_candidate_bundle(
                        base_bundle=base_bundle,
                        parse_report_path=args.parse_report,
                        output_dir=args.output,
                        base_release_id=active["release_id"],
                        base_source_bundle_sha256=active["source_bundle_sha256"],
                    )
            output = {
                "output_dir": result["output_dir"],
                "base_digest": result["base_digest"],
                "capture_digest": result["capture_digest"],
                "candidate_key": result["candidate_key"],
                "candidate_count": result["candidate_count"],
                "typed_candidate_count": result["typed_candidate_count"],
                "canonical_snapshot_pending": result["canonical_snapshot_pending"],
                "retirement_candidate_count": result["retirement_candidate_count"],
                "source_artifact_count": result["source_artifact_count"],
                "manual_review_findings_added": result["manual_review_findings_added"],
                "validation": _summary(result["validation"]),
            }
        elif args.ingest_command == "diff":
            from andromeda_parser.moderation import compare_candidate_bundle, write_diff_report

            result = compare_candidate_bundle(args.input)
            write_diff_report(result, json_path=args.json_output, csv_path=args.csv_output)
            output = {
                "json_report": str(args.json_output),
                "csv_report": str(args.csv_output) if args.csv_output else None,
                "base_release_id": result["base_release_id"],
                "counts": result["counts"],
                "bulk_eligible_count": result["bulk_eligible_count"],
            }
        elif args.ingest_command == "probe":
            from andromeda_parser.probe import probe_official_sources

            result = probe_official_sources(
                args.compare_bundle,
                output_path=args.output,
                release_id=args.release_id,
            )
            output = {
                "report_path": str(args.output),
                "fetch_calls_used": result["request_policy"]["fetch_calls_used"],
                "categories": result["categories"],
                "source_gaps": result["source_gaps"],
                "live_data_committed": result["request_policy"]["live_data_committed"],
            }
        elif args.ingest_command == "review-template":
            from getpass import getuser

            from andromeda_parser.moderation import write_review_template

            result = write_review_template(
                args.input,
                args.output,
                actor=args.actor or getuser(),
            )
            output = {"review_decisions": str(args.output), **result}
        elif args.ingest_command == "remoderate":
            from andromeda_parser.moderation import prepare_rejected_candidates

            result = prepare_rejected_candidates(
                args.input,
                args.output,
                candidate_keys=set(args.candidate_keys) if args.candidate_keys else None,
            )
            output = result
        elif args.ingest_command == "review":
            result = materialize_reviewed_bundle(
                candidate_dir=args.input,
                decisions_path=args.decisions,
                output_dir=args.output,
                actor=args.actor,
            )
            output = {
                "output_dir": result["output_dir"],
                "accepted": result["accepted"],
                "accepted_typed": result["accepted_typed"],
                "rejected": result["rejected"],
                "retired_pools": result["retired_pools"],
                "retired_relationships": result["retired_relationships"],
                "resolved_manual_review_rows": result["resolved_manual_review_rows"],
                "validation": _summary(result["validation"]),
            }
        elif args.ingest_command == "validate":
            output = _summary(validate_import_bundle(args.input))
        elif args.ingest_command == "dry-run":
            output = dry_run_import(args.input)
        elif args.ingest_command == "commit":
            output = commit_import(args.input)
        else:
            parser.error(f"unsupported ingestion action: {args.ingest_command}")
            return 2
    except Exception as error:
        if isinstance(error, (IngestionError, ValueError, OSError)) or type(error).__name__ in {
            "BundleImportError",
            "SettingsError",
        }:
            parser.error(f"{args.ingest_command} failed: {type(error).__name__}: {error}")
        parser.error(f"{args.ingest_command} failed: {type(error).__name__}; see verbose logs")
        return 2

    serialized = json.dumps(output, ensure_ascii=False, indent=2, default=str) + "\n"
    result_path = getattr(args, "output", None)
    if result_path is not None and args.ingest_command in {"validate", "dry-run", "commit"}:
        result_path.parent.mkdir(parents=True, exist_ok=True)
        result_path.write_text(serialized, encoding="utf-8")
    print(serialized, end="")
    return 0
