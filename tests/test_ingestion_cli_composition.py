from __future__ import annotations

from pathlib import Path
from typing import Any
from uuid import uuid4

import andromeda_api.application.publication as publication_application
import andromeda_ingestion_cli.cli as cli_module
from andromeda_ingestion_cli.cli import ApiIngestionOperations


def test_review_adapter_delegates_exact_bundle_arguments(monkeypatch: Any, tmp_path: Path) -> None:
    candidate = tmp_path / "candidate"
    decisions = tmp_path / "decisions.jsonl"
    reviewed = tmp_path / "reviewed"
    calls: list[tuple[tuple[Any, ...], dict[str, Any]]] = []

    def review(*args: Any, **kwargs: Any) -> list[dict[str, Any]]:
        calls.append((args, kwargs))
        return [{"proposal_id": "proposal-1"}]

    monkeypatch.setattr(cli_module, "review_candidate_bundle", review)

    result = ApiIngestionOperations().review_candidate_bundle(
        candidate,
        decisions,
        reviewed,
        actor="reviewer",
    )

    assert result == [{"proposal_id": "proposal-1"}]
    assert calls == [((candidate, decisions, reviewed), {"actor": "reviewer"})]


def test_publish_adapter_composes_reviewed_bundle_once(monkeypatch: Any, tmp_path: Path) -> None:
    input_path = tmp_path / "reviewed"
    expected_release = uuid4()
    proposals = (object(),)
    commands = (proposals, "ingestion-commit:test", expected_release)
    calls: list[tuple[tuple[Any, ...], dict[str, Any]]] = []

    def prepare(path: Path, *, actor: str) -> tuple[Any, ...]:
        assert path == input_path
        assert actor == "operator"
        return commands

    def publish(*args: Any, **kwargs: Any) -> dict[str, Any]:
        calls.append((args, kwargs))
        return {"outcome": "committed"}

    monkeypatch.setattr(cli_module, "publication_commands", prepare)
    monkeypatch.setattr("getpass.getuser", lambda: "operator")
    monkeypatch.setattr(publication_application, "publish_reviewed_bundle", publish)

    result = ApiIngestionOperations().publish_reviewed_bundle(input_path)

    assert result == {"outcome": "committed"}
    assert calls == [
        (
            (input_path,),
            {
                "actor": "operator",
                "expected_active_release_id": expected_release,
                "proposals": proposals,
                "idempotency_key": "ingestion-commit:test",
            },
        )
    ]
