---
status: accepted
---

# Keep Prompt Documents text-first and resources explicit

V1 Prompt Documents will guarantee inline text and explicit Resource References while delegating file loading, binary transport, OCR, PDF extraction, image understanding, and transcription to authorized capability-declared Plugins. Embedding every media type in the core schema appears more future-proof, but it would force the Kernel and every Host to define binary limits, security, token accounting, and Provider fallback before the primary text use case needs them.

## Consequences

User content and Host Context remain distinct, the Kernel never reads a URI, and unsupported Resource References generate visible degradation rather than disappearing. Future multimodal Recipes can add capabilities and Artifacts without changing what a v1 text-only Provider is required to support.
