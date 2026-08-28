# T003-03 — Plugin and runtime conformance

Status: complete

## Outcome

Replace the provisional whole-document Plugin return path with typed invocation output, then exercise declarative and supervised native Plugins through the same Kernel Patch path and shared Go fixtures.

## Acceptance

- Plugin inputs are immutable and carry the current revision.
- Invalid Patch output becomes a normalized Diagnostic and preserves the last accepted state.
- Declarative and native examples receive no privileged mutation API.
- Runtime/CLI transport validates the richer Prompt Document and Result contract.
- Go coordinate conversion and fixtures agree with TypeScript semantics.

## Evidence

Declarative and native Plugins return typed output; the Kernel stamps Artifact provenance and enforces exposure. Runtime integration, generated schemas, Go conversion tests, and shared fixtures pass.
