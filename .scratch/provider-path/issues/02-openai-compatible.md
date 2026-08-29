# OpenAI-compatible Provider

Status: ready-for-agent

GitHub issue: <https://github.com/iamaamir/promptiris/issues/16>
Branch: `openai-provider`
Parent: ROADMAP.md
Blocked by: .scratch/provider-path/issues/01-provider-contract.md
Blocks: .scratch/provider-path/issues/03-provider-doctor.md, .scratch/enhance-path/issues/01-default-enhance.md
Parallel-safe: no; owns the bundled Provider transport and its native runtime integration

## Outcome

Ship the minimal bundled Chat Completions text Provider for OpenAI-compatible endpoints, including local endpoints.

## Acceptance

- Base URL, model, headers, timeouts, and secret references are explicit configuration.
- HTTP, SSE, cancellation, rate limits, authentication, malformed responses, and transport failures normalize to the Provider contract.
- Structured output and other optional features are used only when supported evidence exists; text fallback remains valid.
- Fake HTTP servers cover partial streams, disconnects, large bodies, invalid JSON, and redaction.
- No ambient credentials or user content enter telemetry.
- Focused integration, mutation, security, Reviewer, Hardener, QA, and full verification pass.

## Non-goals

Responses API extensions, vendor SDKs, tool calling, image generation, or non-compatible Providers.
