# Principles

## Prime directive

> **Reason with models.**\
> **Compute with tools.**\
> **Search structurally.**\
> **Store state externally.**\
> **Communicate through references.**\
> **Verify deterministically.**\
> **Retrieve progressively.**\
> **Delegate narrowly.**\
> **Automate repetition.**\
> **Measure everything.**

## Optimization order

1. Correctness
2. Verified changes
3. Minimal unnecessary context
4. Minimal unnecessary model calls
5. Minimal duplicated work
6. Reproducible state
7. Efficient delegation

The primary economic measure is total tokens and model cost per verified, accepted task. Stronger models may be cheaper when weaker models repeat failures. Cheap models are preferred for bounded generation when deterministic gates constrain acceptance.

## Authority

Generation is untrusted. Humans and models are Change Producers; neither self-certifies. Models own semantic reasoning and generation. Deterministic controllers own discovery, parsing, compilation, formatting, testing, exit-code interpretation, evidence freshness, budgets, cancellation, and merge eligibility.

Controllers also own lifecycle truth: one terminal outcome, cancellation and supersession precedence, bounded delivery, and deterministic cleanup. Optional observers and debug capture cannot delay or alter the task result.

## Repository memory

- Stable understanding: source, schemas, tests, domain docs, ADRs, security and compatibility policy.
- Mutable task state: objective, stage, base/candidate revisions, lease, last evidence, next action.
- Derived evidence: logs, reports, indexes, coverage, mutation, benchmarks, traces.
- Conversation: useful for reasoning, never authoritative state.

## Cost-aware routing

```text
fresh evidence
  -> registered automation
  -> deterministic capability
  -> cheap retrieval/indexing
  -> cheapest model likely to finish
  -> stronger reasoning after repeated novel failure
```

## Guardrails

- Prefer deltas over full state.
- Keep raw logs outside model context.
- Use structured outcomes and references instead of narratives.
- Stop substantially identical retry loops.
- Parallelize only independent work with isolated state.
- Adopt values and evidence boundaries, not ceremonial agent choreography.
- Evolve through observed, reviewed automation promotion—not autonomous script accumulation.
