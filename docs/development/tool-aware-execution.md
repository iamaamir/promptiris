# Tool-aware execution and automation promotion

This document specifies the deterministic execution substrate used by repository-development agents and orchestrators. It is not Prompt Iris runtime behavior. A **Prompt Iris Plugin** participates in a Run; a **Tool Adapter** wraps a development executable for the repository harness. Tool Adapters are extensible but are never called Plugins.

## Operating principle

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

“Measure everything” means operationally observable execution, Evidence strength, cost, and outcomes. It never authorizes collection of private model reasoning, secrets, or user content by default. Metrics are redacted, retained by declared policy, and interpreted alongside correctness rather than optimized as isolated targets.

## Execution planes

```text
Work Item, Harness Event, or model capability request
  -> Tool Router
  -> registered Automation Task or Tool Adapter
  -> raw artifact plus structured Evidence
  -> compact result/reference
  -> Automation Miner
  -> reviewed Automation Candidate
```

The deterministic controller bypasses model reasoning for known event-to-task mappings. When semantic reasoning is necessary, a model requests a capability and structured arguments; it does not need to remember executable names, flags, or output formats.

## Canonical development language

**Tool Capability** is a semantic operation such as textual search, structural search, secret detection, targeted testing, output reduction, benchmarking, or event observation.

**Tool Adapter** is a versioned deterministic wrapper that resolves one Tool Capability to a pinned executable invocation and normalizes its output. It owns argument construction, availability/version checks, process limits, raw-output retention, redaction, and structured results; it does not select policy or waive failure.

**Tool Router** resolves a capability request to fresh Evidence, an Automation Task, or the cheapest trusted applicable Tool Adapter according to repository policy.

**Automation Task** is a versioned, tested deterministic workflow composed from Tool Capabilities or other Automation Tasks. Humans, agents, watchers, and CI invoke the same task contract.

**Tool Trace** is an operational record of a routed execution: task/revision identity, capability, adapter/version, normalized invocation, input/configuration digests, effects, timing, exit status, cache use, output sizes, Evidence references, redaction, and failure fingerprint. It contains no private reasoning trace.

**Harness Event** is a schema-validated repository-development event that may invalidate Evidence or trigger an Automation Task. It is separate from Prompt Iris runtime Events.

**Automation Candidate** is a proposed deterministic workflow derived from repeated Tool Traces. It has no execution authority until implemented, tested, hardened, reviewed, and registered.

**Automation Miner** is the read-only analysis that identifies repeated actions, sequences, outputs, failures, and avoidable model wakeups from Tool Traces.

**Automation Promotion Loop** is the controlled lifecycle from observed repetition through candidate, verified implementation, explicit activation, measurement, revision, and retirement.

## Capability registry

The repository exposes a curated semantic capability set rather than copying a large executable catalog into every model context. A registry entry declares at least:

```yaml
id: structural_search
inputSchema: schemas/tooling/structural-search-input.json
outputSchema: schemas/tooling/findings.json
providers:
  - adapter: ast-grep
    version: pinned
    platforms: [linux, macos, windows]
    executionSemantics: deterministic
    effects: [filesystem-read]
    network: denied
    costClass: low
    modelContextClass: low
    cacheKey:
      - adapter-version
      - configuration-digest
      - input-digest
```

`deterministic: true` is not sufficiently precise. Entries distinguish execution semantics, measurement variance, event-delivery guarantees, side effects, replayability, cacheability, platform support, trust, permissions, and output sensitivity. For example, Hyperfine measurements are statistical, Watchexec filesystem delivery is advisory and may coalesce events, and RTK-style output reduction is reproducible but intentionally lossy.

Every semantic capability also has an execution role. `discovery` capabilities reduce or locate
context, `gate` capabilities can produce acceptance Evidence, and `orchestration` capabilities only
run workflows. A discovery result can select a check but cannot impersonate a passing gate. The
dashboard exposes this role alongside utilization so a human need not infer it from provider names
or source code.

The initial capability classes are intentionally small:

