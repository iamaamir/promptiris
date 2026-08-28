# Architecture overview

## Shape

Prompt Iris uses a policy-free microkernel surrounded by explicit extension planes.

```text
Host (CLI, Pi, future Codex/OpenCode, embedded app)
  └─ Host Adapter
      └─ Engine / Kernel
          ├─ Recipe compiler and dependency graph
          ├─ lifecycle, cancellation, budgets, isolation
          ├─ schema/config/capability validation
          ├─ patch application and provenance
          └─ standard event dispatcher
              ├─ Pipeline / Guard / Renderer Plugins
              ├─ Provider Plugins → user-selected models
              └─ Observer Plugins → console, JSONL, OTel, etc.
```

The Kernel does not understand prompt-engineering policy. It discovers definitions, validates contracts, resolves dependencies, runs hooks, applies patches, isolates failures, and returns a typed Result. Strategies and transformations remain replaceable Plugins.

## Extension planes

| Plane | Contribution | May change transformation outcome? |
| --- | --- | --- |
| Host | Input/context mapping, interaction, progress, submission | Indirectly, through explicit run options |
| Recipe | Composition and output contract | Yes |
| Pipeline | Analysis and transformation | Yes |
| Guard | Invariant verification or enforcement | Yes; may block when configured |
| Provider | Model capability and generation | Yes |
| Renderer | Target or media representation | Yes |
| Observer | Event consumption/export/persistence | No |

Plugin IDs are namespaced and cannot shadow each other. Installing `acme/enhance-with-memory` therefore does not compete with the bundled `promptiris/enhance` Recipe. A user explicitly activates an overlay or another Recipe.

## Run lifecycle

1. The Host Adapter builds a Prompt Document from explicit Input and Context.
2. The Kernel resolves configuration and a fixed Plugin catalog snapshot.
3. The Recipe compiler flattens the base Recipe and optional overlay, validates dependencies and capabilities, and produces an immutable execution graph.
4. Required Plugins activate lazily. Providers and expensive resources remain unopened until invoked.
5. The compiled graph executes the six stable public phases described below.
6. The Kernel assembles and validates the Result and returns it even for ordinary degraded, blocked, cancelled, or failed outcomes.
7. The Host decides whether to submit, confirm, show a suggestion, or fall back.

Every phase emits standard Events. A host can show progress without knowing the chosen Recipe's internals.

### Stable public phases

The protocol v1 phase catalog is fixed:

| Order | Phase | Contract |
| ---: | --- | --- |
| 1 | `preflight` | Verify prerequisites and optionally block unsafe or invalid Input before Provider calls. |
| 2 | `analyze` | Produce read-only analysis and Context Artifacts; independent nodes may run in parallel. |
| 3 | `transform` | Propose Prompt Document or Artifact Patches; mutators run serially in resolved order. |
| 4 | `adapt` | Apply optional target-specific Patches after the model-neutral transformation; mutators run serially. |
| 5 | `validate` | Inspect the final transformed state without mutation; independent validators may run in parallel. |
| 6 | `render` | Produce declared output representations serially in resolved order. |

Kernel initialization and Result assembly are lifecycle mechanics, not extension phases. A Plugin may add any number of nodes to the appropriate phase and constrain them through dependencies, but neither a Plugin nor a Recipe may create a new phase in protocol v1. This keeps mutability, concurrency, blocking, and ordering semantics knowable across unrelated Plugins. A genuinely new execution semantic requires a future protocol revision.

## Ordering and composition

Contributions declare one stable phase plus `requires`, `before`, `after`, and `conflicts`. Ordering constraints cannot reverse the phase catalog. Resolution is deterministic and cycles, illegal cross-phase edges, or missing required dependencies are compile-time errors. There is no semantic “smart merge.” Narrow Patches, resolved serial ordering, idempotence expectations, and final validation make conflicts observable. Ambiguous changes require host confirmation or a Recipe change.

## Lazy invariant

**Manifest-eager, execution-lazy.** Static, side-effect-free manifests and schemas load early enough for discovery, validation, graph compilation, help, and inspection. Recipe compilation is lazy and cached. Plugin code, model clients, credentials, and resources activate only for a Run that needs them. A separate `prepare` operation may validate or warm resources explicitly.

Definitions are module-scoped and immutable. Resources may be engine-scoped and lazily shared. mutable work is Run-scoped. Hooks are reentrant unless a Plugin declares a lower concurrency limit. Shutdown rejects new Runs, waits or cancels outstanding work, flushes observers, and disposes resources in reverse dependency order.

## Runtime and repository

The TypeScript/Node implementation is canonical. Other languages consume the same versioned schemas and application protocol. The Go CLI launches and communicates with the adjacent private Node LTS runtime over JSON-RPC rather than recreating orchestration rules. The whole bundle upgrades as one version even though protocol negotiation remains mandatory.

V1 monorepo shape:

```text
apps/cli-go/
apps/runtime-node/
packages/protocol/
packages/core/
packages/plugin-sdk/
packages/testkit/
packages/devtools/
packages/builtins/
adapters/pi/
adapters/codex/       # later
adapters/opencode/    # later
spec/
docs/
```

One repository keeps the protocol, generated types, conformance fixtures, runtime, CLI, and official adapters versioned together. It does not imply one release version for every package.

## Related documents

- [Plugin and Recipe contract](./plugins-and-recipes.md)
- [Protocol, configuration, and types](./protocol.md)
- [Events, diagnostics, and debugging](./events-and-diagnostics.md)
- [Default Enhance Recipe](../product/default-enhance.md)
- [Hosts and CLI](../product/hosts-and-cli.md)
