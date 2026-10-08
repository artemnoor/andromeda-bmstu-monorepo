"""Pure text helpers shared by the offline BMSTU parsers."""

from __future__ import annotations

import re
from urllib.parse import unquote


def clean_text(value: object) -> str:
    if value is None:
        return ""
    text = unquote(str(value)).replace("\xa0", " ").replace("&nbsp;", " ")
    return re.sub(r"\s+", " ", text).strip()


def normalize_code(value: object) -> str:
    return (
        re.sub(r"\s+", "", clean_text(value))
        .replace("–", "-")
        .replace("—", "-")
        .replace("−", "-")
    )
