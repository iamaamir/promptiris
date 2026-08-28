# T003-01 — Portable transformation contract

Status: complete

## Outcome

Expand the public Prompt Document contract and add strict, portable types and schemas for selectors, protections, Patches, Resource References, constraints, extensions, Artifacts, and invocation results.

## Acceptance

- Schemas remain inside the constrained Draft 2020-12 profile.
- Unknown fields and unknown Patch operations fail validation.
- Namespaced fields have deterministic ownership syntax.
- Existing string shorthand and identity input remain compatible.
- TypeScript and Go can consume the same fixture shapes.

## Evidence

Strict TypeScript validators, canonical JSON Schemas, generated Go schema copies, API reports, protocol unit tests, and shared transformation fixtures pass candidate verification.
