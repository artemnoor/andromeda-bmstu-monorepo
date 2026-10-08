# Curriculum item identity

## Three separate values

`curriculum_items.external_key` is the canonical key used by releases and the
importer. New, unambiguous rows use
`curriculum_item:<exact-study-plan-key>:identity:<sha256>`. A row's printed
number, parsed order, and PDF page are locators, not canonical identity.

The source identity signature is stored in the existing `source_row` JSON
column as `identity.source_identity_id`, with its versioned algorithm and
exact signals. No schema migration is needed. Existing releases and keys such
as `curriculum_item:<plan>:row:<position>` remain unchanged.

Each candidate also carries source provenance: source artifact key and SHA-256,
URL, retrieval time, PDF page, printed row number, parsed position, and
semester where available. This points back to the exact captured PDF row even
when the canonical key is preserved from an older release.

## Exact source signals

The current BMSTU PDF parser does not expose an official discipline code or a
stable row identifier. Its uppercase chair token is a department/chair
abbreviation, not a discipline code. Identity therefore uses:

1. The exact study-plan external key.
2. The discipline label after lossless Unicode NFKC, case-folding, and
   whitespace normalization. Punctuation and spelling are retained.
3. Exact chair abbreviation, official block label, and mandatory/variable
   section when the source provides them.
4. Semester only to distinguish repeated exact labels in the same source
   context when it is unique. Semester is excluded for a unique label.

Hours, credits, assessment/control, row order, page, and printed row number are
mutable facts or locators. They do not form the source identity signature.

## Reconciliation rules

Candidate construction exports the current release and reconciles only against
rows belonging to the exact plan. It first uses a previously stored exact
source signature, then a one-to-one exact label and compatible source context.
A unique exact label can retain its canonical key across a semester change.
Repeated labels can be paired only when exact context and semester produce a
unique one-to-one match. A changed semester inside a repeated-label group is
ambiguous.

An exact title change has no stable official identifier to support a safe
merge. Similarity may list possible current keys for a reviewer, but the
candidate is classified `ambiguous`, keeps an observation key, and cannot be
bulk-confirmed. Repeated indistinguishable rows are preserved separately and
also require review; the parser never collapses them into one set of hours or
control facts.

An unambiguous row with no exact current match receives a deterministic
identity key from the exact signals above. Parsing the same source identity
again yields the same key. A changed label that is only similar to an existing
row does not produce a new canonical target automatically.

## Legacy key compatibility and removals

The active release is the reconciliation baseline. Where the new row has a
unique exact match, the existing canonical key is retained, including legacy
`row:<position>` keys. Accepted rows store the new source signature alongside
that old key, so later revisions no longer need to depend on row position.
There is no bulk key rewrite and no migration of published immutable releases.

Rows missing from a partial or failed source scope produce no removal result.
For a successfully parsed complete plan, unmatched old keys can appear as
`potentially_removed`; this is a review result only. Importing or reviewing a
candidate never deletes an existing canonical row automatically.

## Current verification and limits

- The two checked-in PDF fixtures emit 89 and 123 curriculum rows. Repeated
  parses produce the same identity keys and retain PDF hashes and locators.
- The checked-in release slice for profile `01.03.02-01` contains 113 rows;
  the new reconciliation regression retains all 113 existing keys with no
  ambiguity. The saved bounded live report also records 113/113 matches under
  the prior positional convention, but the raw live PDF is not present locally
  and was not fetched again for this change. The replay is not a new live
  parser validation.
- Without a published discipline code or another exact stable identifier, a
  renamed row, a repeated identical title whose semester changes, or a source
  layout that loses its exact plan link remains a review gap by design.
- Exact title equality is evidence only within one exact plan and is never
  extended by fuzzy matching. A reviewer must decide uncertain identity.
