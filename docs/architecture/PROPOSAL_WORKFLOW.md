# Proposal, review, and publication workflow

## Relationship to ingestion

Proposal persistence is part of the existing bundle pipeline, not a second importer:

```text
capture → parse → candidate → diff → review → materialize → validate → commit
                                │       │                         │
                                └──── proposal records ──────────┘
                                        exact review event → one canonical publisher
```

The candidate bundle remains the immutable handoff between parsing and review. Candidate identities and payload hashes are checked against the staged bundle; before publication, each review event ID is recomputed from its canonical event body and checked against the accepted-candidate manifest. The approved payload's accepted candidate references are resolved, and every non-null approved field must match the exact materialized target row and survive the canonical mapper projection. Ingestion treats null patch fields as “leave the existing value unchanged”; retirement proposals instead require the target's absence. Source artifact hashes and locators are retained as proposal evidence. The current canonical release remains the exact base for an update. Bootstrap of the first release has no active base and retains its existing guarded path.

## Persisted records

Migration `71d8c4a29f30_add_proposal_lifecycle` adds four tables:

| Table | Meaning |
|---|---|
| `proposals` | Current aggregate: ID, optimistic version, current revision number, status, author/timestamps, approval review-event link, and published release link |
| `proposal_revisions` | Immutable change type, target dataset/key, canonical payload and SHA-256, source candidate key, and expected active release ID/digest |
| `proposal_evidence_refs` | Immutable source-document SHA-256, source artifact key, locator, URL, and capture time, scoped to a proposal revision |
| `proposal_events` | Immutable transition/decision audit: aggregate version, previous/next status, actor, reason, review event, idempotency key/request hash, and resulting release when published |

There is no duplicate `proposal_decisions` table: approve/reject and other transitions are decision/audit events. The source's full document is not duplicated; its immutable artifact hash and locator refer back to the reviewed bundle. Database constraints enforce valid statuses, positive versions, SHA-256 shape, required actor/reason/review references, release links, and unique per-proposal versions/idempotency keys. Triggers reject updates/deletes to revisions, evidence, and events.

## State machine

| Current | Allowed next state | Condition |
|---|---|---|
| `DRAFT` | `VALIDATED`, `NEEDS_REVIEW`, `CONFLICTING`, `REJECTED` | Validation/evidence rules and actor policy pass |
| `VALIDATED` | `NEEDS_REVIEW`, `APPROVED`, `CONFLICTING`, `REJECTED` | Approval includes the exact accepted review event |
| `NEEDS_REVIEW` | `APPROVED`, `CONFLICTING`, `REJECTED` | Reviewer decision is bound to the candidate, payload, and bundle |
| `APPROVED` | `PUBLISHED`, `CONFLICTING` | `PUBLISHED` is allowed only inside the canonical release transaction; stale active base becomes conflicting after publication rollback |
| `CONFLICTING` | `DRAFT` | A new revision is supplied through the rebase use case |
| `REJECTED`, `PUBLISHED` | terminal | A new proposal is required |

Each command checks expected aggregate version, expected state, actor permission, transition legality, and required evidence. Validation and approval require at least one evidence reference. A rejection requires a nonblank reason. Non-publication use cases default to deny; only the trusted local CLI injects the explicit local operator policy. Invalid state, stale version, missing evidence, unauthorized actor, or key/payload mismatch is returned as a stable proposal domain error.

## Transaction and concurrency guarantees

Publication enters `PublicationApplicationService` and the sole DB publisher `publish_projection`. Under its existing PostgreSQL advisory transaction lock and active-release row lock, the publisher checks the expected active release ID/digest, revalidates proposal revisions and approved events, materializes and validates the new canonical release, and updates all participating records before commit:

```text
one PostgreSQL transaction
  release rows + immutable archive
  import batch marked committed + whole-command idempotency record
  approved proposal rows changed to PUBLISHED + immutable PUBLISHED events
  active-release pointer + activation event
COMMIT
```

An error before commit leaves no release, proposal publication, active-pointer switch, or activation event. The failed-batch diagnostic is recorded only after rollback and cannot imply publication success. Existing releases and activation history are never rewritten.

The compare-and-swap update requires the expected proposal version and status. Concurrent `approve/approve`, `approve/reject`, and `publish/publish` operations cannot silently overwrite one another: one transition advances the aggregate version; a competing distinct command becomes stale. Repeated identical transition commands replay the already-recorded result. A stale active release causes the publication transaction to roll back; proposals can then be marked conflicting in a separate audit transaction.

## Idempotency

The release-level `import_batches.publication_idempotency_key` is unique and paired with a normalized whole-command SHA-256. Ingestion commit uses `ingestion-commit:<reviewed bundle digest>`. A retry after a lost connection checks this committed record before checking the current active base and returns the original release, without inserting another release. The same key with a different request hash fails closed.

Each proposal's publish event also uses a stable key derived from the release command key and proposal ID. Its request hash binds the proposal ID/version, base release, candidate and review-event identity, target, payload hash, actor, and key. A repeated proposal key with different content is rejected. Exact retries after a committed release replay at the import-batch boundary, so they do not try to append a second proposal event.

## Privileges and HTTP

The API's write-capable runtime database role can read/insert/update `proposals` and insert into revisions, evidence references, and events. Read-only API and Directus roles have no proposal write privileges. The trusted CLI authorization policy binds the audit actor to the current OS account; a `--actor` or CSV label cannot grant a different principal proposal permissions. Directus remains a viewer and metadata client; it cannot modify academic facts or publish a release.

The current proposal use cases are internal application services; `/api/v1` has no proposal/admin write endpoints. Do not expose those use cases over HTTP until a real authentication, authorization, reviewer identity, and operational policy is selected and tested. The CLI's local operator policy is not an HTTP security model.

## CLI behavior

The `andromeda-bmstu` command grammar is retained. The executable now belongs to `services/ingestion-cli`, an outer composition package depending on API application services and ingestion. `services/ingestion` itself depends on domain, contracts, and the neutral `packages/release-bundles`; parsers can load and parse captures without API/DB/FastAPI/SQLAlchemy installed. Stage/diff/review persist proposal states where the exact workflow applies; validate and dry-run remain read-only; commit reaches the single canonical publisher.

Run through the workspace entry point after `uv sync --locked --all-packages`:

```powershell
uv run andromeda-bmstu ingest --help
```

The pure parser package also retains its parser and local capture/parse commands without requiring the API runtime. PostgreSQL-backed proposal transitions require the outer CLI package and a local operator database configuration.
