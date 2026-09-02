# Provider contract and fake Provider

Status: in-progress

GitHub issue: <https://github.com/iamaamir/promptiris/issues/15>
Branch: `provider-contract`
Parent: ROADMAP.md
Blocked by: none
Blocks: .scratch/provider-path/issues/02-openai-compatible.md, .scratch/provider-path/issues/03-provider-doctor.md, .scratch/enhance-path/issues/01-default-enhance.md
Parallel-safe: yes; owns Provider SDK types, fake Provider, and Provider conformance fixtures
Patch policy: 1
Golden changes: denied
Test deletion: denied
Allowed paths:

- `.scratch/provider-path/**`
- `packages/plugin-sdk/**`
- `packages/protocol/**`
- `stryker.config.mjs`
- `tooling/quality/mutation-policy.json`

## Outcome

Define the smallest model-neutral text-generation contract and prove it with an in-memory fake Provider and shared fixtures.

## Acceptance

- Requests, responses, model binding, capabilities, cancellation, usage, diagnostics, and normalized failures have runtime-neutral schemas and exported TypeScript types.
- Capability claims require evidence bound to the active Provider configuration.
- The fake Provider deterministically exercises success, unsupported capabilities, cancellation, malformed output, and classified failure.
- No OpenAI-specific field enters the Kernel contract.
- Public API, schema, focused tests, mutation, CRAP, Reviewer, Hardener, QA, and candidate verification pass.

## Non-goals

HTTP transport, vendor-specific adaptation, prompt strategy, or persistent conversation history.
