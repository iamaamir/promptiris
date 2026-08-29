# Default Enhance Recipe

Status: ready-for-agent

GitHub issue: <https://github.com/iamaamir/promptiris/issues/10>
Branch: `default-enhance`
Parent: ROADMAP.md
Blocked by: .scratch/provider-path/issues/01-provider-contract.md, .scratch/provider-path/issues/02-openai-compatible.md
Blocks: .scratch/enhance-path/issues/02-guard-renderer.md, .scratch/enhance-path/issues/03-evaluation-harness.md
Parallel-safe: no; owns the bundled neutral strategy, decoder fallbacks, and Recipe fixtures

## Outcome

Produce a model-neutral enhancement by default, with target-specific adaptation remaining an optional Plugin.

## Acceptance

- A versioned one-call strategy asks the Provider to infer mixed or open-ended instruction needs rather than hard-coding an exhaustive taxonomy.
- Capability-adaptive decoding accepts schema output when evidenced and robust text fallback otherwise.
- Output is a typed Artifact/Patch proposal and cannot bypass protected spans or Host acceptance.
- Empty, malformed, refused, timed-out, cancelled, or failed transformation returns the original input with diagnostics.
- Golden behavior fixtures test simple, mixed, already-good, adversarial, and ambiguous inputs without tuning against the held-out corpus.
- Mutation, Reviewer, Hardener, source-blind QA, and full verification pass.

## Non-goals

Target-specific prompt syntax, memory, multi-call planning, or Provider selection policy.
