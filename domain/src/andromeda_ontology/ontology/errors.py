"""Typed failures raised by pure ontology invariants."""

from __future__ import annotations


class DomainValidationError(ValueError):
    """A domain value violates a named invariant."""

    code = "domain_validation_error"

    def __init__(self, message: str, *, field: str) -> None:
        self.field = field
        super().__init__(message)
