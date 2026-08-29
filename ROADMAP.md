# Prompt Iris implementation roadmap

Status: ready-for-human

GitHub issue: <https://github.com/iamaamir/promptiris/issues/7>
Branch: n/a
Parent: none
Blocked by: none
Blocks: .scratch/roadmap-automation/issues/01-roadmap-sync.md, .scratch/provider-path/issues/01-provider-contract.md, .scratch/provider-path/issues/02-openai-compatible.md, .scratch/provider-path/issues/03-provider-doctor.md, .scratch/enhance-path/issues/01-default-enhance.md, .scratch/enhance-path/issues/02-guard-renderer.md, .scratch/enhance-path/issues/03-evaluation-harness.md, .scratch/resource-path/issues/01-resource-resolver.md, .scratch/discovery-path/issues/01-plugin-discovery.md, .scratch/devtools-path/issues/01-observer-devtools.md, .scratch/host-path/issues/01-cli-surface.md, .scratch/host-path/issues/02-pi-adapter.md, .scratch/release-path/issues/01-adjacent-bundle.md, .scratch/release-path/issues/02-release-evidence.md
Parallel-safe: n/a; child packets declare their own ownership and dependencies

## Goal

Complete the smallest trustworthy Prompt Iris v1 as vertical, independently reviewable slices. This roadmap is an index and GitHub parent; each child packet owns the specification an agent must execute.

This parent is not an implementation assignment. Pick one unblocked child packet instead.

## Delivered foundations

- Identity tracer, repository control plane, evidence harness, and deterministic verifier
- External declarative and native Plugin path
- Prompt Document, typed Patch, protected-span, and revision state path
- Configuration, policy, capability-evidence, inspect, and doctor foundations
- Runtime lifecycle, cancellation, disposal, event dispatch, debug records, and authorized lazy loading

## Remaining v1 sequence

1. Provider path: contract, bundled OpenAI-compatible Provider, then conformance probes.
2. Default Enhance path: neutral recipe, Guard and Renderer, then evaluation release gate.
3. Resource path: bounded resolution of explicit text and file references.
4. Discovery path: local/npm discovery, lockfile, activation, and install UX.
5. Devtools path: Observer-based progress, diagnostics, traces, and support bundles.
6. Host path: complete CLI behavior, then the official Pi Adapter.
7. Release path: adjacent runtime payloads, then reproducible release evidence and platform matrix.

Work may run concurrently only when each packet is unblocked and its ownership/conflict domain does not overlap another active packet.

## Deferred beyond v1

Codex and OpenCode adapters, a central Plugin registry and reputation system, persistent history, stronger sandboxing, daemon transport, general multimodal processing beyond explicit bounded Resources, and durable queues remain deliberately deferred. Promote one only through a new local packet and an explicit scope decision.

## Completion rule

V1 is ready only when the child packets are complete, public contracts and conformance suites agree across languages and Hosts, the Default Enhance release profile passes, release provenance exists, a third-party-style Plugin uses no internals, and failed optional transformation preserves Host input.
