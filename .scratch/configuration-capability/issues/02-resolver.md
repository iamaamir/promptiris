# T004-02 — Deterministic resolver and evidence evaluation

Status: complete

## Outcome

Implement pure Kernel mechanics for parsing supplied JSONC text, schema-directed layered resolution, immutable sidecar provenance, policy constraints, Secret Reference validation, and capability evidence evaluation.

## Boundaries

- Own new focused modules and tests under `packages/core`.
- Accept JSONC text plus source metadata; filesystem reading belongs to the runtime boundary. Do not search files, read environment values, resolve credentials, access the network, activate Plugins, or implement a Provider.
- Return stable typed outcomes; never throw secret-bearing raw errors across the public boundary.

## Acceptance

- Precedence and schema merge semantics are deterministic and fully traced.
- Duplicate/unknown keys, invalid nulls, literal secrets, and invalid policies are rejected atomically.
- Resolved values and trace structures are deeply frozen and do not alias caller input.
- JSON Pointer escaping and union ordering are deterministic.
- Restrictions outrank weaker positive capability evidence for the same binding; conflicting same-strength positives fail deterministically; required, preferred, and optional requirements produce their declared outcomes.
- Policy records cover allowed, forced, clamped, and denied decisions separately from ordinary precedence.
- Property and adversarial example tests pass.
