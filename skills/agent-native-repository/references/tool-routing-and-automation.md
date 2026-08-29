# Tool routing and automation

## Semantic capabilities

Expose a curated capability set instead of a large utility prompt. Each provider should declare identity/version, applicability, effects, permissions, platform support, cost/context class, output schema, cache key, invalidation, and fallback.

Typical mappings:

| Need                   | Capability/provider examples                      |
| ---------------------- | ------------------------------------------------- |
| Literal search         | textual search with `rg`                          |
| Syntax relationships   | structural search with ast-grep                   |
| Definitions/references | pinned language server                            |
| Cross-function flow    | CodeQL or equivalent analyzer                     |
| Structured data        | `jq`, `yq`, schema tools                          |
| Validation             | compiler, tests, lint, secret scanner             |
| Output reduction       | structured reporters with retained raw logs       |
| Measurement            | Hyperfine, runtime timers, token/output telemetry |
| Event observation      | Watchexec or native filesystem APIs               |

The compiler remains authoritative over LSP diagnostics. Filesystem snapshots remain authoritative over watcher hints. Statistical benchmarks are evidence with variance, not deterministic facts.

## Tool traces

Record operational traces, not private reasoning. Include:

- task/run/revision;
- provider and underlying tools;
- timing and exit status;
- raw and model-visible output bytes;
- raw evidence reference and digest;
- redaction and sensitivity;
- cache/freshness state;
- normalized failure fingerprint.

Keep successful model-visible output compact. Expand referenced raw evidence only when needed.

## Harness events

Known events should trigger deterministic tasks without waking a model:

```text
source.changed
  -> snapshot
  -> resolve affected closure
  -> invalidate stale evidence
  -> execute affected tasks
  -> emit terminal result
  -> wake reasoning only for novel semantic failure
```

Require task/revision identity, idempotency, sequencing, debounce/coalescing, budgets, cancellation, and supersession.

## Execution lifecycle

Treat the harness as a resource-owning runtime, not a collection of commands:

- compose caller cancellation, deadlines, and supersession under one task-lifetime owner;
- publish exactly one terminal outcome and ignore late worker or tool completion;
- expose event consumption through bounded queues or streams so slow observers cannot block verification;
- drop replaceable progress before detaching a consumer that cannot accept critical state;
- dispose subprocesses, timers, filesystem watchers, listeners, subscriptions, and temporary resources on success, failure, cancellation, and early return;
- transfer stable failures as structured data while retaining exception causes and raw stderr only in bounded, referenced debug evidence; and
- carry only operational correlation through ambient execution context—never task content, credentials, acceptance state, or other correctness-critical inputs.

Lazy-load an adapter only after routing selects it and policy authorizes its exact local identity. Discovery must not execute code, and a dynamic import is not an authorization mechanism.

## Automation promotion

Mine repeated normalized actions across independent tasks. A useful candidate includes observation count, trace references, runtime/context/model cost, failure rate, proposed contract, effects, and expected savings.

Promotion lifecycle:

```text
observed -> candidate -> specified -> implemented -> cleaned
-> hardened -> source-blind exercised -> verified -> registered
-> measured -> retained, revised, or retired
```

Repetition may indicate a missing automation, a bad abstraction, poor task decomposition, or a flaky workflow. Review the cause before preserving the sequence.

Metrics inform decisions but never waive quality. Prefer total model cost per verified accepted task, evidence reuse, avoided wakeups, output reduction, failed iterations, duplicate work, first-pass acceptance, rework, and escaped defects.
