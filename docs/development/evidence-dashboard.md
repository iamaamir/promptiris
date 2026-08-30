# Repository evidence dashboard

The local evidence dashboard answers recurring development questions from repository artifacts rather than conversation memory. It reports verification cost, output reduction, tool utilization, mutation strength, TypeScript and Go coverage, CRAP, context-command latency, repeated execution patterns, and measurement gaps.

Start it from the repository root:

```sh
pnpm dashboard
```

Then open `http://127.0.0.1:4173`. Set `PROMPTIRIS_DASHBOARD_PORT` to use another port. The server binds only to the loopback interface, accepts read-only requests, applies a restrictive Content Security Policy, and does not load third-party assets.

Generate the underlying aggregate without starting a server:

```sh
pnpm telemetry:analyze
```

The report is written to the shared repository `.agent/reports/telemetry-summary.json`. `scripts/agent-context` reads a compact subset when the report exists, regardless of which linked worktree invokes it.

## Measurement boundary

Schema-v2 and schema-v3 Tool Traces distinguish four layers. Version 3 is current and adds mandatory
dirty-worktree binding while version 2 remains readable historical evidence. New version 3 writers
also record deterministic redaction mode/count; the field remains optional so traces written during
the version 3 rollout remain valid:

- `taskId` is the canonical automation or verification task;
- `providerId` is the repository Verifier or Tool Adapter;
- `tools` names the underlying deterministic executables;
- `executor` is the outer process that launched the work, such as `pnpm`.

Each new trace also carries repository, worktree, branch, candidate revision, and agent identity. `scripts/tool-trace` resolves the shared repository from Git's common directory, so concurrent worktrees append collision-resistant trace files to one local evidence store. The analyzer also discovers legacy per-worktree stores and deduplicates by `traceId`.

Every verification run shares a `runId`. The trace stores exact raw-output and model-visible byte counts plus the raw Evidence reference and digest. Token values use `ceil(UTF-8 bytes / 4)` and are always labeled estimates; they are useful for trend and magnitude comparisons, not billing or tokenizer-exact accounting.

Operational aggregates accept schema-v2 and schema-v3 Tool Traces. Unsupported historical formats remain outside current utilization, cost, and output-reduction decisions; Git history is the archive when their provenance is needed.

Only commands executed through `scripts/tool-trace` are observed. Interactive shell calls, editor actions, private reasoning, user prompts, and model calls are not intercepted. Agents set `PROMPTIRIS_AGENT_ID` or claim a Work Item so traces are attributed; missing identity remains visible rather than guessed. The provider inventory still lists every registered provider and distinguishes active, unobserved, and CI-only states. An unobserved capability means the harness did not record it, not that nobody used the executable.

CI remains local-first: the repository does not upload raw logs or traces automatically. When a CI system supplies a downloaded directory of schema-v2 traces, import it explicitly with `./scripts/import-ci-evidence TRACE_DIRECTORY LABEL`. Imports are copied into the shared ignored `.agent/imports/` store, schema validated with other traces, and never become Git history.

## Quality interpretation

- Mutation score excludes explicitly ignored and compile-error mutants from the assessed denominator and retains the full status distribution.
- Mutation debt is governed by `tooling/quality/mutation-policy.json`. The policy freezes aggregate and per-target score floors plus ignored, surviving, and uncovered ceilings. `pnpm quality:mutation` fails on regressions, ungoverned targets, or targets silently removed from the report. Improving a target should tighten the reviewed baseline; worsening it may not be normalized by updating the policy in the same change without explicit Hardener evidence.
- `pnpm quality:integrity` compares the Candidate with its merge base. It rejects increased mutation ceilings, reduced floors, removed targets, coverage below 90%, newly added suppressions/skipped tests, and changed production TypeScript not named by Stryker.
- The dashboard reports per-target mutation debt, baseline deltas, and debt age. Aggregate mutation health never hides a weaker target.
- TypeScript coverage combines only canonical workspace Istanbul reports and shows statements, functions, and branches separately in the API. `pnpm test:coverage` removes prior coverage and derived CRAP evidence before collecting a new revision-bound set.
- Go coverage is measured independently. The first recorded baseline is below the 80% target and remains a visible gap until CLI behavior tests close it.
- CRAP reports its maximum function and every threshold violation. Protocol and core use a threshold of 15; other TypeScript uses 30.
- Context-command benchmarks are statistical measurements, not deterministic pass/fail facts.

No quality category compensates for another. A high mutation score cannot erase missing integration coverage, and a fast verifier cannot excuse a failed security check.

## Automation promotion

The dashboard groups repeated `taskId` and `providerId` pairs after three observations. These are review candidates, not self-installing automations. Promote a candidate only when its invocation, invalidation, failure fingerprint, and output reducer are stable; then register and verify the new script through the normal repository gauntlet.

The dashboard itself stays direct development infrastructure. It is not a Prompt Iris Plugin and does not make the repository tooling a plugin system.

## Local feedback and measurement

Use `pnpm watch:verify` for advisory, debounced candidate verification after source changes. Watchexec queues one superseding run when files change during verification; the verifier remains authoritative, not the filesystem event.

`pnpm test:watcher` performs one bounded source-change observation using Watchexec. Candidate verification records it when Watchexec is installed, which keeps event automation visible without leaving a background watcher running.

CodeQL runs the `security-and-quality` suite for JavaScript/TypeScript and Go on pull requests, `main`, and the weekly schedule. JavaScript/TypeScript also runs the versioned project query pack under `tooling/codeql/javascript`; its first invariant prevents Node process-launch APIs from bypassing the supervised native-plugin boundary. CodeQL remains CI-only because its database construction and analysis cost do not belong in the local candidate loop.

Use `pnpm benchmark:context` to refresh the Hyperfine report for `scripts/agent-context`. The benchmark is statistical evidence shown by the dashboard and is never a correctness gate.

Fast-check properties run inside the ordinary Vitest suite with fixed seeds. Failures retain their replay seed/path, while minimized counterexamples should be promoted into example-based regression tests.
