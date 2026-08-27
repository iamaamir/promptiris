# T002-01 — Plugin contract and deterministic graph

Status: done

## Outcome

Expose the smallest public manifest, contribution, recipe-selection, and compiled-plan contracts needed by this tracer bullet. Compile selected contributions into one deterministic fixed-phase order and reject invalid graphs before activation.

## Boundaries

- Own only `packages/plugin-sdk`, graph-related `packages/core` modules, and their public tests.
- Preserve existing identity behavior.
- Do not implement discovery, installation, native processes, or model calls.
- Follow the public contracts in the feature PRD and canonical ADRs; report conflicts rather than silently redefining them.

## Acceptance

- Discovery order cannot change the compiled order.
- Missing dependencies, declared conflicts, cycles, and unknown/reversed phases are structured compile failures.
- Manifest inspection does not activate plugin implementations.
- The public SDK exports implementor-facing types without exposing kernel internals.

## Evidence

- Targeted tests: 7 passing across `plugin-sdk` and `core`.
- Independent low-cost hardener review: pass, no remaining actionable findings.
- Tool traces: `.agent/traces/20260827T100450-11175.json` and the subsequent candidate run.
