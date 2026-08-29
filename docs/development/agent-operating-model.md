# Agent-driven implementation operating model

This document governs implementation work produced by humans, weak or strong models, and parallel agent systems. It is repository-development policy, not Prompt Iris runtime behavior. The implementation is expected to evolve; the authority and evidence boundaries below do not depend on a particular agent host. Capability routing, Tool Traces, Harness Events, and automation promotion are specified in [tool-aware execution](./tool-aware-execution.md).

## Objective and priorities

The unit of optimization is a **verified, accepted task**. Do not minimize tokens per individual call at the expense of more retries, duplicated work, weaker verification, or rejected changes.

Agents and orchestration optimize in this order:

1. correctness;
2. verified changes;
3. minimal unnecessary context;
4. minimal unnecessary model calls;
5. minimal duplicated work;
6. reproducible state; and
7. efficient delegation.

Higher items dominate lower items. Saving model cost never justifies weakening a gate.

The prime directive is:

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

Measurement covers operational execution, Evidence, cost, and outcomes. It does not collect private model reasoning, secrets, or user content by default.

## Canonical development language

**Change Producer** is a human or model that proposes a repository change. Producer identity grants no trust.

**Work Item** is one bounded, independently trackable objective with acceptance criteria, dependency/conflict declarations, base revision, and quality profile.

**Candidate Change** is a proposed commit or exact working-tree snapshot for one Work Item. It is not complete merely because its producer reports success.

**Gauntlet** is the mandatory set of independent quality stages and deterministic gates a Candidate Change must pass.

**Evidence** is a structured, inspectable result tied to exact inputs, tool/configuration versions, and an output digest. Conversation is not Evidence.

**Orientation Packet** is a stage-specific compiled view of current local repository state. It contains the minimum sufficient context plus references for deterministic expansion.

**Conflict Domain** is a protocol, schema, public API, package boundary, or other protected surface whose concurrent independent redesign would create semantic integration risk.

## Authority boundary

Generation is untrusted; acceptance is deterministic. No Change Producer, including a maintainer or strong model, may self-certify. Review can add semantic requirements but cannot override a failed invariant.

Models are reasoning and generation engines. The deterministic control plane owns discovery, parsing, compilation, formatting, test execution, exit-code interpretation, retries, budgets, cancellation, evidence freshness, and merge eligibility.

Use this decision hierarchy:

```text
Does matching fresh Evidence already exist?
  yes -> reuse it
  no  -> is a registered Automation Task applicable?
          yes -> execute it
          no  -> can a registered Tool Capability perform it?
                  yes -> route to the cheapest trusted applicable adapter
                  no  -> can cheap retrieval or indexing answer it?
                          yes -> retrieve progressively
                          no  -> use the cheapest model likely to finish the semantic work
```

A stronger model is preferred when repeated failures would make a weaker model more expensive overall. Architecture, complex debugging, and cross-system review normally require stronger reasoning than routine bounded generation.

## Instruction and state layers

The root `AGENTS.md` is a tiny always-loaded constitution. Detailed conditional policy belongs here or in machine-readable policy files and is retrieved only when applicable. Long steering documents must not be copied into every model context.

Stable product/domain understanding lives in source, schemas, tests, `CONTEXT.md`, current design documents, and ADRs. Durable decisions use `docs/decisions.md` and ADRs rather than a second agent-specific decision log.

Mutable execution state is task-scoped, not one global `.agent/state.json`, so parallel Work Items cannot overwrite one another. The expected derived layout is:

```text
.agent/
  work/<work-item>/state.json
  evidence/
  reports/
  logs/
  indexes/
```

This material is local, content-addressed, or retained as CI artifacts according to policy. Sensitive logs are never committed accidentally. Conversation history is not authoritative state.

## Context compiler

`scripts/agent-context` is a tiny local compiler driver. It compiles an Orientation Packet from current state; it is not static onboarding text and does not assume a clean checkout.

```text
Invocation
  -> snapshot
  -> index/parse
  -> resolve
  -> analyze
  -> optimize
  -> validate
  -> emit
```

### Inputs and intermediate representation

The snapshot includes the exact base/candidate revisions, staged/unstaged/untracked changes, Work Item, stage, lease, tool versions, and existing indexes/Evidence. Providers may inspect Git, package/compiler graphs, ASTs, LSP symbols/references/diagnostics, CodeQL databases, documentation links, tests, mutation results, fuzz corpora, and prior reports.