| Capability class            | Candidate implementations                                  | Boundary                                                                                  |
| --------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Text discovery              | `rg`, `fd`                                                 | Literal, regex, and path questions; not syntax relationships.                             |
| Structural retrieval/change | ast-grep, pinned LSP                                       | Tested syntax/symbol operations; rewrites require explicit effects and verification.      |
| Structured data             | `jq`, `yq`, schema tools                                   | Parse and transform data without model interpretation.                                    |
| Context reduction           | structured reporters, RTK where measured useful            | Sanitized output remains Evidence; reduction is never the canonical record.               |
| Deterministic validation    | compiler, tests, lint, Gitleaks, CodeQL and quality tools  | Exit status and structured findings drive policy.                                         |
| Event observation           | Watchexec or platform filesystem APIs                      | Accelerates local feedback; repository snapshots remain authoritative.                    |
| Workflow execution          | versioned repository scripts/tasks                         | One canonical task namespace; do not make multiple task runners competing authorities.    |
| Measurement                 | Hyperfine, language benchmarks, timers and token telemetry | Controlled comparison and raw samples; variable results are not mislabeled deterministic. |

Tool count is not a target. A Tool Adapter is admitted when it adds capability coverage or demonstrably improves correctness, total verified-task cost, output size, or portability enough to justify installation and maintenance.

Resolve a provider without executing it with `./scripts/tool-router CAPABILITY`. Execute a routed capability with `./scripts/tool-router CAPABILITY -- ARG...`; execution is captured as a Tool Trace and returns an Evidence reference instead of copying successful raw output into model context.

Repository instructions require agents to use this routed path, while the verifier supplies the enforcement boundary: mandatory gates execute through `scripts/tool-trace`, completion evidence is rejected when its candidate binding is stale, and unattributed/direct work remains a visible evidence gap. A repository cannot intercept arbitrary host-native calls without controlling the host shell, so it never claims complete capture.

## Routing policy

The controller applies this order:

```text
Is matching fresh Evidence already available?
  yes -> reuse it
  no  -> is a registered Automation Task applicable?
          yes -> execute it
          no  -> can a registered Tool Capability perform the work?
                  yes -> route to the cheapest trusted applicable adapter
                  no  -> can retrieval/indexing answer it?
                          yes -> retrieve progressively
                          no  -> request semantic reasoning or generation
```

Routing considers correctness/trust first, then applicability, permissions and effects, platform/availability, total cost, output volume, cacheability, and fallbacks. A model can propose a capability request, but it cannot select an unavailable or policy-forbidden adapter, fabricate Evidence, or reinterpret exit status.

Subagents receive only applicable capability and Automation Task contracts in their Orientation Packet. They do not receive the complete registry or executable manuals.

## Tool Trace and Evidence boundary

Every routed execution records a schema-validated Tool Trace similar to:

```json
{
  "schemaVersion": 2,
  "traceId": "20260827T120000-1234",
  "runId": "verify-20260827T120000Z-1200",
  "taskId": "verify.unit",
  "providerId": "test-runner",
  "tools": ["vitest", "go-test", "node-test"],
  "executor": "pnpm",
  "context": {
    "repositoryId": "0123456789abcdef",
    "worktreeId": "fedcba9876543210",
    "branch": "provider-contract",
    "candidateRevision": "83d21af...",
    "workspaceDigest": "sha256:...",
    "dirty": false,
    "agentId": "worker-15"
  },
  "durationMs": 1832,
  "exitCode": 0,
  "output": {
    "rawBytes": 1830042,
    "modelVisibleBytes": 204,
    "reducedBytes": 1829838,
    "estimatedTokensAvoided": 457459,
    "tokenEstimate": { "method": "utf8_bytes_divided_by_4", "version": 1 }
  },
  "evidence": {
    "ref": ".agent/logs/tool-20260827T120000-1234.log",
    "sha256": "..."
  }
}
```

