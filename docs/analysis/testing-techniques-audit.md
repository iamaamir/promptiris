# Testing Techniques Audit

> Technique-by-technique analysis: what the repository already uses, and the strongest candidates for what it does not. Describes the post-merge state, including the scheduler-based EventDispatcher suite.

## Repo Architecture Summary

| Layer | Key Components | Stateful? | Network? | Cross-language? |
| --- | --- | --- | --- | --- |
| `packages/protocol` | JSON Schema (Ajv), JSON-RPC framing, Content-Length decoder | No | No | Yes (shared with Go) |
| `packages/core` | EventDispatcher, TransformationState, PluginGraph, ConfigurationResolution, RunLifetime | **Yes** | No | Partially |
| `packages/plugin-sdk` | Plugin manifest, declarative plugins | No | No | No |
| `apps/runtime-node` | RuntimeServer (JSON-RPC), NativePluginSupervisor (child process), LazyPlugin | **Yes** | No | Yes (Go CLI client) |
| `apps/cli-go` | JSON-RPC client, schema validation, transformation helpers | Minimal | No | Yes (Node runtime) |
| `apps/dashboard` | Static telemetry asset server | No | HTTP | No |

---

## 1. Concurrency Testing (fast-check scheduler)

Status: **IN USE**

`packages/core/src/event-dispatcher.concurrency.test.ts` (8 tests) exercises `EventDispatcher` (`packages/core/src/event-dispatcher.ts`) three ways:

- **Lockstep model commands.** A `ModelWorld` mirrors the dispatcher at the externally observable level (global stamp order through one pending FIFO, per-observer queues, waiting readers, progress-drop coalescing, critical-overflow detachment, terminal preparation, sink order). Generated sequences of up to 40 subscribe/emit/complete/dispose/read commands (200 runs) drive model and real sides together; every read is compared immediately and every run ends in a full drain with exact per-observer and sink comparison.
- **Scheduler interleavings.** `fc.asyncProperty(fc.scheduler(), ...)` wraps competing emit/read/complete operations in `scheduleFunction`, drains them with `waitIdle`, and asserts the same lockstep exactness across generated schedules — including parked-waiter resolution, concurrent-read rejection, and emit-after-complete rejection, all order-dependent and all verified.
- **Deterministic edges.** Exact-sequence tests for lagging-observer detachment, selective sink failure, mid-delivery disposal, and multi-observer reentrant publication.

The suite is falsifiability-checked: a scoped Stryker run moves `event-dispatcher.ts` from the 93.13 baseline to 96.88 and kills 6 previously surviving mutants (asyncDispose delegation, return-discard flag, close guards, complete idempotency, report branching). The 5 remaining survivors are equivalent-by-invariant (unconditional post-shift reset, unreachable closed-enqueue, redundant waiter operand, unobservable terminal clear).

### Candidates for 1. concurrency testing

**NativePluginSupervisor** (`apps/runtime-node/src/native-plugin.ts`) — The `RpcRequest` class races timeout, abort signal, process exit, protocol error, and data arrival. `fc.scheduler` could exercise abort during in-flight requests, exit between initialize and invoke, and dispose mid-flight.

**RunLifetime** (`packages/core/src/run-lifetime.ts`) — The parent-abort versus timeout race is tested with fake timers, but scheduling could verify that no interleaving of dispose, parent abort, and timeout leaves the signal inconsistent.

---

## 2. Coverage-Guided Fuzzing (jazzer.js)

Status: **NOT IN USE**

`test-strategies.json` defines this (`id: "coverage-guided-fuzzing"`). No Jazzer.js dependency or configuration exists.

### Candidates for 2. coverage-guided fuzzing

**JSONC Parser** (`packages/core/src/configuration-jsonc.ts`) — Parses untrusted JSONC text. This is the primary malformed-input surface into the Ajv validation pipeline.

**Content-Length Decoder** (`packages/protocol/src/index.ts`) — `ContentLengthDecoder.push()` does buffer manipulation with boundary checks. A fuzzer could probe partial-header accumulation and length-parsing edges.

**Go CLI Schema Validation** (`apps/cli-go/schema.go`) — Uses `jsonschema/v6` on Run Results; coverage-guided fuzzing could find validation bypasses or panics.

---

## 3. Differential Testing

Status: **PARTIALLY IN USE**

The repo already differentials through shared fixtures: `spec/fixtures/transformation-state.json` is consumed by both `packages/core/src/transformation-state.test.ts` and `apps/cli-go/transformation_test.go`, and `spec/fixture-consumers.json` enforces the mapping. `scripts/test-integration-identity` runs the Go CLI against the Node runtime and compares output with expected values.

### Expansion candidates for 3. differential testing

**Go CLI to Node Runtime JSON-RPC** — Both sides implement Content-Length framing. A generator could send arbitrary messages through both and compare behavior.

**Schema validation** — Ajv (`packages/protocol`) and `jsonschema/v6` (`apps/cli-go/schema.go`) validate the same Run Result schema. Feeding arbitrary JSON to both would expose divergence.

**Unicode offsets** — Go `ScalarToByteOffset`/`ByteToScalarOffset` mirror the TS transformation helpers. Generated Unicode strings could extend the fixed fixture.

---

## 4. Metamorphic Testing

Status: **PARTIALLY IN USE**

Metamorphic relations already appear inside property tests: `plugin-graph.property.test.ts` asserts compile output is independent of manifest discovery order, and `transformation-state.test.ts` asserts stale-revision patches always fail. `test-strategies.json` defines this (`id: "metamorphic"`).

### Candidates for 4. metamorphic testing

**Configuration Resolution** (`packages/core/src/configuration-resolution.ts`) — Idempotency under duplicate layers, neutrality of empty layers, and order-independence for disjoint pointers.

