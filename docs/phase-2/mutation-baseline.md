# Mutation baseline

Mutation testing covers the protocol, Plugin SDK, graph compiler, immutable transformation state, plugin execution engine, configuration/capability path, runtime server, and Node native-plugin supervisor. It exists to make test sensitivity inspectable rather than inferred from line coverage.

The configuration/capability tracer and subsequent boundary-quality pass expanded the scored surface from 858 to 1,409 mutants and established a 93.47% aggregate no-regression baseline: 82 survived and ten had no coverage. This is an intentional scope expansion, not a relaxation of the per-target standard. Every governed target remains above 90%; the new targets range from 90.75% for configuration resolution to 94.05% for capability evidence, while the runtime configuration loader and server score 91.53% and 93.81%. The configured breaking threshold remains 90%, with 95% shown as the high band. The configuration-loader percentage changed after validated collection refactoring reduced its mutation denominator, while its survivor count improved from six to five; both the new exact score and lower debt ceiling are governed.

The hardening work added deterministic assertions for:

- exact JSON-RPC initialize, invoke, cancel, and shutdown envelopes with monotonic IDs;
- protocol boundary limits, invalid implementation shapes, registration identity, diagnostic metadata, event payloads, and deterministic graph ordering;
- atomic typed Patches, stale revisions, Unicode-scalar coordinates, grapheme boundaries, exact quote evidence, protected-span rebasing, stable block preconditions, and namespace ownership;
- Artifact identity, provenance, classification, Recipe-governed exposure, and fail-open behavior after rejected Plugin output;
- initialization, invocation, cancellation, forced shutdown, acknowledged-but-lingering shutdown, process crash, and malformed protocol containment;
- shell isolation, high-volume stderr draining, abort-listener cleanup, data-only manifests, shared references, cycles, accessors, and symbol keys.

Dead stderr-tail buffering and redundant pre-application conflict checks were removed because they had no distinct public effect. Mutation exclusions are line-scoped and carry source rationale. They cover behaviorally equivalent compiler policy, module-load schema constants that cannot be isolated by the mutation runner, a default-equivalent `Intl.Segmenter` option, impossible type-narrowing fallbacks, duplicate-plan branches already made non-executable by diagnostics, and native lifecycle idempotency or resource cleanup whose mutation cannot change the settled public result. Broad file or region exclusions are forbidden.

The canonical machine report is `.agent/reports/mutation.json` and remains ignored because it is revision-specific evidence. CI regenerates it. Any new survivor must be killed, explicitly classified as equivalent with evidence, or cause the 90% threshold to fail; it may not disappear through an unexplained exclusion.
