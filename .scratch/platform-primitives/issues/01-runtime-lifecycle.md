# Runtime lifecycle and loading

Status: ready-for-human

GitHub issue: https://github.com/iamaamir/promptiris/issues/2
Branch: `platform-primitives`
Blocked by: none; GitHub PR #1 merged as `a0190b9`
Blocks: none
Parallel-safe: no; owns shared Kernel execution, runtime server, SDK, mutation policy, and lifecycle documentation surfaces

## Outcome

Deliver the bounded Run-lifetime, Event-dispatch, Debug Record, execution-context, explicit-disposal, and authorized lazy-loading vertical slice described by the parent PRD.

## Owned surfaces

- `packages/core/src/run-lifetime.ts`
- `packages/core/src/event-dispatcher.ts`
- `packages/core/src/debug-record.ts`
- `packages/core/src/plugin-execution.ts`
- `packages/plugin-sdk/src/index.ts`
- `apps/runtime-node/src/execution-context.ts`
- `apps/runtime-node/src/lazy-plugin.ts`
- `apps/runtime-node/src/native-plugin.ts`
- Direct tests, API reports, mutation policy, architecture/development docs, and companion skill references

## Required gauntlet

1. Implementer produces focused behavior and boundary tests.
2. Reviewer checks lifecycle ownership, fail-open behavior, event ordering/backpressure, late outcomes, authorization order, and privacy boundaries.
3. Cleaner enforces repository complexity, public API, structural, and dead-code rules.
4. Hardener exercises race ordering, cancellation, reentrancy, observer failure, disposal failure, traversal/symlink escape, malformed modules, mutation, coverage, and CRAP.
5. Source-blind QA exercises the public runtime and Plugin registration surfaces without implementer rationale.
6. Deterministic candidate and full verification must pass before the PR is ready for external review.

## Completion report

- Candidate revision: `7a5d0ef` (`213b476` runtime implementation; `7a5d0ef` companion guidance)
- Changed surfaces: the files under `## Owned surfaces`, their focused tests and API reports, runtime lifecycle documentation, and the agent-native repository skill
- Verification: `pnpm verify:full` passed every full gate; source-blind built-artifact QA passed Event streaming, cancellation/disposal, execution-context propagation, and authorized lazy activation
- Independent review: pass with zero findings
- Mutation: 94.13% aggregate; all 18 governed targets passed, and every target scored at least 90%
- Residual risks: cancelled in-process Plugin promises require cooperative termination; Debug Record destinations remain Host-authorized policy; lazy-loading security depends on Host authorization; Event sink isolation and terminal ordering remain protocol invariants
- Publication: dependency satisfied; branch rebased onto `a0190b9` and ready for revision-bound verification and external review

GitHub discussion is a projection; this packet remains the durable task definition.
