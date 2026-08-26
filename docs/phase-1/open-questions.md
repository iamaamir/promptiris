# Open questions

This is the continuation point for the design grill. Resolved items move to the decision register, and durable trade-offs receive an ADR only when warranted.

## Next questions

The initial product-design tree has no unresolved release-blocking questions. The cross-document consistency audit is complete; Phase 1 and the implementation-governance checkpoint are closed.

## Implementation-governance calibration

These require evidence from real Phase 2 tracer bullets rather than more speculative design:

- Exact package-specific CRAP, mutation, and test-strength thresholds; the accepted coverage floors remain minima unless later evidence supersedes them.
- Fast/candidate/integration/scheduled/release Quality Profile budgets, including benchmark variance/regression limits and fuzz/soak durations.
- Final tool selections for TypeScript/Go API drift, dead-code/dependency hygiene, mutation, property/state-model testing, reachable vulnerability analysis, and performance comparison after tracer-bullet trials.
- Failure-fingerprint similarity and retry/reasoning-escalation budgets.
- Context Graph, Orientation Packet, Evidence, report, Work Item, Tool Capability Registry, Tool Trace, Harness Event, Automation Task, and Automation Candidate schemas.
- Context-provider invalidation, caching, redaction, retention, and garbage collection.
- Curated initial capability/adapter set, routing cost/fallback policy, and cross-platform availability after measured tracer bullets.
- Automation Miner sequence representation, opportunity thresholds, confidence/adjudication, promotion economics, and retirement policy.
- Tool Trace and measurement redaction, retention, local/CI storage, token estimation, and privacy budgets.
- Task lease/source integration for local, GitHub, and future agent hosts.
- Whether a Hardener may edit production code directly or must return findings to the Implementer.
- The smallest useful delegation-depth policy after observing real task decomposition.

## Deferred topics

- Central Plugin catalog and reputation/signing model.
- Codex and OpenCode Host Adapters.
- Keychain credential helper.
- HTTP or daemon transport.
- Durable queues, dead-letter queues, replay, and failure sinks.
- Multi-pass optimization Recipes and automated prompt search.
- Stronger native Plugin sandboxes.
- Runtime resource auto-unloading.
- Linux musl/Alpine standalone bundles and additional CPU architectures.
- Node single-executable packaging after its stability and target coverage satisfy the release matrix.
