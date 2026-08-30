# Complete paranoid TypeScript boundary migration

Status: ready-for-agent
GitHub issue: <https://github.com/iamaamir/promptiris/issues/33>
Branch: `paranoid-types`
Parent: .scratch/verification-strategies/PRD.md
Blocked by: none
Parallel-safe: no; touches configuration validation boundaries across core and runtime-node
Patch policy: 1
Golden changes: denied
Test deletion: denied
Allowed paths:

- `tsconfig.base.json`
- `packages/core/src/configuration-*.ts`
- `apps/runtime-node/src/configuration.ts`
- `packages/core/src/*.test.ts`
- `apps/runtime-node/src/configuration.test.ts`
- `.scratch/verification-strategies/issues/04-paranoid-types.md`
- `.scratch/verification-strategies/issues/04-paranoid-types.evidence/**`

## Acceptance

- `noPropertyAccessFromIndexSignature` is enabled repository-wide.
- Unknown configuration records use explicit bracket access until runtime validation narrows them.
- Typecheck, configuration properties, mutation, and the full gauntlet pass without assertions or suppressions.
- Public type behavior remains unchanged or receives an explicit compatibility decision.
