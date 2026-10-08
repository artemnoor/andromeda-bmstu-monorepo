"""Logging adapter for pure ontology validation failures."""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from andromeda_ontology.ontology.errors import DomainValidationError

logger = logging.getLogger("andromeda.contracts.validation")


def validate_domain(
    model_name: str,
    validator: Callable[..., None],
    *args: Any,
    entity_id: str | None = None,
    **kwargs: Any,
) -> None:
    """Call a pure invariant and emit a safe, structured adapter diagnostic."""

    try:
        validator(*args, **kwargs)
    except DomainValidationError as error:
        logger.error(
            "contract_semantic_violation",
            extra={
                "event": "contract.semantic_violation",
                "model": model_name,
                "field": error.field,
                "entity_id": entity_id,
            },
        )
        raise