**JSON-RPC Framing** — Encode/decode round-trip identity and guaranteed rejection above `MAX_FRAME_BYTES`.

---

## 5. Contract Testing (Pact)

Status: **NOT IN USE**

`test-strategies.json` defines this (`id: "service-contract"`). No Pact dependency exists.

### Assessment of 5. contract testing

**Not immediately needed.** No independently deployed HTTP services exist; the Go CLI talks to the Node runtime over stdio JSON-RPC. The shared-fixture approach already acts as the cross-language contract. Revisit if the runtime exposes an HTTP API.

---

## 6. Schema-Driven API Fuzzing (Schemathesis)

Status: **NOT IN USE**

`test-strategies.json` defines this (`id: "schema-api-fuzzing"`). No Schemathesis configuration exists.

### Assessment of 6. schema-driven api fuzzing

**Not immediately needed.** The dashboard serves static assets with no complex request bodies, and CLI-to-runtime traffic is stdio, not HTTP. Revisit for an OpenAPI-documented HTTP API.

---

## 7. Fault Injection (Toxiproxy)

Status: **NOT IN USE**

`test-strategies.json` defines this (`id: "network-fault-injection"`). No Toxiproxy configuration exists.

### Assessment of 7. fault injection

**Not immediately needed.** No network dependencies exist. Revisit if the runtime adds network provider connectivity with retry policies.

---

## 8. Real-Dependency Testing (Testcontainers)

Status: **NOT IN USE**

`test-strategies.json` defines this (`id: "real-dependency"`). No Testcontainers configuration exists.

### Assessment of 8. real-dependency testing

**Not immediately needed.** No external infrastructure dependencies exist. Revisit if the runtime adds persistence.

---

## 9. Type-Level Testing (tsd)

Status: **NOT IN USE**

`test-strategies.json` defines this (`id: "type-contract"`): tsc now, tsd when a public declaration surface requires it. No `.test-d.ts` files exist.

### Assessment of 9. type-level testing

**Partially needed.** Public APIs (`Event<T>`, `JsonRpcMessage`, `PatchOperation`, `definePlugin` return types) rely on tsc today, which suffices while the surface stays mostly interfaces and aliases. Revisit for generic-inference or narrowing contracts.

---

## 10. Accessibility Testing

Status: **NOT IN USE**

### Assessment of 10. accessibility testing

**Low priority.** The dashboard is a minimal static asset server with no forms or interactive components. Revisit if it grows interactive UI.

---

## 11. Model Checking (TLA+ / TLC)

Status: **NOT IN USE**

`test-strategies.json` defines this (`id: "model-checking"`). No TLA+ specifications exist.

### Candidates for 11. model checking

**EventDispatcher** — Subscriber lifecycle, delivery guarantees, reentrant publication, and lagging-observer policy remain the best formalization target; the lockstep model in the concurrency suite already encodes the transition rules a spec would start from.

**NativePluginSupervisor** — Child-process lifecycle and the timeout/abort/protocol-error races.

**RunLifetime** — The parent-abort versus timeout race with disposal.

---

## Additional Techniques

### Architecture Testing (ast-grep) — IN USE

Custom rules in `tooling/ast-grep/rules/` (`no-disabled-tests`, `no-internal-workspace-imports`) with snapshot tests, enforced by `pnpm quality:architecture`.

### Mutation Testing (Stryker) — IN USE

`stryker.config.mjs` with the Vitest runner and TypeScript checker, thresholds break 90, per-file floors in `tooling/quality/mutation-policy.json`. Production TypeScript registers via `scripts/register-mutation-target.mjs`.

### Golden-Master / Snapshot Testing — NOT IN USE

`test-strategies.json` defines this (`id: "golden-master"`) but no `toMatchSnapshot` calls exist. Candidate: `RuntimeServer.handle()` JSON-RPC response shapes.

### Cross-Language Shared Fixture Testing — IN USE

Enforced by `scripts/check-generated` against `spec/fixture-consumers.json`.

### Integration Testing (Go CLI to Node Runtime) — IN USE

`scripts/test-integration-identity` covers build, enhance/inspect/doctor, secret redaction, and invalid-configuration rejection.

### CodeQL Security Analysis — IN USE

`tooling/codeql/javascript/NativeProcessBoundary.ql` governs every Node process-launch API; CI analyzes TypeScript and Go.

---

## Summary Matrix

| Technique | In Use? | Strongest Candidate | Priority |
| --- | --- | --- | --- |
| Concurrency (fc.scheduler) | Yes (EventDispatcher suite) | NativePluginSupervisor, RunLifetime | Done; expand |
| Coverage-guided fuzzing (Jazzer.js) | No | JSONC parser, Content-Length decoder | Medium |
| Differential testing | Partial (shared fixtures) | Go to TS schema validation | Medium |
| Metamorphic testing | Partial (property relations) | Configuration resolution | Medium |
| Contract testing (Pact) | No | N/A (no HTTP services) | Low |
| Schema API fuzzing (Schemathesis) | No | N/A (no OpenAPI) | Low |
| Fault injection (Toxiproxy) | No | N/A (no network deps) | Low |
| Real-dependency (Testcontainers) | No | N/A (no infra deps) | Low |
| Type-level testing (tsd) | No | Protocol discriminated unions | Low |
| Accessibility testing | No | Dashboard (minimal) | Low |
| Model checking (TLA+/TLC) | No | EventDispatcher | High |
| Architecture (ast-grep) | Yes | - | Done |
| Mutation (Stryker) | Yes | - | Done |
| Golden-master snapshots | No | RuntimeServer JSON-RPC output | Low |
