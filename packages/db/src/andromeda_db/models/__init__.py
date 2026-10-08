"""SQLAlchemy model registry owned by the database package."""

from . import (
    admission_models,
    catalog_models,
    evidence_models,
    models,
    source_models,
    subject_classification_models,
)
from .base import Base
from .models import (
    ProposalEventModel,
    ProposalEvidenceReferenceModel,
    ProposalModel,
    ProposalRevisionModel,
)

__all__ = [
    "Base",
    "ProposalEventModel",
    "ProposalEvidenceReferenceModel",
    "ProposalModel",
    "ProposalRevisionModel",
    "admission_models",
    "catalog_models",
    "evidence_models",
    "models",
    "source_models",
    "subject_classification_models",
]
