"""Parsers for official BMSTU undergraduate admission documents."""

from .authority import build_authoritative_intake_records
from .parser import (
    parse_achievements_pdf,
    parse_exam_requirements_pdf,
    parse_intake_plan_pdf,
    parse_targeted_quota_pdf,
)

__all__ = [
    "build_authoritative_intake_records",
    "parse_achievements_pdf",
    "parse_exam_requirements_pdf",
    "parse_intake_plan_pdf",
    "parse_targeted_quota_pdf",
]
