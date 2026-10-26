"""Read workload cells by PDF coordinates, never by proportional text columns."""

from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Any

NS = {"x": "http://www.w3.org/1999/xhtml"}
NUMBER = re.compile(r"\d+(?:[.,]\d+)?")


def _normal(value: str) -> str:
    return re.sub(r"[^\w]+", "", value.casefold().replace("ё", "е"))


@dataclass
class GeometryRow:
    page: int
    row_number: int
    name: str
    cells: list[dict[str, Any]]


class CurriculumGeometry:
    def __init__(self, rows: list[GeometryRow], semester_totals: dict[int, dict[str, Any]]) -> None:
        self.rows = rows
        self.semester_totals = semester_totals
        self.used: set[int] = set()

    def match(self, page: int, row_number: int, name: str) -> GeometryRow | None:
        normalized = _normal(name)
        for index, row in enumerate(self.rows):
            if index in self.used or row.page != page or row.row_number != row_number:
                continue
            candidate = _normal(row.name)
            if candidate and (normalized.startswith(candidate) or candidate.startswith(normalized)):
                self.used.add(index)
                return row
        return None


def _cells(words: list[dict[str, Any]], starts: list[float]) -> list[dict[str, Any]]:
    result = []
    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else start + (starts[1] - starts[0])
        group = [word["text"] for word in words if start <= word["x"] < end]
        numbers = [float(word.replace(",", ".")) for word in group if NUMBER.fullmatch(word)]
        if len(numbers) != 4:
            continue
        credits, hours, audited, independent = numbers
        # Reject a shifted or joined cell, rather than inventing a workload.
        if not (0 <= credits <= 60 and 0 <= hours <= 2160 and abs(credits * 36 - hours) <= 1):
            continue
        if min(audited, independent) < 0 or abs(audited + independent - hours) > 1:
            continue
        result.append({
            "semester": index + 1, "credits": credits, "hours": int(hours),
            "audited_hours_semester": int(audited), "self_study": int(independent),
            "assessment_type": " ".join(word for word in group if not NUMBER.fullmatch(word)) or None,
        })
    return result


def read_curriculum_geometry(body: bytes) -> CurriculumGeometry:
    executable = shutil.which("pdftotext")
    if executable is None:
        return CurriculumGeometry([], {})
    with tempfile.TemporaryDirectory(prefix="andromeda-plan-geometry-") as directory:
        source = Path(directory) / "source.pdf"
        source.write_bytes(body)
        response = subprocess.run(
            [executable, "-bbox-layout", "-enc", "UTF-8", str(source), "-"],
            capture_output=True, timeout=45, check=False,
        )
    if response.returncode:
        return CurriculumGeometry([], {})
    try:
        document = ET.fromstring(response.stdout)
    except ET.ParseError:
        return CurriculumGeometry([], {})
    rows: list[GeometryRow] = []
    semester_totals: dict[int, dict[str, Any]] = {}
    for page_number, page in enumerate(document.findall(".//x:page", NS), start=1):
        words = [
            {"text": word.text or "", "x": float(word.attrib["xMin"]), "y": float(word.attrib["yMin"])}
            for word in page.findall(".//x:word", NS)
        ]
        semester_labels = [word for word in words if word["text"] == "Семестр"]
        if not semester_labels:
            continue
        header_y = min(word["y"] for word in semester_labels)
        labels = sorted([word for word in semester_labels if abs(word["y"] - header_y) < 1], key=lambda word: word["x"])
        if len(labels) < 2:
            continue
        # The semester title is centered differently in four-, six- and
        # seven-year templates. Anchor at the actual credit subcolumn instead.
        credit_labels = [word for word in words if _normal(word["text"]) == "зе" and header_y + 10 < word["y"] < header_y + 45]
        spacing = labels[1]["x"] - labels[0]["x"]
        starts = []
        for label in labels:
            candidates = [word for word in credit_labels if abs(word["x"] - label["x"]) < spacing / 3]
            anchor = min(candidates, key=lambda word: abs(word["x"] - label["x"])) if candidates else None
            starts.append(anchor["x"] - 7 if anchor else label["x"] - 10)
        chairs = [word for word in words if word["text"] == "Кафедра" and abs(word["y"] - header_y) < 12]
        if not chairs:
            continue
        chair_x = chairs[0]["x"]
        grouped: list[list[dict[str, Any]]] = []
        for word in sorted(words, key=lambda word: (word["y"], word["x"])):
            if word["y"] <= header_y + 10:
                continue
            if not grouped or abs(grouped[-1][0]["y"] - word["y"]) > 0.8:
                grouped.append([word])
            else:
                grouped[-1].append(word)
        for group in grouped:
            group.sort(key=lambda word: word["x"])
            text = " ".join(word["text"] for word in group)
            if "Общая трудоемкость основной образовательной" in text and not semester_totals:
                # The academic-hours total precedes the astronomical-hours total.
                semester_totals = {cell["semester"]: cell for cell in _cells(group, starts)}
            if not group[0]["text"].isdigit() or group[0]["x"] >= chair_x - 30:
                continue
            title = " ".join(word["text"] for word in group[1:] if word["x"] < chair_x - 5)
            if not title:
                continue
            rows.append(GeometryRow(page_number, int(group[0]["text"]), title, _cells(group, starts)))
    return CurriculumGeometry(rows, semester_totals)
