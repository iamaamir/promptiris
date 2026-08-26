---
status: accepted
---

# Keep runtime, protocol, CLI, and official adapters in one monorepo

Meta Prompt will use one polyglot monorepo containing the TypeScript runtime and packages, Go CLI, shared specifications, conformance fixtures, and official Pi and future host adapters. Separate repositories would isolate release mechanics but make protocol changes and cross-host behavior drift harder to review; one repository provides a single change boundary while package versions and releases remain independently manageable.

## Consequences

Workspace tooling must coordinate pnpm and Go, CI must run cross-language conformance, and adapters must remain thin enough not to become alternate Kernels.
