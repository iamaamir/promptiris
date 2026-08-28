# T004-01 — Portable configuration and capability contract

Status: complete

## Outcome

Add the smallest serializable public contracts for configuration provenance, Secret References, capability evidence, Permission Hints, inspection, and readiness without adding runtime behavior.

## Boundaries

- Own `packages/protocol` and manifest types/tests in `packages/plugin-sdk`.
- Preserve current public exports and identity behavior.
- Do not implement parsing, resolution, Provider calls, runtime dispatch, or CLI commands.

## Acceptance

- Every structure is JSON-serializable, immutable by contract, and uses Prompt Iris namespaced identifiers where applicable.
- `ConfigTrace` is pointer-indexed and separate from resolved values.
- Capability evidence is binding-scoped and represents supported, unsupported, and unknown explicitly.
- Capability requirements represent required, preferred, and optional use with a stable evaluation outcome and Diagnostic contract.
- Irreconcilable same-strength positive evidence has a deterministic failure representation.
- Permission Hints describe effects but grant no authority.
- Inspect and doctor request/results cannot contain resolved secret material.
- Focused tests and type checks pass.
