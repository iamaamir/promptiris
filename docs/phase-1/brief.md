# Phase-one brief

## Goal

Design an extensible SDK that lets a host transform user input before it reaches a target model or system. The first complete use case is prompt enhancement, but the architecture must also support guards, memory, extraction, translation into specialized structures, target adaptation, evaluation, and future behaviors without Kernel changes.

Phase 1 produces requirements, architecture, protocols, developer and user experience, research, and validation plans. It does not produce implementation.

## Product principles

1. **Everything is a plugin.** Behavior belongs in explicit, composable Plugins; the Kernel owns only invariant orchestration mechanics.
2. **Installed is not active.** A Plugin affects a Run only through an explicitly selected Recipe.
3. **Model-neutral first.** Produce a model-neutral enhancement by default, then optionally apply a target-specific adaptation plugin.
4. **Bring your own model.** Local, OpenAI-compatible, and non-compatible providers are possible; OpenAI compatibility is merely bundled convenience.
5. **Stateless by default.** History, memory, caches, telemetry retention, and audit storage require optional Plugins.
6. **Hosts own the interaction.** Confirmation, permissions, presentation, and submission behavior depend on host capabilities.
7. **Optional transformation must not break the host.** Preserve the original Input and fail open unless a Guard or strict host policy explicitly requires blocking.
8. **Make behavior inspectable.** Results, patches, events, configuration, and diagnostics carry provenance.
9. **Be lazy without being vague.** Manifests and schemas are available for validation; executable behavior and resources activate only when required.
10. **Use evidence.** Compare each major problem with battle-tested systems and record what is adopted, rejected, or deferred.
11. **Invest in durable seams early.** Phase 1 may spend additional research and design effort on contracts that would be costly to retrofit, while requiring concrete scenarios before adding speculative product machinery.

## Primary users

- A CLI user enhancing stdin, a file, or an argument.
- A host-integration author adding Prompt Iris to Pi, Codex, OpenCode, or another agent environment.
- A Plugin author contributing a provider, transformation, guard, renderer, observer, Recipe, or adapter.
- An application developer embedding the TypeScript SDK.
- A maintainer debugging a composition or evaluating a strategy.

## In scope for v1

- TypeScript Kernel and SDK on modern Node.js.
- Runtime-neutral JSON schemas and a versioned application protocol.
- Plugin manifest, lifecycle, graph compiler, configuration, capability negotiation, and isolation model.
- `PromptDocument`, Artifact, Result, Event, Diagnostic, and Debug Record contracts.
- Default Enhance Recipe and an OpenAI-compatible Provider Plugin.
- Go CLI as a real protocol client, not a second Kernel.
- Official Pi Host Adapter in this repository.
- Plugin SDK, test kit, development tools, example Plugin, conformance fixtures, and evaluation corpus.
- npm and local-package discovery, plus a lockfile.

## Explicitly out of scope for v1

- A hosted Prompt Iris service or mandatory cloud dependency.
- A centralized Plugin registry, automatic installation during a Run, or arbitrary remote code loading.
- A second Kernel implementation in Go or any other language.
- Ambient file, conversation, environment, or workspace crawling.
- Core history, durable queues, dead-letter queues, telemetry storage, or content capture.
- An RBAC system or universal sandbox.
- A scripting language for declarative Plugins.
- Guaranteed prompt optimization without datasets and evaluation metrics.
- Automatic semantic merging of conflicting mutations.
- Silent provider switching, silent requirement invention, or silent behavior changes after installation.

## Phase 1 completion

- Every accepted decision has a stable home and rationale.
- Core domain terms are unambiguous.
- A Plugin author can understand the extension contract without reading Kernel internals.
- A host author can predict progress, fallback, cancellation, and error behavior.
- TypeScript, Go, and isolated Plugin implementations can share one authoritative protocol.
- The Default Enhance Recipe has a measurable evaluation plan across weak, strong, local, and text-only models.
- No release-blocking design question remains; deferred roadmap work and implementation-time verification spikes are explicit.

These criteria are satisfied by the decision register, current architecture/specification/product documents, research ledger, security model, developer experience contract, and [implementation handoff](./implementation-handoff.md). Phase 2 may change a decision only by updating its canonical document and, when applicable, superseding its ADR.
