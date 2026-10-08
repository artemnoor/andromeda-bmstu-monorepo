# Dagster platform boundary

This directory reserves a location for a future orchestrator integration. No
Dagster dependency, runtime, asset definition, schedule, sensor, or deployment
configuration is present.

The current ingestion path remains the checked-in parser and CLI workflow. Do
not infer that importing or scheduling jobs through Dagster is supported until
a dedicated implementation and operational owner exist.
