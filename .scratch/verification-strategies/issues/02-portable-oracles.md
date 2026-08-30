# Expand differential and metamorphic oracles

Status: ready-for-agent
GitHub issue: <https://github.com/iamaamir/promptiris/issues/31>
Branch: `portable-oracles`
Parent: .scratch/verification-strategies/PRD.md
Blocked by: none
Parallel-safe: yes; owns shared cross-implementation conformance generators and immutable outputs
Patch policy: 1
Golden changes: denied
Test deletion: denied
Allowed paths:

- `packages/protocol/**`
- `packages/core/**`
- `apps/cli-go/**`
- `spec/fixtures/**`
- `tooling/quality/**`
- `.scratch/verification-strategies/issues/02-portable-oracles.md`
- `.scratch/verification-strategies/issues/02-portable-oracles.evidence/**`

## Acceptance

- Old/new and TypeScript/Go implementations run against identical generated inputs and normalization.
- Metamorphic relations cover round trips, stable normalization, and semantics-preserving transformations.
- Disagreements preserve replay coordinates and minimized fixtures.
- Existing goldens cannot be updated unless a separate base Work Item authorizes behavior change.
