# Mutation baseline

Mutation testing covers the protocol, Plugin SDK, graph compiler, immutable transformation state, plugin execution engine, configuration/capability path, Run lifetime, Event dispatcher, Debug Records, Node execution context, authorized lazy loading, runtime server, and native-plugin supervisor. It exists to make test sensitivity inspectable rather than inferred from line coverage.

The lifecycle and loading pass expanded mutation governance to 18 source files and established a 94.13% aggregate no-regression baseline: 91 survived and ten had no coverage. The raw survivor ceiling increased only because five newly governed targets entered the denominator; aggregate sensitivity improved from 93.47%, existing Plugin execution tightened from 91.86% to 94.85%, and native supervision improved from 90.23% to 90.29%. Every governed target remains above 90%. Debug Records, lazy loading, and execution context score 100%; Event dispatch scores 93.13%; and Run lifetime scores 91.43%. The configured breaking threshold remains 90%, with 95% shown as the high band.

The hardening work added deterministic assertions for:

- exact JSON-RPC initialize, invoke, cancel, and shutdown envelopes with monotonic IDs;
- protocol boundary limits, invalid implementation shapes, registration identity, diagnostic metadata, event payloads, and deterministic graph ordering;
- atomic typed Patches, stale revisions, Unicode-scalar coordinates, grapheme boundaries, exact quote evidence, protected-span rebasing, stable block preconditions, and namespace ownership;
- Artifact identity, provenance, classification, Recipe-governed exposure, and fail-open behavior after rejected Plugin output;
- initialization, invocation, cancellation, forced shutdown, acknowledged-but-lingering shutdown, process crash, and malformed protocol containment;
- first-wins cancellation/deadline races, reentrant bounded Event delivery, observer failure and overflow, late invocation outcomes, disposal ordering, execution-context isolation, authorized import ordering, malformed modules, and realpath/symlink escape;
- shell isolation, high-volume stderr draining, abort-listener cleanup, data-only manifests, shared references, cycles, accessors, and symbol keys.

Dead stderr-tail buffering and redundant pre-application conflict checks were removed because they had no distinct public effect. Mutation exclusions are line-scoped and carry source rationale. They cover behaviorally equivalent compiler policy, module-load schema constants that cannot be isolated by the mutation runner, a default-equivalent `Intl.Segmenter` option, impossible type-narrowing fallbacks, duplicate-plan branches already made non-executable by diagnostics, and native lifecycle idempotency or resource cleanup whose mutation cannot change the settled public result. Broad file or region exclusions are forbidden.

The canonical machine report is `.agent/reports/mutation.json` and remains ignored because it is revision-specific evidence. CI regenerates it. Any new survivor must be killed, explicitly classified as equivalent with evidence, or cause the 90% threshold to fail; it may not disappear through an unexplained exclusion.
