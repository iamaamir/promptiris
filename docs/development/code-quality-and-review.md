# Code quality and review

Quality means that behavior, structure, boundaries, and evidence remain understandable and enforceable when the original human or agent disappears. Passing tests are necessary; they do not excuse opaque code, accidental APIs, unsafe narrowing, hidden mutation, or an unsuitable abstraction.

## Language and platform primitives

Use the simplest primitive whose semantics match the problem:

| Need                                                     | Prefer                                                                | Avoid                                                                                         |
| -------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| JSON-shaped portable data                                | plain immutable records and arrays                                    | class instances, symbols, accessors, or proxies crossing serialization boundaries             |
| uniqueness or membership                                 | `Set`                                                                 | array scans and duplicate-prone registries                                                    |
| keyed process-local state                                | `Map`                                                                 | object dictionaries when keys are not JSON field names                                        |
| object-identity metadata                                 | `WeakMap`/`WeakSet`                                                   | enumerable or serialized state; relying on garbage collection timing                          |
| lazy or potentially large traversal                      | iterator/generator                                                    | eager intermediate arrays; generators for small bounded values that are clearer as arrays     |
| collision-resistant internal identity or a language hook | `Symbol` or a well-known symbol                                       | public wire/configuration keys that must serialize or interoperate across languages           |
| transparent interception as the actual contract          | narrowly scoped `Proxy`                                               | ordinary validation, configuration, or state where traps hide control flow                    |
| cancellation and deadlines                               | `AbortSignal` with one owner                                          | boolean cancellation flags, unowned timers, or accepting late async results                   |
| deterministic resource cleanup                           | `using`/`await using`, disposable stacks, well-known disposal symbols | cleanup scattered across success and failure branches or finalizers used for correctness      |
| ordered progressive delivery                             | bounded `AsyncIterable`                                               | unbounded queues, polling, or making slow observers block production work                     |
| preserving internal failure causality                    | `Error.cause`, `AggregateError`, `SuppressedError`                    | putting exceptions, stacks, or sensitive messages into portable Results                       |
| lazy implementation loading                              | authorized dynamic `import()`                                         | eager loading, importing discovered-but-unselected code, network or traversal ambiguity       |
| operational async correlation                            | runtime-scoped execution context                                      | ambient domain Context, credentials, Input, or correctness-critical state                     |
| isolated structured copying                              | `structuredClone` and explicit transfer                               | JSON stringify cloning, accidental shared mutation, or cloning values whose prototypes matter |
| binary representation                                    | `ArrayBuffer`, typed arrays, `DataView`, `Blob`                       | number arrays for bytes or embedding binary values in JSON protocols                          |
| canonical resource identifiers                           | `URL` and `URLSearchParams`                                           | ad hoc string concatenation or treating a URL as authorization                                |

Platform features are not a quota. A Reviewer must be able to name the semantic property gained—uniqueness, identity, laziness, disposal, or interception—and the tests that constrain it. `Proxy` requires trap-invariant, reflection, serialization, identity, and debugging consideration. Resource-owning iterators require explicit early-termination cleanup. Symbols never enter JSON, schemas, Events, Diagnostics, or cross-process protocols.

Cancellation, disposal, progressive delivery, and execution context form one lifecycle contract. A Reviewer checks ownership, terminal-state precedence, queue bounds, early return, idempotent cleanup, late completion, and observer isolation together. `WeakRef` and `FinalizationRegistry` never provide correctness-critical cleanup; `SharedArrayBuffer` and `Atomics` require measured cross-worker contention and race evidence before adoption.

## Boundaries and types

- External input begins as `unknown`. Narrow it with a runtime validator or type guard before property access or arithmetic.
- `unknown` is safer than a guessed domain type: it prevents use until proven. Do not replace it with `any`, a double assertion, or a generic that merely hides uncertainty.
- After validation, pass a named domain type. Keep the unvalidated region small and do not repeatedly cast the same value in downstream functions.
- Discriminated unions use exhaustive switches. A new variant must create a compiler/linter failure at every decision point.
- Assertions require a proof the type system cannot express, a narrow scope, and a test for the proof. Boundary assertions that narrow unvalidated data are errors on governed surfaces.
- Public types describe stable behavior, not implementation convenience. API-report changes require an explicit compatibility decision.

