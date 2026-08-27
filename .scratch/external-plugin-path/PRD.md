# External Plugin Path

Status: complete

## Goal

Prove the first non-identity vertical slice of Meta Prompt's plugin-first microkernel. A host explicitly selects local plugins; the kernel compiles a deterministic lifecycle graph, activates implementations lazily, invokes declarative or supervised native contributions, and returns a fail-open result with normalized diagnostics when a contribution fails.

This slice does not call a model. It establishes the execution path that later prompt transformers, guards, providers, memory, and host adapters will use without privileged APIs.

## Canonical decisions

- The six lifecycle phases and their order come from ADR-0008.
- Plugins are manifest-eager and execution-lazy.
- No plugin is auto-installed or auto-selected during a run.
- Built-ins and third-party plugins use the same public contracts.
- Declarative plugins remain data-only; this slice must not invent a scripting language.
- Third-party native code runs behind the bounded supervisor described by ADR-0005 and ADR-0014.
- Mutable work is ordered deterministically; independent observers may eventually run concurrently, but concurrency is not required by this slice.
- A plugin failure is data. The run returns the last valid artifact plus a normalized diagnostic unless the host explicitly chooses stricter policy later.

## Public behavior

1. A host supplies an explicit local plugin selection and a recipe.
2. The kernel validates manifests and compiles contributions into the fixed phase order.
3. Dependencies and `before`/`after` constraints produce one deterministic order independent of discovery order.
4. Unknown phases, missing dependencies, conflicts, and cycles fail before activation with structured diagnostics.
5. An implementation is not loaded until its first selected contribution is invoked.
6. A declarative contribution can apply a portable, deterministic prompt-document transformation.
7. A supervised native contribution negotiates the protocol, can transform an artifact, observes cancellation and limits, and cannot corrupt the host protocol with malformed output.
8. Timeout, crash, malformed response, and cancellation become normalized diagnostics and preserve the last valid artifact.
9. Lifecycle and diagnostic events use the built-in dispatcher and standard event envelope.

## Out of scope

- npm discovery, installation, registry/catalog UX, or lockfile resolution
- model/provider invocation
- prompt-enhancement quality or target-specific adaptation
- native process pooling, quarantine persistence, or production-grade sandboxing
- remote plugins, network permissions, history, or durable run storage
- parallel mutating contributions

## Acceptance

- Public-interface tests cover deterministic graph compilation, lazy activation, declarative execution, native happy path, cancellation, and malformed/crashed native behavior.
- Tests are written as vertical red-green-refactor slices.
- Candidate verification, mutation, coverage/CRAP, secret scanning, and the repository hardener pass.
- A human-style QA check exercises the public host-facing path without importing internal modules.
- Tool traces and verification evidence are recorded so the dashboard can answer cost, output-reduction, mutation, coverage, and gate-status questions.

## Completion evidence

- Full verifier: `verify-20260827T151632Z-51568` passed all 20 gates.
- Mutation: 76.57% across 1,066 generated mutants; the 75% breaking threshold passed.
- TypeScript coverage: 97.75% statements, 98.32% functions, and 93.77% branches.
- CRAP: 160 functions analyzed, 0 violations, maximum score 9.
- Telemetry: 59,351 estimated tokens avoided overall; the final verifier avoided an estimated 22,337 tokens.

## References

- `CONTEXT.md`
- `docs/adr/0001-plugin-first-microkernel.md`
- `docs/adr/0004-immutable-artifacts-and-ordered-patches.md`
- `docs/adr/0005-supervise-native-plugins.md`
- `docs/adr/0008-stable-lifecycle-phase-catalog.md`
- `docs/adr/0014-bounded-native-plugin-supervision.md`
- `docs/architecture/overview.md`
- `docs/architecture/plugins-and-recipes.md`
- `docs/architecture/events-and-diagnostics.md`
- `docs/development/agent-operating-model.md`
