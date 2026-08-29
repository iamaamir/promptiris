# Runtime lifecycle and lazy loading

The implemented runtime primitives complete existing v1 contracts without changing the atomic Plugin output protocol.

## Run lifetime

`createRunLifetime` owns one derived `AbortSignal`, an optional positive finite timeout, the parent-signal listener, and its timer. Parent cancellation and timeout are first-wins terminal causes. Disposal removes the listener and timer idempotently. `executePluginPlan` races in-process invocation against that signal, returns a fail-open `cancelled` Result with `promptiris.run.cancelled` or `promptiris.run.timeout`, and never accepts a late Plugin output.

Activated Plugin implementations may implement `Symbol.asyncDispose`. The Kernel registers them in activation order and disposes them in reverse order after execution. Disposal failure becomes a safe internal Diagnostic. The native Plugin adapter implements the hook through its existing bounded supervisor, so explicit disposal centralizes ownership without bypassing cancellation grace or force termination.

## Event dispatcher

`createEventDispatcher` is additive to the existing synchronous `RunContext.emit` interface. Every sink and subscriber observes the same Kernel-stamped Event identity and sequence. Each async subscriber owns a bounded queue:

- a full queue drops progress without blocking the Run;
- the first drop in a lag period produces one `promptiris.observer.progress-dropped` Event for other healthy consumers;
- a critical Event that cannot be queued detaches that subscriber and produces `promptiris.observer.detached` elsewhere;
- iterator return or async disposal removes the subscription; and
- dispatcher `complete(status)` detaches lagging observers first, publishes the terminal Run Event as the final Event, settles readers after queued delivery, and rejects later publication.

Async iteration currently streams Events only. `PluginImplementation.invoke` still returns one atomic `PluginOutput`; streaming Patches or Artifacts remains deferred until a protocol revision defines progress, backpressure, cancellation, and terminal commit.

## Debug Records and execution context

Debug capture is absent by default. An explicitly supplied `DebugRecordSink` receives bounded, ephemeral records for activation, invocation, and disposal failures. `Error.cause` and `AggregateError` relationships are retained with depth, count, text, and cycle bounds. Sink failure cannot change a Run, and Debug Records never enter Results or Diagnostics. A Host that retains, persists, or exports these records must authorize that observer path, apply its own bounded retention, and redact again at the destination boundary.

The Node adapter's `AsyncLocalStorage` carries only immutable operational identifiers such as Run, trace, Plugin, and contribution IDs. It normalizes away additional properties and does not carry Input, Context, configuration, credentials, or Plugin state. Workers and subprocesses require explicit propagation; ambient continuity is never assumed across those seams.

## Authorized lazy loading

`defineLazyPlugin` keeps discovery and module execution separate. A manifest declares a package-relative `entrypoint`; activation resolves real filesystem paths beneath an absolute package root, asks the Host authorization callback, and only then performs dynamic `import()`. Network specifiers, absolute entrypoints, traversal and symlink escape are rejected. The imported default Registration must exactly match the already selected manifest before its implementation activates.

The loader grants no authority and installs nothing. Supplying a discovered manifest does not execute it, and native third-party Plugins still use supervised subprocesses by default.