## Structure

- A function has one reason to change and a name that exposes its domain operation. Existing deterministic limits are complexity 10, nesting depth 4, and 40 non-comment lines per production function.
- Prefer early validation and small pure transformations. Isolate I/O, clocks, randomness, process control, and network access behind explicit boundaries.
- Choose collection types by invariant, not habit. A temporary-resource registry uses `Set`; ordered duplicates use an array; JSON field ownership uses a record.
- Centralize codecs and normalization. JSON Pointer escaping/unescaping, identifier parsing, failure normalization, and redaction have one implementation plus round-trip/adversarial tests.
- No abstraction is justified solely by possible future reuse. Two similar code fragments may remain separate when their change reasons and contracts differ.
- Suppressions are line-scoped, name the tool/operator, and explain why the alternative cannot change observable behavior. Broad file exclusions are rejected.

## Tests and fixtures

- Tests assert observable contracts and invariants, not private call order unless ordering is itself the contract.
- Fixtures represent a named interoperability or failure scenario. `spec/fixture-consumers.json` maps every shared fixture to an executable test/script and the verification gate that runs it; exact coverage, consumer existence, and direct reads are checked deterministically. Orphan coverage data and unexecuted filename mentions are rejected.
- Shared fixtures under `spec/` are stable cross-boundary examples. `project-configuration.jsonc` exercises the Go CLI to Node runtime `inspect`/`doctor` path: JSONC comments/trailing commas, a logical Secret Reference, required capability evidence, redaction, readiness, and no Provider call.
- Temporary files use unique system directories and an ownership collection with deterministic cleanup. Cleanup clears ownership before awaiting deletion so a failed delete cannot leak into a later test's registry.
- Property/fuzz failures preserve seed and minimized counterexample. A new counterexample becomes a regression test or shared fixture when it represents a portable contract.

The versioned strategy registry at `tooling/quality/test-strategies.json` compiles test-design
knowledge into applicability, Evidence, cost, and activation rules. Property tests are not a synonym
for model-based tests: state-model commands invent operation sequences, while the fast-check
scheduler controls Promise interleavings and records replay coordinates. Differential tests compare
two implementations or revisions; metamorphic tests assert a relation between transformed inputs
when neither exact output is conveniently known.

These are affected-surface gates, not a quota imposed on every patch. Jazzer.js, Pact, Schemathesis,
Toxiproxy, Testcontainers, `tsd`, and TLA+/TLC activate only after the Work Item touches the matching
parser, service, network, infrastructure, type-declaration, or distributed-state capability. Installing
an irrelevant tool creates cost without evidence. Discovery and measurement tools may guide work;
only capabilities classified as gates can satisfy acceptance.

Existing snapshots and golden artifacts are immutable by default. A model may not run an update
command to make unexpected drift pass. The base Work Item must authorize the behavior change, and
the diff remains subject to external review. The same trusted diff firewall rejects deleted tests,
out-of-scope paths, new suppressions, focused or skipped tests, and mutation/coverage weakening.

## Reviewer contract

The Reviewer receives the Work Item, exact base/candidate revisions, changed paths, smallest affected dependency neighborhood, public API/schema diff, and fresh deterministic Evidence. It does not receive private reasoning and does not repeat formatting, search, or test execution.

The Reviewer checks:

1. observable acceptance and failure behavior;
2. domain and boundary ownership;
3. validation before trust, redaction, permissions, and fail-open/fail-closed policy;
4. semantic fit of data structures and platform primitives;
5. public compatibility and cross-language behavior;
6. cancellation, resource cleanup, determinism, and concurrency where applicable;
7. tests that would fail for plausible defects, including the changed branch rather than only the happy path;
8. duplication, incidental abstraction, naming, and stale/dead paths;
9. every user/reviewer comment, with an accepted or rejected disposition and evidence; and
10. residual risk and deferred checks without converting them into claims.

Reports conform to `spec/schemas/reviewer-report.schema.json`. `blocker` and `high` findings must be resolved before completion. `medium` and `low` findings require an explicit disposition; silence is not resolution. A `pass` means no unresolved finding, not that the Reviewer certifies tests, security, or merge eligibility. Deterministic verification retains that authority.
