# Mutation baseline

Mutation testing covers the protocol, Plugin SDK, graph compiler, immutable transformation state, plugin execution engine, and Node native-plugin supervisor. It exists to make test sensitivity inspectable rather than inferred from line coverage.

The transformation-state tracer generated 1,636 mutants and established a 94.28% aggregate no-regression baseline: 807 killed, two timed out, 44 survived, five had no coverage, and 680 failed TypeScript compilation. Every governed target is at least 90%: transformation state is 92.82%, plugin execution is 91.86%, the native supervisor is 90.23%, and protocol, Plugin SDK, graph, and core entrypoint targets are 100%. The configured breaking threshold remains 90%, with 95% shown as the high band.

The hardening work added deterministic assertions for:

- exact JSON-RPC initialize, invoke, cancel, and shutdown envelopes with monotonic IDs;
- protocol boundary limits, invalid implementation shapes, registration identity, diagnostic metadata, event payloads, and deterministic graph ordering;
- atomic typed Patches, stale revisions, Unicode-scalar coordinates, grapheme boundaries, exact quote evidence, protected-span rebasing, stable block preconditions, and namespace ownership;
- Artifact identity, provenance, classification, Recipe-governed exposure, and fail-open behavior after rejected Plugin output;
- initialization, invocation, cancellation, forced shutdown, acknowledged-but-lingering shutdown, process crash, and malformed protocol containment;
- shell isolation, high-volume stderr draining, abort-listener cleanup, data-only manifests, shared references, cycles, accessors, and symbol keys.

Dead stderr-tail buffering and redundant pre-application conflict checks were removed because they had no distinct public effect. Mutation exclusions are line-scoped and carry source rationale. They cover behaviorally equivalent compiler policy, module-load schema constants that cannot be isolated by the mutation runner, a default-equivalent `Intl.Segmenter` option, impossible type-narrowing fallbacks, duplicate-plan branches already made non-executable by diagnostics, and native lifecycle idempotency or resource cleanup whose mutation cannot change the settled public result. Broad file or region exclusions are forbidden.

The canonical machine report is `.agent/reports/mutation.json` and remains ignored because it is revision-specific evidence. CI regenerates it. Any new survivor must be killed, explicitly classified as equivalent with evidence, or cause the 90% threshold to fail; it may not disappear through an unexplained exclusion.