Providers build a provenance-bearing Context Graph connecting the Work Item to affected symbols/files, public contracts, decisions, dependencies, tests, findings, and Evidence. Repository state is the source language, the Context Graph is the intermediate representation, and the Orientation Packet is the compiled target.

### Optimization and progressive disclosure

The compiler deduplicates facts, prefers deltas, reuses fresh Evidence, collapses successful logs to summaries, ranks changed/public surfaces, and emits three layers:

1. mandatory constraints and failures;
2. relevant working context; and
3. indexed references available for deterministic expansion.

It never drops mandatory evidence merely to hit a token target. Large output stays in files; the packet carries digests and references.

### Stage profiles

- Implementer: objective, acceptance, affected public contracts, relevant symbols/files/tests, and constraints.
- Cleaner: Candidate Change, CRAP/complexity data, architecture graph, structural findings, and accepted behavior.
- Hardener: changed behavior, existing tests, mutation survivors, uncovered branches, fuzz/property targets, and failure-injection surfaces.
- QA: runnable artifact, public documentation/interfaces, and black-box acceptance procedures; source and implementer rationale are excluded.
- Verifier: Evidence graph, fingerprints, and invalidated or missing checks; no prose code review.

The compiler never calls a model, invents missing facts, or changes authoritative source, tests, Work Items, or decisions. It may create or refresh derived indexes, caches, and compiled packets. Missing or stale required providers produce an explicit incomplete result and next action.

## Mandatory change gauntlet

Every Candidate Change passes independent responsibilities:

```text
small Work Item
  -> Specifier
  -> Implementer
  -> Reviewer
  -> Cleaner
  -> Hardener
  -> source-blind QA
  -> deterministic verifier
  -> integration queue
```

The macro stages and their exit criteria are mandatory. A producer's private implementation sequence is not prescribed when the resulting values can be verified: a human may use strict TDD while a model may implement a small unit and then add its test.

These names describe independent responsibilities and evidence boundaries, not a mandatory number of agents or model calls. One worker may perform several responsibilities for a small change when deterministic gates preserve separation; high-risk changes may assign distinct workers. No role is spawned merely to satisfy choreography, and no role repeats exploration or mechanical work already captured by repository Evidence.

### Specifier

Turns one small intent into observable acceptance criteria, normal/failure scenarios, public-interface expectations, and a black-box QA procedure. It does not write a large file-by-file implementation plan.

### Implementer

Produces the smallest working Candidate Change and focused tests. It runs the fast applicable baseline but does not self-approve.

### Reviewer

Treats the Candidate as untrusted and reviews the task contract, diff, affected dependency neighborhood, public behavior, failure paths, boundary validation, platform-primitive choices, compatibility, and security/redaction. It does not repeat mechanical checks already preserved as Evidence and does not review from the Implementer's narrative.

Every comment is resolved as accepted with a change/evidence reference or rejected with a concrete technical rationale. Findings carry severity, exact file/line, a reproducible observation, and the violated contract or invariant. High-risk protocol, Kernel, configuration, Provider, native-Plugin, and security changes require a Reviewer responsibility independent from the Implementer; a cheap model is acceptable, but unresolved blocker/high findings prevent completion regardless of model quality. The structured report follows `spec/schemas/reviewer-report.schema.json`.

The Reviewer checks whether a platform primitive expresses the semantics better; it never demands `Proxy`, generators, `Symbol`, or another feature merely to appear sophisticated. Missed use of `Set` for uniqueness/ownership, `Map` for non-JSON keyed state, or iterators for genuinely lazy traversal can be a finding. Unnecessary interception, hidden behavior, or exotic identity is also a finding. See [Code quality and review](./code-quality-and-review.md).

### Cleaner

Owns code structure: CRAP score, cyclomatic complexity, duplication, naming, dead code/dependencies, public API shape and growth, dependency direction/cycles, forbidden imports, suppressions, and unnecessary abstractions. TypeScript API reports, Go exported-API comparisons, and schema drift make public-surface changes explicit. Refactoring must preserve accepted behavior.

### Hardener

Assumes the implementation covers only examples its author imagined. It attacks test and behavior weaknesses through mutation testing, property/state-model testing, fuzzing, boundaries, malformed input, cancellation, concurrency, timeouts, process faults, resource limits, security/data-flow cases, performance budgets, and cross-language differential fixtures. Randomized failures carry replay coordinates, shrink to a minimal counterexample where supported, and enter a regression corpus.

