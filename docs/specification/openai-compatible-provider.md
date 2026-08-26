# Bundled OpenAI-compatible Provider profile

This profile defines what `meta-prompt/provider-openai-compatible` may claim without pretending that OpenAI-compatible servers implement one uniform API. Capability identity applies to the complete Model Binding—endpoint, selected model, server version/configuration, and authentication—not merely to a vendor name.

## Portable baseline

An explicitly configured `chat-completions-text-v1` binding offers only:

- HTTP `POST /v1/chat/completions`;
- non-streaming text generation;
- `model`;
- exactly one textual `user` message; and
- a configured output-token bound mapped to `max_tokens`.

The strategy is rendered into that single user message, so the baseline does not assume that a model distinguishes system/developer roles. Provider defaults control temperature and other sampling unless support is declared. A server that cannot pass this baseline is not compatible with this profile and produces `capability.missing` or a normalized Provider Diagnostic.

## Optional capabilities

The Provider exposes each feature independently with state `supported`, `unsupported`, or `unknown`:

| Capability | Default | Evidence required |
| --- | --- | --- |
| `protocol.responses` | `unknown` | Explicit binding profile or successful opt-in probe |
| `generation.stream` | `unknown` | Explicit profile or successful stream conformance probe |
| `input.roles.system` | `unknown` | Explicit model/binding declaration; route acceptance alone is insufficient |
| `output.json-object` | `unknown` | Explicit profile or successful schema-independent probe |
| `output.json-schema` | `unknown` | Explicit profile or successful constrained-output probe |
| `sampling.temperature`, `sampling.top-p`, `sampling.stop` | `unknown` | Explicit accepted-field declaration |
| `sampling.seed` | `unknown` | Explicit declaration plus deterministic conformance when relied upon |
| `response.usage` | `unknown` | Explicit declaration or observed valid response metadata |
| `reasoning.control` | `unknown` | Explicit namespaced field mapping and accepted-value set |
| `input.image`, `input.audio`, `tools` | `unknown` | Explicit model and endpoint declaration; outside Default Enhance v1 requirements |
| context and output limits | `unknown` | Explicit binding values or trustworthy server/model metadata |

`/v1/models` proves, at most, that a model ID is listed. It does not prove structured output, streaming, reasoning, modality, context length, or parameter semantics. The Provider never sniffs a server brand and never silently sends, drops, or translates an unsupported option.

## Evidence and inspection

Capability evidence is ordered and retained with its source:

1. Host-enforced restriction;
2. explicit per-binding user or project configuration;
3. an explicitly selected, versioned built-in server profile;
4. an Engine-local successful observation; then
5. `unknown`.

A restriction can remove support but a lower-confidence source cannot add it over an explicit denial. Conflicting positive claims fail inspection instead of guessing. Observations are scoped to the binding fingerprint and Engine lifetime; they do not silently rewrite persistent configuration.

`doctor` performs connectivity, authentication, model-list, and non-generating checks by default. `doctor --probe` clearly warns that probes can consume compute, tokens, time, and money, then runs a bounded conformance request only with user authorization. Probe results name the exact endpoint/model fingerprint and can be exported as suggested configuration for explicit review.

## Wire behavior

The implementation uses a narrow HTTP/SSE client rather than leaking an OpenAI SDK's entire option surface into the contract. It validates status, content type, JSON/SSE framing, complete final output, and any advertised usage. It supports standard error shapes when present and safely normalizes other bodies. Server-specific request fields live only under the Provider's namespaced options and require schema declaration.

No automatic fallback occurs between Chat Completions and Responses: changing endpoint families can change semantics. A binding selects one profile. Default Enhance prefers native schema output when supported, otherwise JSON object mode, otherwise text decoding, as already defined by the Recipe.