Raw output is stored outside model context with access and retention policy; compact output always carries a reference and digest. The current local tracer intentionally omits invocation arguments because they may contain secrets and records exact byte counts for raw and displayed output. Token counts are deterministic byte-based estimates, not tokenizer-exact values. Richer adapters may add normalized invocations, input digests, cache identity, failure fingerprints, and redaction counts as their collection boundaries mature. Collection of source/user content or external telemetry is disabled by default and requires explicit authorization.

## Harness Events and interrupt-driven agents

The initial event catalog includes:

- `source.changed`;
- `candidate.updated`;
- `evidence.invalidated`;
- `verification.started`;
- `verification.completed`;
- `verification.failed`;
- `automation.suggested`; and
- `reasoning.required`.

Known events trigger deterministic task graphs without waking a model:

```text
source.changed
  -> snapshot exact revision/state
  -> resolve affected closure
  -> invalidate stale Evidence
  -> run applicable Automation Tasks
  -> emit terminal verification event
  -> wake reasoning only for an unhandled semantic failure
```

Events carry task/revision identity, sequence, correlation and causation, sensitivity, payload reference, and idempotency key. Debounce/coalescing, conflict-domain locks, execution budgets, cancellation, and revision supersession prevent watch loops, duplicate checks, and publication of results for obsolete Candidates. Filesystem notifications are hints; the fresh repository snapshot is authoritative.

## Automation Promotion Loop

The Automation Miner operates on Tool Traces rather than conversations or reasoning. It groups exact normalized invocations and mines repeated subsequences within Work Item/stage boundaries. It looks for:

- repeated commands or command sequences;
- recurring parsing/filtering after one tool;
- repeated reads of unchanged state;
- duplicate subagent work;
- repeated failure fingerprints and repair loops;
- recurring large-output reductions;
- repeated manual completion checks; and
- known capabilities that were bypassed by ad hoc shell or model work.

Its output is an Automation Candidate with observation count, independent tasks, sequence, runtime/context/model cost, failure rate, proposed contract, confidence, and trace references. Repetition is evidence of opportunity, not proof: it may reveal a broken workflow or architecture rather than a script worth preserving.

Promotion is explicit:

```text
observed
  -> candidate
  -> specified
  -> implemented
  -> cleaned
  -> hardened
  -> source-blind exercised
  -> deterministically verified
  -> registered
  -> measured
  -> retained, revised, or retired
```

Generated automation never installs or activates itself. An Automation Task declares input/output schemas, effects and permissions, idempotency, dependency/conflict domains, time/retry budgets, cache/invalidation, Harness Events/diagnostics, Evidence products, and tests. It returns structured results and references instead of requiring log interpretation.

## Measurement

The primary outcome remains tokens and total model cost per verified, accepted task. Supporting measures include:

- capability-router hit, fallback, and failure rates;
- Evidence/cache reuse and invalidation accuracy;
- raw versus model-visible output bytes and estimated tokens;
- runtime and resource cost by capability/adapter/task;
- model calls and agent wakeups avoided;
- repeated actions and duplicate work per accepted task;
- Automation Candidates accepted, rejected, reused, revised, and retired;
- automation construction/maintenance cost versus avoided repeated cost;
- time/tokens before first useful change;
- flake, blind-retry, repeated-failure, and stale-result suppression rates; and
- verification strength, accepted outcomes, rework, and escaped defects.

“Could have been deterministic” is reported only as an auditable router miss when a suitable registered capability or Automation Task existed, or after an explicitly reviewed classification. It is not guessed from every shell command. Metrics cannot waive quality gates and must be reviewed for gaming, collection bias, and privacy impact.

## Phase 2 tracer bullet

Build the smallest vertical slice around a real repository task: one registry format, textual and structural search adapters, one canonical affected-test Automation Task, revision-bound Tool Traces, raw/compact output references, and one event that invalidates and recomputes Evidence. Mine traces read-only and report Automation Candidates before automating even candidate generation; registration and activation always remain explicit. Add tools and capabilities only after this path is reproducible across local agents and CI.
