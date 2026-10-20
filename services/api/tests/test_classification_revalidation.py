import json
import zipfile
from pathlib import Path

import pytest
from andromeda_api.application.classification import importer


@pytest.fixture
def package(monkeypatch, tmp_path):
    manifest = {
        "source_release_digest": "old",
        "source_input_sha256": "unchanged-inputs",
        "result_sha256": "unchanged-answers",
    }
    original = tmp_path / "original.json"
    original.write_text(json.dumps(manifest), encoding="utf-8")
    monkeypatch.setattr(
        importer, "_validate_package", lambda *args: (manifest, [{"id": 1}], {})
    )
    monkeypatch.setattr(
        importer,
        "load_active_classification_subjects",
        lambda engine: {
            "release": {
                "release_key": "release:new",
                "source_bundle_sha256": "active-digest",
            },
        },
    )

    class Reader:
        input_digest = "active-digest"

        def __init__(self, path):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    monkeypatch.setattr(importer, "BundleReader", Reader)
    return original, tmp_path / "new.json", manifest, Reader


def revalidate(package):
    original, output, _, _ = package
    return importer.revalidate_manifest_for_active_release(
        None,
        Path("bundle"),
        Path("results"),
        original,
        output,
        "release:new",
    )


def test_revalidation_preserves_answers_inputs_and_original_manifest(package):
    original, output, manifest, _ = package
    revalidate(package)
    new = json.loads(output.read_text(encoding="utf-8"))
    assert new["source_release_digest"] == "active-digest"
    assert new["result_sha256"] == manifest["result_sha256"]
    assert new["source_input_sha256"] == manifest["source_input_sha256"]
    assert new["revalidation"]["exact_validated_subject_inputs"] == 1
    assert json.loads(original.read_text(encoding="utf-8")) == manifest


def test_revalidation_rejects_wrong_active_release(package, monkeypatch):
    monkeypatch.setattr(
        importer,
        "load_active_classification_subjects",
        lambda engine: {
            "release": {
                "release_key": "release:changed",
                "source_bundle_sha256": "active-digest",
            },
        },
    )
    with pytest.raises(
        importer.ClassificationImportError, match="expected revalidation target"
    ):
        revalidate(package)
    assert not package[1].exists()


def test_revalidation_rejects_bundle_from_another_release(package):
    package[3].input_digest = "other-bundle"
    with pytest.raises(
        importer.ClassificationImportError, match="exact active release bundle"
    ):
        revalidate(package)
    assert not package[1].exists()


def test_revalidation_rejects_changed_classifier_inputs(package, monkeypatch):
    def invalid(*args):
        raise importer.ClassificationImportError(
            "source bundle contents changed after classification"
        )

    monkeypatch.setattr(importer, "_validate_package", invalid)
    with pytest.raises(
        importer.ClassificationImportError, match="source bundle contents changed"
    ):
        revalidate(package)
    assert not package[1].exists()


def test_revalidation_never_overwrites_existing_manifest(package):
    package[1].write_text("existing", encoding="utf-8")
    with pytest.raises(FileExistsError):
        revalidate(package)
    assert package[1].read_text(encoding="utf-8") == "existing"


def test_zip_subject_inputs_equal_directory_inputs(tmp_path, monkeypatch):
    names = ["educational_programs", "departments", "directions", "courses", "curriculum_items"]
    expected = {f"data/{name}.jsonl": b"{}\n" for name in names}
    archive_path = tmp_path / "bundle.zip"
    with zipfile.ZipFile(archive_path, "w") as archive:
        for name, body in expected.items():
            archive.writestr("bundle/" + name, body)

    def load(directory):
        assert {name: (directory / name).read_bytes() for name in expected} == expected
        return [{"subject_external_key": "item:1"}], "unchanged-inputs"

    monkeypatch.setattr(importer, "_load_subjects", load)
    assert importer._load_package_subjects(archive_path) == ([{"subject_external_key": "item:1"}], "unchanged-inputs")
