---
status: accepted
---

# Keep one canonical Kernel behind a runtime-neutral protocol

The canonical Kernel will be TypeScript on Node.js, while JSON Schema and a versioned application protocol make it consumable from other languages. Reimplementing the Kernel in Go for the CLI would appear self-contained but would duplicate lifecycle, graph, validation, and failure semantics; the Go CLI instead acts as a real JSON-RPC client of the packaged Node runtime.

## Consequences

Cross-language conformance and packaging become first-class work. The release must distribute both the Go executable and compiled runtime, but every Host observes one behavior model.
