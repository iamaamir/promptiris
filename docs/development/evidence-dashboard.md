# Repository evidence dashboard

The local evidence dashboard answers recurring development questions from repository artifacts rather than conversation memory. It reports verification cost, output reduction, tool utilization, mutation strength, TypeScript and Go coverage, CRAP, context-command latency, repeated execution patterns, and measurement gaps.

Start it from the repository root:

```sh
pnpm dashboard
```

Then open `http://127.0.0.1:4173`. Set `META_PROMPT_DASHBOARD_PORT` to use another port. The server binds only to the loopback interface, accepts read-only requests, applies a restrictive Content Security Policy, and does not load third-party assets.

Generate the underlying aggregate without starting a server:

```sh
pnpm telemetry:analyze
```

The report is written to `.agent/reports/telemetry-summary.json`. `scripts/agent-context` reads a compact subset when the report exists.

## Measurement boundary

Schema-v2 Tool Traces distinguish four layers:

- `taskId` is the canonical automation or verification task;
- `providerId` is the repository Verifier or Tool Adapter;
- `tools` names the underlying deterministic executables;
- `executor` is the outer process that launched the work, such as `pnpm`.

Every verification run shares a `runId`. The trace stores exact raw-output and model-visible byte counts plus the raw Evidence reference and digest. Token values use `ceil(UTF-8 bytes / 4)` and are always labeled estimates; they are useful for trend and magnitude comparisons, not billing or tokenizer-exact accounting.

Historical schema-v1 traces remain readable. They lack provider, run, tool, and model-visible output identity, so the dashboard marks them legacy and excludes them from exact reduction totals.

Only commands executed through `scripts/tool-trace` are observed. Interactive shell calls, editor actions, private reasoning, user prompts, and model calls are not intercepted. An unobserved capability means the harness did not record it, not that nobody used the executable.

## Quality interpretation

- Mutation score excludes explicitly ignored and compile-error mutants from the assessed denominator and retains the full status distribution.
- Mutation debt is governed by `tooling/quality/mutation-policy.json`. The policy freezes aggregate and per-target score floors plus ignored, surviving, and uncovered ceilings. `pnpm quality:mutation` fails on regressions, ungoverned targets, or targets silently removed from the report. Improving a target should tighten the reviewed baseline; worsening it may not be normalized by updating the policy in the same change without explicit Hardener evidence.
- The dashboard reports per-target mutation debt, baseline deltas, and debt age. Aggregate mutation health never hides a weaker target.
- TypeScript coverage combines only canonical workspace Istanbul reports and shows statements, functions, and branches separately in the API. `pnpm test:coverage` removes prior coverage and derived CRAP evidence before collecting a new revision-bound set.
- Go coverage is measured independently. The first recorded baseline is below the 80% target and remains a visible gap until CLI behavior tests close it.
- CRAP reports its maximum function and every threshold violation. Protocol and core use a threshold of 15; other TypeScript uses 30.
- Context-command benchmarks are statistical measurements, not deterministic pass/fail facts.

No quality category compensates for another. A high mutation score cannot erase missing integration coverage, and a fast verifier cannot excuse a failed security check.

## Automation promotion

The dashboard groups repeated `taskId` and `providerId` pairs after three observations. These are review candidates, not self-installing automations. Promote a candidate only when its invocation, invalidation, failure fingerprint, and output reducer are stable; then register and verify the new script through the normal repository gauntlet.

The dashboard itself stays direct development infrastructure. It is not a Meta Prompt Plugin and does not make the repository tooling a plugin system.

## Local feedback and measurement

Use `pnpm watch:verify` for advisory, debounced candidate verification after source changes. Watchexec queues one superseding run when files change during verification; the verifier remains authoritative, not the filesystem event.

Use `pnpm benchmark:context` to refresh the Hyperfine report for `scripts/agent-context`. The benchmark is statistical evidence shown by the dashboard and is never a correctness gate.

Fast-check properties run inside the ordinary Vitest suite with fixed seeds. Failures retain their replay seed/path, while minimized counterexamples should be promoted into example-based regression tests.
