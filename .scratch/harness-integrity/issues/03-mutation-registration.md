# Constrain mutation-target registration

Status: in-progress
GitHub issue: <https://github.com/iamaamir/promptiris/issues/39>
Branch: `mutation-register`
Parent: .scratch/harness-integrity/PRD.md
Blocked by: none
Parallel-safe: no; changes trusted mutation-governance policy
Patch policy: 1
Golden changes: denied
Test deletion: denied
Allowed paths:

- `.scratch/harness-integrity/**`
- `docs/development/**`
- `scripts/register-mutation-target.mjs`
- `scripts/quality-integrity.mjs`
- `stryker.config.mjs`
- `tooling/quality/**`
- `tooling/quality/mutation-policy.json`

## Goal

Make adding a production TypeScript mutation target a constrained deterministic operation, while keeping every mutation-policy weakening and unrelated Stryker configuration edit protected.

## Acceptance

- A command registers exactly one eligible production TypeScript file in `stryker.config.mjs` and `tooling/quality/mutation-policy.json`.
- Registration is idempotent and rejects non-production paths, missing files, duplicate entries, and unsafe policy values.
- The trusted integrity verifier allows only an additive registration shape: one new target, at least 90% minimum score, no ignored mutants, and unchanged aggregate policy.
- Target removal, floor reduction, ceiling increase, arbitrary Stryker configuration edits, and policy suppressions remain blocked.
- Tests cover successful registration and every rejected shape.
- Documentation tells agents to use the command rather than hand-editing protected mutation configuration.