No relevant surviving mutant is silent. Exclusions and equivalent-mutant classifications are explicit Evidence. Aggregate and per-target mutation debt is compared with the checked-in regression policy; new debt, unexplained ignored-mutant growth, and silent target removal fail deterministically. Improving evidence tightens the baseline instead of creating permanent headroom. Exact CRAP/mutation thresholds remain an implementation calibration decision; high-risk Kernel/protocol surfaces receive stricter profiles than presentation adapters, and the coverage floors in the tooling baseline remain minima.

### Orthogonal quality evidence

CRAP, coverage, and mutation answer different questions and cannot summarize quality. Every Quality Profile selects applicable evidence from ten independent classes: structure, test sensitivity, generated input/state space, cross-implementation behavior, public compatibility, runtime adversity, security/supply chain, performance/resources, evidence integrity, and source-blind product behavior. A result in one class never compensates for a missing or failed required class.

Checks use replaceable Verifier Adapters so the system can grow without hard-coding vendors. Tool and Verifier Adapters are not Prompt Iris Plugins and are never loaded through the runtime being verified. Each declares stable identity/version, applicability, inputs, output schema, cost class, cache/invalidation rules, sensitivity, and finding codes. The deterministic repository verifier owns profile selection, standard Harness Events/diagnostics, Evidence validation, and pass/fail policy; adapters cannot waive gates or approve integration.

### Source-blind QA

Operates through CLI, JSON-RPC, Plugin SDK examples, adapters, installation/configuration, and other public surfaces without source or implementer rationale. It explores like a human user. A QA observation becomes blocking only when reduced to a deterministic replay, fixture, assertion, or explicitly adjudicated finding.

### Final verifier

Reasons about nothing and edits nothing. It validates the Candidate revision, Evidence origins/freshness, mandatory checks, and protected policy. Branch/ruleset enforcement—not an agent's report—decides merge eligibility.

## Evidence reuse and non-duplication

Never recompute valid knowledge and never save work by weakening Evidence. Each check declares its inputs, transitive dependency closure, tool/configuration/environment versions, outputs, and invalidation rules. Reuse is allowed only when the complete evidence key still matches.

Work may repeat only when:

1. declared inputs changed and invalidated prior Evidence;
2. prior Evidence is missing or untrusted; or
3. the new execution tests a distinct failure model.

The reason is machine-recorded. Two agents performing the same unchanged review with the same mandate is waste; unit versus black-box testing or candidate versus combined integration behavior is independent evidence.

Candidate verification runs every applicable changed/affected check. Integration verification reuses unchanged Candidate Evidence and reruns only invalidated dependency closures and combined scenarios. Release verification deliberately reruns properties whose purpose includes clean-environment reproducibility or whole-bundle behavior.

## Parallel and agent-driven development

Agents work concurrently on isolated Candidate Changes, never a shared mutable working directory. Each Work Item owns a branch/worktree and exact base revision. An atomic `(work item, stage, candidate)` lease prevents duplicate assignment; replacement agents resume from artifacts.

Parallelize only ready Work Items with no unresolved dependency or overlapping Conflict Domain. Establish and integrate a protocol/schema/public contract first, then fan out dependent implementations. Git textual conflict detection is insufficient; integration conformance detects semantic conflict.

Every Candidate gets its own gauntlet. A merge queue or equivalent tests it against the latest target and changes ahead of it. Evidence is revision-bound and becomes stale after relevant rebases or production changes.

Agent-driven does not mean agent-governed. Agents may select ready work, implement, clean, harden, execute QA, and respond to deterministic failures. They may not weaken gates, approve their own exceptions, or merge around failures.

## Deterministic analysis passes

Analysis providers have a stable ID/version, declared inputs, output schema, cost class, cache key, invalidation rules, and sensitivity classification. The standalone development verifier must not depend on the Prompt Iris runtime it verifies.

