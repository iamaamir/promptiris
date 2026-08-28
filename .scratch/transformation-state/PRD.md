# Transformation State Path

Status: complete

## Goal

Prove the first immutable transformation vertical slice. A selected Plugin receives a frozen Prompt Document snapshot and returns a typed, revision-aware Patch. The Kernel validates and applies the Patch atomically, preserves exact Protected Spans, rebases surviving selectors deterministically, records stable failures as Diagnostics, and exposes only Recipe-authorized Artifacts.

This slice does not call a model. It establishes the portable state contract that Default Enhance, guards, memory overlays, renderers, native Plugins, the Go CLI, and future Host Adapters will share.

## Canonical decisions

- Prompt Documents are text-first and keep Input separate from Context and Resource References.
- Plugins return typed Patches or Artifacts, never mutable documents or arbitrary JSON Patch.
- Text Selectors use stable block IDs, revision-bound Unicode scalar ranges, exact quotes, and grapheme-boundary validation.
- Protected Spans are exact Kernel invariants; Semantic Constraints remain Guard responsibilities.
- A Patch is an ordered, atomic closed union. A stale revision, failed precondition, invalid operation, protection conflict, or unauthorized namespace rejects the complete Patch.
- Accepted non-overlapping edits deterministically rebase active Protected Spans.
- Recipes, Artifact classification, and Host policy jointly control Result exposure.
- TypeScript is the canonical Kernel implementation; Go consumes the same schemas and conformance fixtures without reinterpreting semantics.

## Public behavior

1. A string constructs a valid one-block Prompt Document; richer documents may include Context, constraints, protections, Resource References, and namespaced extensions.
2. A Plugin invocation receives an immutable document plus the current revision.
3. A Plugin returns a typed Patch and optional Artifact proposals through a validated invocation result.
4. The Kernel applies Patch operations in declared order against a private candidate snapshot.
5. A failure discards the entire candidate, emits a normalized Diagnostic, and preserves the last accepted document.
6. Exact selectors reject stale revisions, quote mismatches, invalid scalar ranges, and endpoints inside grapheme clusters.
7. Protected overlap is rejected; accepted edits outside a protection rebase it without changing its exact quote.
8. Stable block operations and extension ownership do not depend on array indexes or discovery order.
9. TypeScript and Go agree on shared positive and negative transformation fixtures.

## Out of scope

- Configuration layering and capability evidence
- Provider calls or Default Enhance strategy
- Semantic Guard judgment
- Binary Resource loading or multimodal transport
- Concurrent mutating contributions or semantic merge
- Persistent run history or debug-record storage

## Acceptance

- Public schemas and TypeScript types describe the complete tracer contract.
- Property and example tests cover Unicode scalars, grapheme boundaries, atomicity, revision conflicts, content preconditions, protection overlap/rebase, stable block targeting, and extension ownership.
- The declarative and native Plugin examples use Patch output rather than returning replacement documents.
- A host-facing runtime/CLI fixture crosses the existing framed boundary with the richer Prompt Document contract.
- Go validates shared fixtures and provides portable coordinate conversion required by a Go Host.
- Targeted verification passes before the full Hardener profile; mutation remains at least 90%, package coverage policy passes, and CRAP has no violations.
- Durable protocol/bootstrap documentation and API reports match the implemented public contract.

## References

- `CONTEXT.md`
- `docs/architecture/protocol.md`
- `docs/adr/0004-immutable-artifacts-and-ordered-patches.md`
- `docs/adr/0009-text-first-documents-and-explicit-resource-references.md`
- `docs/adr/0010-typed-atomic-domain-patches.md`
- `docs/adr/0011-separate-exact-protection-from-semantic-validation.md`
- `docs/adr/0012-portable-exact-text-selectors.md`
- `docs/adr/0013-recipe-declared-artifact-exposure.md`
