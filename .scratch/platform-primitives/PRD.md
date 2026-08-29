# Platform runtime primitives

Status: ready-for-human

GitHub projection: [issue #2](https://github.com/iamaamir/promptiris/issues/2)

## Goal

Adopt platform primitives that make Prompt Iris runtime ownership explicit without expanding the atomic Plugin output protocol. A Run owns cancellation and deadlines, activated implementations own explicit asynchronous disposal, Hosts can consume bounded Event streams, debug failures remain structured and opt-in, Node carries operational correlation without content, and selected local Plugins load lazily only after Host authorization.

## Boundaries

- Preserve stateless and fail-open runtime behavior.
- Keep synchronous `RunContext.emit` compatible while adding bounded asynchronous observation.
- Do not add streamed Plugin outputs, network Plugin loading, authority grants, persistent debug storage, or ambient user content.
- Treat Host policy as the authorization authority.
- Update the reusable agent-native repository article and companion skill when the lifecycle lessons generalize beyond Prompt Iris.

## Acceptance

- Caller cancellation and owned deadlines are first-wins and deterministically classified.
- Owned listeners, timers, Plugin implementations, native processes, and subscriptions dispose idempotently.
- Event publication is ordered, bounded, reentrancy-safe, observer-isolated, and ends with one final terminal Event.
- Late in-process Plugin outcomes cannot alter Results or emit Debug Records after cancellation wins.
- Debug Records are bounded, opt-in, exception-isolated, and document destination redaction and retention obligations.
- Lazy Plugin entrypoints are package-relative, realpath-contained, explicitly authorized before import, and manifest-matched before activation.
- Node execution context carries immutable operational identifiers only.
- Every changed governed target remains above 90% mutation and checked-in mutation debt does not regress.
- Candidate and full verification pass at the exact Candidate revision.
- An independent Reviewer reports no unresolved blocker or high findings.

## Work items

- [x] [01 — Runtime lifecycle and loading](./issues/01-runtime-lifecycle.md)
