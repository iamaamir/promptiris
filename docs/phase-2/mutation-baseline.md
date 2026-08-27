# Mutation baseline

Mutation testing covers the protocol, Plugin SDK, graph compiler, plugin execution engine, and Node native-plugin supervisor. It exists to make test sensitivity inspectable rather than inferred from line coverage.

The external-plugin slice began at 75.94% on a forced run of 1,066 generated mutants. Contract-focused tests and code removal raised the corrected line-scoped result to 93.90%: 506 killed, two timed out, 28 survived, five had no coverage, and 412 failed TypeScript compilation. All package targets score 100%; the native supervisor scores 82.16%. The configured breaking threshold is now 90%, with 95% shown as the high band.

The hardening work added deterministic assertions for:

- exact JSON-RPC initialize, invoke, cancel, and shutdown envelopes with monotonic IDs;
- protocol boundary limits, invalid implementation shapes, registration identity, diagnostic metadata, event payloads, and deterministic graph ordering;
- initialization, invocation, cancellation, forced shutdown, acknowledged-but-lingering shutdown, process crash, and malformed protocol containment;
- shell isolation, high-volume stderr draining, abort-listener cleanup, data-only manifests, shared references, cycles, accessors, and symbol keys.

Dead stderr-tail buffering was removed because it had no consumer or public effect. Mutation exclusions are line-scoped and carry source rationale. They cover behaviorally equivalent compiler policy, duplicate-plan branches that are already made non-executable by diagnostics, and native lifecycle idempotency or resource cleanup whose mutation cannot change the settled public result. Broad file or region exclusions are forbidden.

The canonical machine report is `.agent/reports/mutation.json` and remains ignored because it is revision-specific evidence. CI regenerates it. Any new survivor must be killed, explicitly classified as equivalent with evidence, or cause the 90% threshold to fail; it may not disappear through an unexplained exclusion.
