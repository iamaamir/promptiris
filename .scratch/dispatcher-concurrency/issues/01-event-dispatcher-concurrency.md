# EventDispatcher concurrency tests from scratch

Status: in-progress

GitHub issue: <https://github.com/iamaamir/promptiris/issues/61>
Branch: `dispatcher-concurrency`
Parent: none
Blocked by: none
Blocks: none
Parallel-safe: yes; owns EventDispatcher concurrency tests and the testing-techniques audit
Patch policy: 1
Golden changes: denied
Test deletion: denied
Allowed paths:

- `packages/core/src/event-dispatcher.concurrency.test.ts`
- `docs/analysis/testing-techniques-audit.md`
- `.scratch/dispatcher-concurrency/**`

## Outcome

Replace PR #46 with a from-scratch suite that proves EventDispatcher behavior under
adversarial interleavings, plus an audit doc describing the post-merge testing landscape.

## Acceptance

- `packages/core/src/event-dispatcher.concurrency.test.ts` holds 8 tests:
  - Model-based command tests with a faithful oracle: the model tracks per-observer
    queues, waiting readers, control-event capacity consumption, detachment, and exact
    expected per-observer event sequences; real observer output is compared exactly.
  - A genuine `fc.scheduler()` test: competing dispatcher and reader operations wrapped
    in `scheduleFunction`, asserting monotonic sequences and terminal-last ordering
    across generated schedules.
  - Lagging-observer detachment: the healthy observer is drained fully and its exact
    type order asserted, including the detach notice and the terminal event.
  - Edge cases with distinct failure models (no duplicates of `event-dispatcher.test.ts`):
    concurrent reads rejection, sink-throw resilience, complete-with-pending-reads,
    dispose-during-emission, reentrant sink publication — each traversing the branch it names.
- Every test is Stryker TypeScript-checker safe (no `T | undefined` into matchers;
  indexed values established as defined first).
- A fresh mutation run demonstrates which event-dispatcher mutants the new tests kill;
  no line-number kill claims without report evidence.
- `docs/analysis/testing-techniques-audit.md` describes the post-merge state
  (scheduler-based concurrency testing in use by the new suite) with a correct matrix.
- `pnpm --filter @promptiris/core test`, typecheck, markdownlint, and shell lint pass;
  no production code, schema, threshold, or global lint suppression changes.

## Non-goals

Scheduler tests for NativePluginSupervisor/RunLifetime, Jazzer.js, Pact, TLA+,
reopening PR #46 (it will be superseded), touching `event-dispatcher.test.ts`.
