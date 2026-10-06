"""Stable source identifiers required by the admission evidence contract."""

from typing import Annotated

from pydantic import StringConstraints

SourceId = Annotated[str, StringConstraints(pattern=r"^source:[a-z0-9][a-z0-9-]{0,95}$")]
SourceObservationId = Annotated[
    str,
    StringConstraints(pattern=r"^source-observation:[a-f0-9]{32}$"),
]

__all__ = ["SourceId", "SourceObservationId"]
