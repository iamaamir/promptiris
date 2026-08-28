# Session 001 checkpoint: foundation and boundaries

> Historical checkpoint: the branches described as next work below were subsequently resolved. Use the [implementation handoff](./implementation-handoff.md) for current status.

This checkpoint summarizes the first long-form design grill before implementation. It is a narrative index, not a verbatim transcript; the complete normative outcomes are enumerated in the [decision register](../decisions.md).

## Starting problem

Prompt quality can materially improve output from weaker or local models, but asking a separate high-end model to rewrite every prompt is frustrating and difficult to integrate. The initial idea was an SDK that could sit behind a CLI or before an agent Host sends user input to its model.

The scope widened deliberately: prompt enhancement should be one bundled function, while the framework allows any declared NLP transformation, guard, memory source, structured-output conversion, target adaptation, or observer. This led to the name Prompt Iris and the governing philosophy “everything is a plugin.”

## Boundary that emerged

The design settled on a strict microkernel. It owns mechanics that every safe composition needs, but no prompt-engineering policy. Behavior enters through explicitly activated Recipes and typed Plugin planes. This prevents an installed `enhance-with-memory` package from unexpectedly replacing `enhance`; it becomes a separate Recipe or an explicit overlay of the default.

The framework is bring-your-own-model and Host-neutral. OpenAI-compatible generation is bundled, while local or proprietary protocols can be Provider Plugins. A TypeScript/Node runtime remains canonical; a Go CLI exercises the cross-language protocol rather than duplicating the Kernel.

## Reliability and trust direction

Runs are stateless and Context is explicit. Optional transformations preserve and fall back to the original Input. Guards may block only when the composition or Host deliberately chooses fail-closed behavior. Deadlines and cancellation originate at the Host and propagate through the graph.

Third-party native Plugins are supervised out of process by default. This contains crashes and resources but is not described as a perfect sandbox. Permission declarations are hints and capabilities, not an RBAC system; the Host owns trust and enforcement.

## Extensibility direction

Plugins contribute immutable Artifacts and narrow Patches rather than mutating shared objects. A deterministic graph resolves dependencies and ordering. Read-only analysis can be parallel, while mutators remain serial. Recipes are shareable compositions; overlays change one immutable base through exact operations and compile into a flattened graph with provenance.

Manifests and schemas are available eagerly, while code, providers, credentials, and resources activate lazily. Plugin discovery initially uses npm/local installation and searchable package tags, with manifests and a lockfile providing the authoritative identity, compatibility, and integrity data.

## Host and developer experience direction

Host Adapters sit outside the transformation pipeline. They own input interception, Context, progress UI, confirmation, fallback, and submission according to real Host capabilities. V1 includes a Go CLI and official Pi adapter in the same monorepo; future Codex and OpenCode adapters remain thin integrations there.

The public TypeScript authoring surface centers on isolated Engine instances and `definePlugin`, with JSON Schema as the portable runtime authority. A test kit and development tools provide fake providers, an in-memory event collector, graph/config/Patch inspection, failure injection, trace views, and sanitized support bundles.

## Default enhancement direction

The agreed invariant is: **Produce a model-neutral enhancement by default, then optionally apply a target-specific adaptation plugin.** The model interprets unbounded mixed instructions; deterministic checks protect concrete invariants. Default enhance makes one model call, never blocks for clarifications, never silently invents requirements, and never submits partial output.

“Enhance” remains a candidate transformation. “Optimize” is reserved for a future Recipe that uses datasets, metrics, and evaluation. Release evaluation spans weak, strong, local, structured, JSON-only, and text-only models and combines deterministic, human, and model-based grading.

## Events and errors direction

A built-in dispatcher is mandatory so Plugins do not invent incompatible event channels. It validates a standard event catalog, correlation and causation IDs, ordering, sensitivity, backpressure, and subscriber isolation; namespaced custom Events require registered schemas.

Operational failures cross every SDK/process/language boundary as safe Diagnostics, not exceptions or stderr parsing. Rich exception and stack data lives in opt-in ephemeral Debug Records. Ordinary failed or degraded transformations still return typed Results, while JSON-RPC errors are limited to protocol faults. Observers can export or persist traces and logs, but no telemetry or content retention is enabled by default.

## Continuation

The high-level boundaries are stable enough to move into contract design. The resumed grill fixed six protocol-v1 public phases—`preflight`, `analyze`, `transform`, `adapt`, `validate`, and `render`—and deferred arbitrary custom phases so their execution semantics cannot become ambiguous. It also made the Prompt Document text-first: user content stays separate from Host Context, external files remain explicit Resource References, and capability-declared Plugins—not the Kernel—load or interpret other modalities. Plugins return typed, atomic, revision-aware Patches against stable block identities rather than arbitrary JSON Patch or shared mutation. Exact Protected Spans are Kernel-enforced, while meaning-level Semantic Constraints are evaluated by Guards. Text Patches and protections share exact revision-bound Unicode selectors. Artifacts have typed content and provenance, while Recipes control which products reach the stable Run Result. The next branch resolves standard Events and Diagnostics, isolated process limits, Provider capability conformance, Pi Host capabilities, and packaging.
