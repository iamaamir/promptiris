# EventDispatcher concurrency tests

Status: ready-for-agent

Branch: `concurrency-tests`

GitHub issue: pending

## Outcome

Add scheduler-based concurrency tests and mutation-killing edge-case tests for the EventDispatcher.

## Acceptance

- fc.scheduler() tests explore Promise interleaving across multiple observers
- fc.commands() model-based tests exercise subscribe/emit/complete/dispose sequences
- Mutation testing on event-dispatcher.ts passes the 90% threshold
- All existing tests continue to pass
- No production code changes

## Evidence

Concurrency test file, mutation-killing edge-case tests, and testing techniques audit doc pass candidate verification.
