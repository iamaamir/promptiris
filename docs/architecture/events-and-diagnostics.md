# Events, diagnostics, and debugging

## Built-in dispatcher

Plugins do not invent event channels. All Events pass through a built-in dispatcher that assigns Run, invocation, trace, span, causation, sequence, and timestamp fields; validates schemas; preserves ordering guarantees; applies sensitivity filtering; bounds buffers; and isolates subscribers.

Every Event uses a stable envelope:

```ts
interface Event<T extends JsonValue = JsonValue> {
  schemaVersion: "1";
  id: string;
  type: string;
  time: string;
  sequence: number;
  runId: string;
  source: EventSource;
  traceId: string;
  spanId?: string;
  parentSpanId?: string;
  causationId?: string;
  phase?: Phase;
  invocationId?: string;
  dataSchema: SchemaReference;
  data: T;
  classification: "metadata" | "content" | "sensitive";
  delivery: "critical" | "progress";
}
```

The Kernel stamps identity, source, time, correlation, classification, delivery class, and a monotonically increasing sequence within each Run. Time is observational; sequence defines delivery order. Parallel nodes may interleave differently across Runs. The terminal Run Event is always the final critical Event for that Run.

The v1 standard catalog is intentionally bounded:

| Family | Standard types | Purpose |
| --- | --- | --- |
| Run | `run.started`, `run.cancellation-requested`, `run.completed` | Host lifecycle and terminal Result status |
| Phase | `phase.started`, `phase.progress`, `phase.completed`, `phase.skipped` | User-visible progress across the six stable phases |
| Plugin | `plugin.activation-started`, `plugin.activation-completed`, `plugin.invocation-started`, `plugin.progress`, `plugin.invocation-completed` | Devtools tree and slow/failing contribution visibility |
| Provider | `provider.request-started`, `provider.first-output`, `provider.retrying`, `provider.request-completed` | Latency, streaming readiness, retries, and usage |
| Patch | `patch.proposed`, `patch.applied`, `patch.rejected` | Provenance and document diff inspection |
| Guard | `guard.evaluated` | Pass, warn, inconclusive, or block decision |
| Outcome | `fallback.activated`, `diagnostic.emitted` | Degradation and safe failure visibility |
| Observer | `observer.progress-dropped`, `observer.detached` | Self-diagnostics for backpressure and subscriber failure |

Start/completion payloads share common status and duration shapes; progress payloads use optional `current`, `total`, `unit`, and safe human-readable `message`. Usage belongs on provider completion and the Run summary, not on every progress Event. Failure is represented by referenced safe Diagnostics rather than copied exception data. On the wire, standard type names use the reserved `meta-prompt.` prefix—for example `meta-prompt.phase.started`; the shortened names in this document are for readability.

A Plugin may define a custom Event only in its own namespace and must register its schema in its manifest. Custom Events use the same envelope and may not impersonate standard lifecycle Events. Hosts should present unknown custom Events generically rather than depending on their payload.

Observer failures never alter the transformation. Each observer has an isolated bounded queue. When it lags, progress Events are dropped first and one coalesced `observer.progress-dropped` Event is sent to other healthy observers. If a critical Event cannot be enqueued, the lagging observer is detached and `observer.detached` is sent elsewhere. Observer callbacks never apply backpressure to the Run.

## Safe failures versus debug detail

Errors cross boundaries as data, never as language-specific `Error` objects.

**Diagnostic** is portable and safe for Hosts:

```ts
interface Diagnostic {
  schemaVersion: "1";
  id: string;
  code: string;
  category: DiagnosticCategory;
  severity: "info" | "warning" | "error" | "fatal";
  title: string;
  detail?: string;
  data?: JsonValue;
  source: DiagnosticSource;
  runId?: string;
  phase?: Phase;
  invocationId?: string;
  traceId?: string;
  spanId?: string;
  causeIds?: string[];
  retry: {
    disposition: "never" | "safe" | "conditional";
    scope?: "invocation" | "run";
    afterMs?: number;
  };
  docs?: string;
  debugRef?: string;
}
```

