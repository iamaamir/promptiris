# T004-04 — Independent hardener and source-blind QA

Status: complete

## Outcome

Review the integrated slice independently, attack public inputs and failure paths, remove accidental complexity, and preserve revision-bound deterministic evidence.

## Acceptance

- Reviewer checks contract fidelity, boundary ownership, compatibility, redaction, and deterministic behavior.
- Cleaner removes duplication and incidental abstraction without weakening behavior.
- Hardener exercises mutation for changed governed targets plus coverage, CRAP, property testing, dead code, public API, CodeQL policy, secrets, race, and integration gates. Provider/release-only checks remain deferred.
- Source-blind QA uses only built artifacts and documented CLI/protocol surfaces.
- Completion evidence records exact commands/references, remaining risks, and no unsupported claims.

## Completion evidence

- Full verification passed all 21 local gates, including coverage, CRAP, dead-code analysis, public API, secrets, race detection, LSP, structural policy, watcher observation, and mutation.
- Mutation assesses 1,417 mutants at 93.44%; every governed target is above 90%. The six new implementation targets range from 90.48% to 94.05%.
- A low-cost independent reviewer found two blocking contract defects: capability failures were hidden from `inspect`, and nullable container schemas rejected `null`. Both were fixed and regression-tested before completion.
- Source-blind CLI QA covers valid `inspect`/`doctor`, logical-secret non-resolution, missing and conflicting capability outcomes, not-ready diagnostics, invalid JSONC, duplicate keys, unknown keys, literal secrets, non-zero failures, empty failure stdout, and secret-safe stderr.
- Runtime tests use a failing `fetch` sentinel to prove that local inspection does not call the network. Provider connectivity, authentication, model listing, and CI-only CodeQL execution remain explicitly deferred to their declared environments; the local CodeQL policy test is green.
