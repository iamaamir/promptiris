# T003-02 — Atomic Patch engine

Status: complete

## Outcome

Apply typed operations atomically to an immutable transformation state while enforcing revisions, preconditions, exact protections, grapheme-safe selectors, stable block identities, and namespace ownership.

## Acceptance

- Failed operations never expose partial state.
- Accepted operations increment the revision exactly once per Patch.
- Stale Patch/selector revisions and mismatched exact quotes fail deterministically.
- Text operations cannot split extended grapheme clusters or overlap protections.
- Non-overlapping edits rebase protections and retain exact protected text.
- Property tests cover atomicity and rebase invariants with fixed replay seeds.

## Evidence

Example and fixed-seed property tests cover atomic rollback, revisions, Unicode scalars, grapheme boundaries, exact quotes, protections, rebasing, stable blocks, preconditions, conflicts, and namespace ownership.
