---
status: accepted
---

# Require evidence for OpenAI-compatible capabilities

The bundled Provider will expose a minimal Chat Completions text baseline and model every richer feature independently as supported, unsupported, or unknown. It will not infer capabilities from an endpoint's product name, a successful `/v1/models` response, or the fact that a request field was ignored without error.

OpenAI-compatible servers intentionally implement different subsets and extensions, and feature behavior frequently depends on the selected model, chat template, backend, or startup flags. A broad optimistic contract would create the exact silent degradation Meta Prompt is designed to prevent; demanding full OpenAI parity would unnecessarily exclude useful local models.

## Consequences

The out-of-box path works with a very small text surface. Better structured output, streaming, usage, reasoning controls, or modalities activate only from explicit profiles/configuration or bounded opt-in conformance evidence. Users may configure more, but unsupported options are visible and never silently discarded.