Stable categories are `configuration`, `validation`, `capability`, `authorization`, `resource`, `patch`, `provider`, `plugin`, `guard`, `timeout`, `cancellation`, `observer`, and `internal`. Category is broad routing metadata; `code` carries actionable precision. `fatal` is reserved for an unusable Engine/runtime, not an ordinary failed Run.

Core codes use `meta-prompt.*`. Plugin codes are namespaced and registered by the manifest; a Plugin cannot emit a core code. The initial core catalog is small:

- configuration: `config.invalid`, `config.unknown-key`, `config.policy-violation`;
- composition: `recipe.not-found`, `recipe.compile-failed`, `capability.missing`;
- input/resources: `input.invalid`, `resource.unsupported`, `resource.load-failed`;
- Patch/protection: `patch.invalid`, `patch.stale`, `patch.precondition-failed`, `protection.conflict`;
- Plugin boundary: `plugin.activation-failed`, `plugin.invocation-failed`, `plugin.invalid-output`, `plugin.invalid-diagnostic`, `plugin.protocol-violation`, `plugin.process-exited`;
- Provider boundary: `provider.unavailable`, `provider.request-failed`, `provider.rate-limited`, `provider.invalid-response`;
- validation/outcome: `guard.blocked`, `guard.inconclusive`, `run.timeout`, `run.cancelled`, `run.no-primary`;
- observability/runtime: `observer.failed`, `observer.detached`, `internal.failure`.

The catalog is extended only when Hosts need distinct recovery behavior; human wording changes without adding codes. Schema validation prevents unknown structured `data`, and Hosts switch on code—not title or detail.

**Debug Record** is richer, ephemeral, and potentially sensitive. It may include an exception type, message, stack, process exit information, bounded stderr tail, and sanitized local context. It is referenced from the in-memory diagnostic journal, not embedded in a normal Result.

Expected Plugin failures use an SDK failure constructor with a registered code and schema-valid data. Unexpected throws are caught at every Plugin, Provider, observer, and lifecycle boundary and normalized to a generic core Diagnostic. The Kernel, not the Plugin, stamps trusted identity, source, Run/Phase correlation, and sequence.

## Enforcement pipeline

1. TypeScript catches authoring mistakes where possible.
2. The manifest registers diagnostic codes and their data schemas.
3. Manifest validation checks namespaces and declarations.
4. Runtime boundaries validate every returned failure record.
5. The Kernel stamps trusted fields and applies size limits and redaction.
6. Unknown or invalid records become `meta-prompt.plugin.invalid-diagnostic`.
7. The final Result is validated before it crosses a Host or wire boundary.

An isolated Plugin returns a conceptual payload such as:

```json
{
  "outcome": "failure",
  "failures": [{ "code": "acme/provider.rate-limited", "data": { "retryAfterMs": 500 } }],
  "debug": { "exception": { "type": "Error", "message": "...", "stack": "..." } }
}
```

The `debug` member is requested only when debug capture is enabled, then validated, truncated, sanitized, and excluded from model input, public Results, and persistence by default.

## Failure ownership

- The Kernel generates timeout and cancellation Diagnostics because it owns those boundaries.
- A supervised process exit becomes `meta-prompt.plugin.process-exited`; exit code, signal, last method, and stderr tail are debug-only.
- Provider errors are normalized by the Provider Plugin into its registered portable codes.
- Go and Host Adapters consume the safe Result and Events; they never infer an operational failure from stderr.
- Optional enhancement failure returns a degraded Result whose primary origin is `original`.
- A Guard can deliberately return `blocked` when a Recipe or Host policy is fail-closed.

## Capture and persistence

The Kernel keeps a bounded, ephemeral per-Run journal of Events, Diagnostics, and Debug Record references. It disappears after the Run unless an explicit Observer retains it.

Capture levels are `none`, `metadata`, `debug`, and `content`. Content capture is a separate opt-in from debug capture. Credentials are never capturable. The development tools render an error tree, graph, timing, configuration provenance, Patch history, input/output diff, warnings, and a sanitized support bundle.

No telemetry is enabled by default. The event model is compatible with OpenTelemetry concepts and W3C trace propagation, but the Kernel does not depend on an OTel SDK or exporter. Console, JSONL, OpenTelemetry, Sentry, Langfuse, and similar integrations are Observer Plugins. Export and persistence are separate choices.
