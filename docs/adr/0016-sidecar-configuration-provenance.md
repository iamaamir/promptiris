---
status: accepted
---

# Keep configuration provenance in an immutable sidecar

Meta Prompt will give Plugins normal immutable configuration values and keep resolution evidence in a separate `ConfigTrace` keyed by JSON Pointer. Wrapping every scalar with its source would make schemas, authoring, destructuring, and cross-language use hostile; retaining only the final source would hide overrides, merges, and policy intervention when users need to explain behavior.

Host and organization policy is modeled as a constraint decision after ordinary precedence resolution, not as another source that appears user-overridable. Inspection can show the candidate chain, merge operation, source location, and policy action without passing that metadata through every Plugin call.

## Consequences

Configuration consumers stay simple and language-neutral, while `inspect` and development tools can answer why a value won. The Engine must maintain JSON-Pointer paths through schema-directed merges and enforce redaction at trace creation; credentials are never trace values, and sensitive values default to digests or redacted previews.
