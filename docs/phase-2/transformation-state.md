# Immutable transformation-state tracer

## Outcome

The Kernel now owns an immutable, revisioned `PromptDocument` state and accepts only schema-valid typed Patches. Plugins receive a frozen snapshot and its revision; they return Patch and Artifact proposals instead of replacing documents. A Patch is applied to a private candidate and either commits completely or leaves the accepted state unchanged.

The operation union supports text replacement, stable block insertion/replacement/removal, and Plugin-owned extension updates. Text selectors use Unicode-scalar offsets, exact quote evidence, and extended grapheme boundaries. Block replacement and removal require SHA-256 preconditions. Protected spans reject overlap and rebase deterministically after non-overlapping edits.

Artifact IDs and provenance are Kernel-stamped. Classification plus Recipe policy controls primary, alternative, and exposed outputs. Invalid output, stale revisions, protection conflicts, and namespace violations become normalized fail-open Diagnostics.

## Portability boundary

TypeScript remains the canonical transformation Kernel. The Go CLI validates the generated Result schema and consumes shared selector, overlap, and rebase fixtures. Its coordinate helpers convert Unicode-scalar offsets to UTF-8 byte offsets and back. Extended grapheme enforcement remains at the canonical Kernel boundary; Go does not invent a partial Unicode segmentation implementation.

## Deterministic evidence

- Shared fixture: `spec/fixtures/transformation-state.json`
- Authoritative schemas: `spec/schemas/prompt-document.schema.json` and `spec/schemas/patch.schema.json`
- TypeScript property tests use fixed seed `20260828` with 200 runs per invariant.
- Package coverage: core 99.06% statements and 98.03% branches; transformation state 98.4% statements and 96.99% branches.
- Mutation baseline: 94.28% aggregate, 92.82% transformation state, and 91.86% plugin execution.
- CRAP: 173 functions, zero violations, maximum 11.
- Candidate verification: all 15 gates passed before the mutation hardener.

The full Hardener passed every gate with trace prefix `20260828T095506`; the completion Git revision binds that evidence to source. Revision-specific logs and machine reports remain under ignored `.agent/` storage rather than being copied into model context.

## Deferred behavior

Default Enhance, provider selection, configuration layering, semantic Guards, Resource loading, multimodal transport, and persistent history remain later Plugin-driven slices. The state contract does not grant Plugins filesystem, network, or Host authority.
