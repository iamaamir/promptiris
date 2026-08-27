# T002-03 — Bounded native plugin supervisor

Status: ready-for-agent

## Outcome

Prove one supervised local native plugin can negotiate, run, cancel, fail, and terminate through the runtime-neutral framed protocol.

## Boundaries

- Spawn without a shell, with explicit arguments, plugin working directory, and minimal inherited environment.
- Implement tracer-bullet limits and lifecycle only; leave pooling and persistent quarantine for later.
- Reuse the protocol package framing and error vocabulary where possible.

## Acceptance

- Public tests cover handshake plus successful invocation.
- Cancellation sends protocol cancellation before bounded termination.
- Timeout, early exit, malformed frame/response, and oversized output become normalized diagnostics.
- No failed invocation is automatically retried.
- The engine returns the last valid artifact under the default fail-open policy.
