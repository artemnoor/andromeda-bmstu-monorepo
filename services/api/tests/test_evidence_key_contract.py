import pytest
from andromeda_contracts.api.v1.models import SourceEvidenceReference
from pydantic import ValidationError


def evidence(key):
    return SourceEvidenceReference(
        evidence_key=key,
        source_artifact_key="source_artifact:official-pdf",
        claim_path="data/curriculum_items.jsonl#L14166",
        verification_status="source_backed",
    )


def test_source_evidence_accepts_persisted_keys_up_to_database_limit():
    # Identity-based curriculum keys plus evidence scope/hash can exceed 256.
    prefix = "evidence:curriculum_items.jsonl:"
    key = prefix + "a" * (512 - len(prefix))
    assert len(key) == 512
    assert evidence(key).evidence_key == key


def test_source_evidence_rejects_keys_beyond_database_limit():
    with pytest.raises(ValidationError):
        evidence("e" * 513)
