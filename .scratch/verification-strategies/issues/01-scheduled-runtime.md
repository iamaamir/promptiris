# Add deterministic scheduling for runtime concurrency

Status: in-progress
GitHub issue: <https://github.com/iamaamir/promptiris/issues/30>
Branch: `scheduled-runtime`
Parent: .scratch/verification-strategies/PRD.md
Blocked by: none
Parallel-safe: yes; owns injectable native-runtime concurrency fixtures and scheduler tests
Patch policy: 1
Golden changes: denied
Test deletion: denied
Allowed paths:

- `apps/runtime-node/src/native-plugin.ts`
- `apps/runtime-node/src/native-plugin.test.ts`
- `packages/testkit/**`
- `.scratch/verification-strategies/issues/01-scheduled-runtime.md`
- `.scratch/verification-strategies/issues/01-scheduled-runtime.evidence/**`

## Acceptance

- Native invocation transport or process creation is injectable without weakening process-boundary coverage.
- Fast-check scheduler tests replay duplicate invocation, abort, completion, and late-result interleavings.
- Failures report seed, path, scheduled sequence, and a minimized regression.
- Existing real-child-process integration tests remain intact.
