# Phase 1 implementation handoff

Phase 1 and the implementation-governance checkpoint are complete. The baseline contains 112 accepted decisions, 20 ADRs, a canonical glossary, cohesive architecture/protocol/product contracts, a threat model, an implementation/tooling contract, an [agent-driven implementation operating model](../development/agent-operating-model.md), a [tool-aware execution contract](../development/tool-aware-execution.md), and a source-by-source research ledger. Phase 2 has started with the [verified identity tracer and development harness](../phase-2/bootstrap.md); no release-blocking product-design question remains.

## What is fixed for v1

- A policy-free TypeScript/Node microkernel; everything behavioral is an explicitly activated Plugin or Recipe.
- One runtime-neutral, strictly validated JSON/JSON-RPC protocol shared by TypeScript, Go, and isolated native Plugins.
- Stateless Runs, explicit Context/Resource References, immutable typed Artifacts/Patches, exact Protected Spans, semantic Guards, standard Events/Diagnostics, and fail-open optional transformation.
- A model-neutral, one-call Default Enhance Recipe with capability-adaptive decoding and evidence-gated releases.
- Bring-your-own Providers with a deliberately minimal bundled OpenAI-compatible baseline.
- A Go CLI that exercises the protocol and ships beside a private canonical Node runtime.
- A thin official Pi Adapter using real input-transform/confirmation/progress capabilities.
- Plugin SDK, testkit, devtools Observer, examples, conformance fixtures, evaluation harness, and one monorepo.

## Phase 2 tracer bullets

Implement in vertical slices. Each slice must produce a runnable artifact and shared fixtures; do not build all package skeletons horizontally first.

Before or within the identity slice, initialize the repository control plane: Git and protected integration policy, the smallest Work Item/Evidence schemas, a deterministic verification entrypoint, task-scoped `.agent/` state, and the first useful `scripts/agent-context` compilation path. Add one minimal Tool Capability Registry, textual and structural search adapters, an affected-test Automation Task, revision-bound Tool Traces, raw/compact output references, and one Harness Event that invalidates/recomputes Evidence. Keep this a tracer bullet over real repository state rather than building a general agent platform horizontally.

1. **Identity path:** establish workspace/tooling/schemas, then make the Go CLI launch Node, negotiate, run an explicitly selected bundled identity Recipe, stream standard Events, and return a validated Result.
2. **External Plugin path:** discover and lock one local declarative Plugin and one supervised native example; compile graph order, lazily activate, invoke, cancel, and normalize malformed/crashed behavior.
3. **Transformation state path:** implement Prompt Document, Text Selectors, Protected Spans, typed atomic Patches, revision/rebase rules, Artifacts, exposure policy, and deterministic property fixtures in TypeScript and Go.
4. **Configuration/capability path:** implement JSONC layers, schema-directed merge, ConfigTrace, secrets as refs, Host policy constraints, manifest capabilities/Permission Hints, inspect, and doctor.
5. **Provider path:** implement the minimal Chat Completions text profile, explicit capability evidence, safe HTTP/SSE/error normalization, fake servers, and opt-in conformance probes.
6. **Default Enhance path:** add the versioned neutral strategy, one-call decoder fallbacks, deterministic guards, Renderer, original fallback, and evaluation harness before tuning wording.
7. **Host path:** finish CLI UX/exit/stream contracts, then Pi confirmation/suggest/automatic/manual modes and Host conformance against pinned Pi types.
8. **Release path:** build adjacent runtime payloads, extracted native smoke matrix, licenses/SBOM/checksums/attestations/signing, public docs, and beta packages.

The first three slices intentionally prove “everything is a plugin,” cross-language transport, safe failure, and exact transformation contracts before investing in the model strategy.

## Mandatory implementation-time verification

These are verification tasks, not unresolved product choices:

- pin supported Node, TypeScript, pnpm, Go, Pi, Ajv, and Go-validator versions and record their exact conformance results;
- validate schema-to-TypeScript/Go generation against the constrained profile before standardizing a generator;
- test child-process termination semantics on every target OS, especially Windows process trees;
- confirm official Node redistribution notices and each target binary's libc/OS minimum;
- calibrate evaluation graders and freeze the first corpus splits before editing the candidate strategy against them;
- prove npm optional platform payload installation/upgrade/offline behavior on every tuple;
- obtain signing identities or mark unsigned beta channels visibly;
- calibrate the orthogonal Quality Profiles—including CRAP, mutation, property/state-model/fuzz, differential/API compatibility, runtime adversity, security/supply-chain, performance/resource, evidence-integrity, and source-blind QA evidence—from the first real tracer bullets without silently weakening the agreed coverage floors or quality hierarchy;
- prove that Tool and Verifier Adapters declare stable inputs/outputs, applicability, cost, cache/invalidation, sensitivity, and finding codes while remaining independent from Meta Prompt Plugins/runtime and while the repository verifier retains standard Harness Events/diagnostics, Evidence validation, and merge authority;
- prove capability-first routing, raw/compact Tool Trace integrity, event idempotency/supersession, and the read-only Automation Miner on real accepted tasks before permitting any Automation Candidate to enter the gauntlet;
- validate Context Graph/Orientation Packet schemas, Evidence invalidation, task leases, source-blind QA isolation, and secret-safe artifact retention; and
- prove that parallel worktrees, Candidate Evidence reuse, and the integration queue cannot accept stale or cross-revision results.

A failed verification may narrow a declared capability or target. It may not silently weaken validation, fallback, permission, or evaluation guarantees.

## Definition of v1-ready

V1 is ready only when all in-scope packages and official adapters implement their documented public contracts; TypeScript/Go/native/Host conformance and release-platform matrices pass; the Default Enhance release profile passes; security/license/provenance artifacts exist; a third-party-style example Plugin uses no internals; and installation plus a failed transformation have been tested end-to-end without corrupting Host input.

## Change discipline

Implementation discoveries are expected. A local implementation detail can change in its code review. A public contract or accepted decision changes only with its canonical document, decision-register row, compatibility impact, research evidence where relevant, and a superseding ADR when the original trade-off was durable. Deferred topics remain in [open questions](./open-questions.md) and cannot enter v1 accidentally.
