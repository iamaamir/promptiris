# T003-04 — Independent hardener and QA acceptance

Status: complete

## Outcome

Attack the completed transformation slice through deterministic gates and public-path scenarios, then preserve concise revision-bound evidence.

## Acceptance

- Candidate verification passes before the full Hardener profile.
- Mutation remains at least 90% overall and for governed targets.
- Coverage, CRAP, Knip, API compatibility, race, secret, schema, structural, LSP, and integration gates pass.
- Negative QA covers stale, malformed, Unicode, protected, partial-application, and namespace-confusion inputs without importing internals.
- Completion documentation carries exact evidence references and remaining risks.

## Evidence

Candidate verification passed 15 gates. The full Hardener passed every gate with trace prefix `20260828T095506`. Core coverage is 99.06% statements and 98.03% branches; CRAP has zero violations. Mutation is 94.28% aggregate, 92.82% for transformation state, and 91.86% for plugin execution.
