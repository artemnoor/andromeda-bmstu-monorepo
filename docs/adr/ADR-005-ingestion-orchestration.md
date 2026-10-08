# ADR-005: Keep orchestration separate from source truth

- Status: Proposed; runtime deferred
- Date: 2026-10-08
- Basis: Architecture v1.1, sections 5 and 9

## Context

The architecture proposal names Dagster as an option for scheduling parser runs, expressing dependencies, and exposing run status. The current parser and review flow is CLI-driven and can run independently; no Dagster package or deployment is present.

## Decision

If orchestration is added, Dagster may schedule and observe ingestion jobs, but it must not decide whether a parsed fact is valid or publish canonical rows outside the reviewed API application service. Parser and domain code remain independently testable.

## Consequences

- There is no Dagster runtime, schedule, retry policy, quarantine, or operational dashboard in the current implementation.
- Adding Dagster requires an explicit deployment and failure/replay design; it is not a prerequisite for the current CLI workflow.

## Verification

Deferred. No orchestration runtime or deployment has been tested.
