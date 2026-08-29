# Reduce CI hardener latency

Status: ready-for-agent

GitHub issue: <https://github.com/iamaamir/promptiris/issues/23>
Branch: `faster-hardener`
Parent: ROADMAP.md
Blocked by: none
Blocks: none
Parallel-safe: no; owns hardener workflow, affected-input policy, mutation configuration, caches, and performance telemetry

## Outcome

Shorten protected-branch hardener feedback without skipping relevant failure models or weakening the 90% per-target mutation floor.

## Baseline

- PR #22 hardener runs took 12m16s and 12m56s; both spent nearly all remaining time in `pnpm test:mutation` after faster gates passed.
- The same full verifier completed mutation locally in roughly 16 seconds with warm workspace state, indicating that CI setup, cold execution, or repeated unaffected work deserves measurement.

## Acceptance

- Record machine-readable cold-CI step and mutation-target timing for representative successful runs, with raw evidence retained by reference.
- Prove the bottleneck before changing orchestration; compare affected-target selection, content-addressed evidence reuse, cache restoration, safe sharding, and Stryker execution settings.
- Do not run mutation for a documentation/tooling-only delta when all governed mutation inputs—including source, tests, configuration, dependencies, runtime, and policy—have an unchanged trusted fingerprint.
- Fail closed to the full hardener when applicability or evidence freshness is uncertain, and make the reuse/skip reason visible in CI and dashboard telemetry.
- Preserve the 90% minimum for every governed target, aggregate policy, coverage and CRAP floors, CodeQL/security, public API, dead-code, race, and source-blind QA responsibilities.
- Demonstrate that a relevant source/test/configuration change invalidates reuse and that a deliberate surviving mutant still fails the gate.
- Report before/after median and tail latency, compute time, cache hit rate, and evidence size using comparable runs.
- Independent Reviewer and Hardener report no unresolved blocker/high finding, and candidate/full verification pass.

## Non-goals

Lowering thresholds, deleting slow tests without equivalent coverage, trusting branch names or timestamps as cache keys, or making CI success depend on an LLM judgment.
