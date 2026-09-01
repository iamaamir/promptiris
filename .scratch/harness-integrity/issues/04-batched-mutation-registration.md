# Permit strict batched mutation-target registration

Status: in-progress
GitHub issue: <https://github.com/iamaamir/promptiris/issues/42>
Branch: `mutation-batch`
Parent: .scratch/harness-integrity/PRD.md
Blocked by: none
Blocks: .scratch/provider-path/issues/01-provider-contract.md
Parallel-safe: no; changes trusted mutation-governance policy
Patch policy: 1
Golden changes: denied
Test deletion: denied
Allowed paths:

- `.scratch/harness-integrity/**`
- `docs/development/code-quality-and-review.md`
- `scripts/quality-integrity.mjs`
- `tooling/quality/integrity-policy.mjs`
- `tooling/quality/integrity-policy.test.mjs`
- `tooling/quality/register-mutation-target.test.mjs`

## Goal

Allow a Candidate to register more than one newly changed production TypeScript mutation target, while retaining the same strict, additive, zero-debt guarantees for every target independently.

## Acceptance

- The trusted integrity verifier accepts one or more additive mutation targets only when every target is changed production TypeScript, adds a matching strict policy entry, and the resulting Stryker configuration differs solely by those target lines.
- Every new policy entry starts at a 90% minimum score with zero ignored, surviving, and uncovered mutants; the aggregate policy and all existing target policies remain unchanged.
- Target removal, an ungoverned changed source, arbitrary Stryker edits, policy weakening, a target/policy mismatch, and debt in any member of a batch remain rejected.
- Repeated calls to the existing registration command compose into a valid batch without adding special command modes.
- Deterministic tests cover successful multi-target registration and each rejection class.
- Documentation explains that repeated registration commands are valid for several new production modules, while hand-editing remains prohibited.

## Notes

The prior one-target-only shape was intentionally conservative but makes a legitimate cross-package vertical slice impossible to govern without either weakening a pre-existing 100% target or violating package ownership. This change generalizes the safe shape; it does not create any mutation-debt exception.
