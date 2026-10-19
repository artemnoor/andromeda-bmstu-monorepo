import json
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from andromeda.ingestion.universities.bmstu.capture import BmstuSource
from andromeda.ingestion.universities.bmstu.parser.curriculum import _plan_header
from andromeda.ingestion.universities.bmstu.source_models import FetchedResource
from andromeda_parser.repair_study_plans import _placeholder, repair_bundle


def test_profile_identity_survives_wrapped_pdf_heading():
    header = _plan_header(
        [
            "Направление подготовки — 01.03.04, Прикладная математика",
            "Профиль — Математическое моделирование, вычислительные",
            "технологии и программные системы в науке и технике (01.03.04-05)",
            "Квалификация — Инженер-математик",
        ]
    )
    assert header["program_profile_code"] == "01.03.04-05"
    assert header["program_profile"] == (
        "Математическое моделирование, вычислительные технологии и программные системы в науке и технике"
    )


def test_heading_does_not_borrow_profile_from_next_section():
    header = _plan_header(
        [
            "Профиль — Не указан",
            "Квалификация — Инженер",
            "ПЛАН УЧЕБНОГО ПРОЦЕССА",
            "Другой документ 27.03.05-09",
        ]
    )
    assert header["program_profile_code"] is None


def test_public_folder_reads_all_pages_and_nested_download_link():
    class Fetcher:
        def fetch_http(self, url):
            query = parse_qs(urlsplit(url).query)
            if "/download?" in url:
                body = {"href": "https://downloader.disk.yandex.ru/second.pdf"}
            elif "path" not in query:
                body = {
                    "type": "dir",
                    "path": "/",
                    "_embedded": {
                        "total": 2,
                        "offset": 0,
                        "items": [{"type": "dir", "path": "/plans"}],
                    },
                }
            elif query["path"] == ["/plans"]:
                body = {
                    "type": "dir",
                    "path": "/plans",
                    "_embedded": {
                        "total": 1,
                        "offset": 0,
                        "items": [{"type": "file", "path": "/plans/second.pdf"}],
                    },
                }
            else:
                assert query["offset"] == ["1"]
                body = {
                    "type": "dir",
                    "path": "/",
                    "_embedded": {
                        "total": 2,
                        "offset": 1,
                        "items": [
                            {"file": "https://downloader.disk.yandex.ru/first.pdf"}
                        ],
                    },
                }
            return FetchedResource(
                requested_url=url,
                final_url=url,
                status_code=200,
                content_type="application/json",
                body=json.dumps(body).encode(),
                fetched_at="2026-10-19T00:00:00+00:00",
            )

    source = BmstuSource(fetcher=Fetcher())
    urls = source._public_document_urls(
        "https://disk.yandex.ru/d/root",
        {
            "type": "dir",
            "path": "/",
            "_embedded": {
                "total": 2,
                "offset": 0,
                "items": [{"type": "dir", "path": "/plans"}],
            },
        },
        "https://disk.yandex.ru/d/root",
        [],
    )
    assert set(urls) == {
        "https://downloader.disk.yandex.ru/first.pdf",
        "https://downloader.disk.yandex.ru/second.pdf",
    }
    assert not source._capture_gaps


def test_repair_accepts_exact_pdf_and_rejects_shared_link_to_another_profile(tmp_path):
    source = tmp_path / "base"
    (source / "data").mkdir(parents=True)
    url = "https://disk.yandex.ru/d/shared"
    programs = [
        {"external_key": "program:" + code, "code": code, "study_plan_url": url}
        for code in ("09.03.01-02", "27.03.05/09")
    ]
    plans = [
        {
            "external_key": "study_plan:" + p["external_key"],
            "program_key": p["external_key"],
            "status": "linked_public_resource_has_no_file",
            "study_plan_url": url,
        }
        for p in programs
    ]
    for name, rows in {
        "data/educational_programs.jsonl": programs,
        "data/study_plans.jsonl": plans,
        "data/curriculum_items.jsonl": [],
        "data/relationships.jsonl": [],
        "source_artifacts.jsonl": [],
    }.items():
        (source / name).write_text(
            "".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8"
        )
    (source / "manual_review.csv").write_text(
        "record_key,issue_type,source_url,details\n", encoding="utf-8"
    )
    original = (source / "data/study_plans.jsonl").read_bytes()
    body = (
        Path(__file__).parent / "fixtures/bmstu/ingestion/curriculum.pdf"
    ).read_bytes()
    snapshot = BmstuSource._snapshot(
        "bmstu_curriculum_document",
        url,
        FetchedResource(
            requested_url=url,
            final_url="https://downloader.disk.yandex.ru/exact.pdf",
            status_code=200,
            content_type="application/pdf",
            body=body,
            fetched_at="2026-10-19T00:00:00+00:00",
        ),
    )
    requests = []

    def capture(link):
        requests.append(link)
        return (snapshot,)

    output = tmp_path / "corrected"
    report = repair_bundle(source, output, capture=capture)
    assert report["statuses"] == {"recovered": 1, "profile_mismatch": 1}
    assert requests == [url]  # same public folder fetched once
    assert (source / "data/study_plans.jsonl").read_bytes() == original
    result = [
        json.loads(line)
        for line in (output / "data/curriculum_items.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
    ]
    assert result
    assert {row["program_key"] for row in result} == {"program:09.03.01-02"}
    assert len({row["external_key"] for row in result}) == len(result)
    assert all(row["source_sha256"] == snapshot.content_sha256 for row in result)


def test_official_placeholder_is_distinct_from_a_curriculum():
    import io
    import zipfile

    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr(
            "word/document.xml",
            "<document><p>Учебный план появится позже</p></document>",
        )
    assert _placeholder(output.getvalue()) == "Учебный план появится позже"
    assert _placeholder(b"not a document") is None