- The Tool Router reuses fresh Evidence and routes semantic capabilities to registered Automation Tasks or the cheapest trusted applicable Tool Adapter; agents do not reconstruct commands from a large utility prompt.
- Tool Traces retain raw execution Evidence, compact model-visible results, costs, output sizes, redaction, failure fingerprints, and references without collecting private reasoning.
- Git and package/compiler graphs provide exact state, deltas, dependency closure, and affected checks.
- `rg`, structured parsers, JSON/YAML tools, formatters, compilers, linters, and test runners own mechanical operations.
- ast-grep owns syntax-aware policy and tested structural rewrites, such as forbidden internal imports, dispatcher bypass, unsafe suppression, or direct Provider calls outside their plane.
- pinned LSP implementations provide definitions, references, symbols, diagnostics, and impact neighborhoods; compiler checks remain authoritative.
- CodeQL owns deeper correctness/security and cross-function data-flow checks, such as secrets reaching Events, untrusted Plugin data reaching command execution, Provider output reaching Patch application without validation, or Debug Records reaching Results.
- API reports, exported-API differs, and schema/generator drift checks make public compatibility reviewable without pretending to prove behavioral compatibility.
- CRAP, coverage, mutation, property/state-model/fuzz, differential, race, fault/leak, dependency-vulnerability, and benchmark tools produce orthogonal Evidence rather than relying on a reviewer's impression.
- Every randomized failure records seed/replay coordinates and its minimized counterexample; retry-until-green is forbidden and release-protecting tests cannot be quarantined.

## Deterministic loops and escalation

Shell or a small deterministic controller owns tool loops; an LLM does not repeatedly decide whether the next mechanical step should run. Every loop has attempt/time/cost budgets and terminal success, failure, incomplete, and escalation paths.

Normalize failure fingerprints from check ID, diagnostic code, location/symbol, message/stack shape, and relevant input hash. When substantially identical failures repeat, stop blind repair, re-evaluate assumptions, expand deterministic context, and then route to stronger reasoning or a human if necessary.

Do not use subagents to list files, count/search occurrences, run tests/formatters, parse JSON, inspect exit codes, compare hashes, or perform other mechanical work. Delegation is narrow, depth-bounded, and reserved for independent semantic reasoning or generation. Parallel subagents receive distinct minimal packets rather than one duplicated context dump.

## Communication and completion contract

Subagents return results, not narratives. A response references an exact Candidate and tool-generated Evidence:

```json
{
  "status": "done",
  "workItem": "T003",
  "stage": "hardener",
  "baseRevision": "def456",
  "candidateRevision": "83d21af",
  "evidence": {
    "manifest": ".agent/evidence/T003-83d21af.json",
    "mutation": ".agent/reports/T003/mutation.json",
    "tests": ".agent/reports/T003/tests.json"
  },
  "findings": [],
  "risks": [],
  "nextAction": "source-blind-qa"
}
```

Files, source, logs, diffs, and reports already present in shared storage are referenced, not copied into responses. A structured result accompanies exit status so callers can distinguish failed, incomplete, stale, and policy-blocked outcomes without log parsing.

A completion report is compact: Work Item/outcome, changed surfaces, verification references/results, Candidate revision, and remaining risks. Completion is forbidden until required Evidence is valid.

## Efficiency measurement

The primary metric is model tokens and total model cost per verified, accepted task. Secondary measures include capability-router hits/misses/fallbacks, Evidence/cache reuse, agent/subagent calls and avoided wakeups, failed iterations, average/duplicate context, raw versus model-visible tool output, time/tokens before the first useful change, repeated sequences and Automation Candidate lifecycle, first-pass gauntlet acceptance, integration rework, escaped defects, mutation/test strength, flake/retry/stale-result rate, and performance/resource regression.

Metrics never stand alone: tiny task slicing, weak acceptance, or hidden rework must not make an unsafe workflow appear efficient.

## Decisions still requiring implementation evidence

- Exact CRAP limits and package-specific mutation/test-strength thresholds; accepted coverage floors remain the starting minima.
- Fast, candidate, integration, scheduled, and release Quality Profile budgets, including benchmark variance/regression and fuzz/soak durations.
- Concrete TypeScript and Go tools for API drift, dead-code/dependency hygiene, mutation, property/state-model tests, vulnerability reachability, and performance comparison after tracer-bullet trials.
- Failure-fingerprint similarity and retry/escalation budgets.
- Context Graph/Orientation Packet, Tool Capability Registry, Tool Trace, Harness Event, Automation Task, and Automation Candidate schemas plus provider invalidation algorithms.
- Curated initial capability/adapter set, routing cost/fallback policy, and cross-platform availability.
- Automation Miner sequence representation, opportunity thresholds, promotion economics, and retirement policy.
- Tool Trace/measurement redaction, retention, token estimation, storage, and privacy budgets.
- Work Item/lease storage and host adapters.
- Whether a Hardener may directly edit production code or must return findings to the Implementer.
- Concrete retention, redaction, and garbage-collection rules for `.agent/` artifacts.
