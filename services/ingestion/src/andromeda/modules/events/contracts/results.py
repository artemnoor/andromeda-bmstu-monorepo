from __future__ import annotations

from andromeda.shared.contracts.base import ContractModel
from pydantic import Field

from ..domain.entities import Event


class EventListResult(ContractModel):
    items: tuple[Event, ...] = ()
    total: int = Field(strict=True, ge=0)


class EventDetailResult(ContractModel):
    event: Event


__all__ = ["EventDetailResult", "EventListResult"]
