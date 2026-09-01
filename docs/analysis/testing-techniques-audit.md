# Testing Techniques Audit

> Deep analysis of each testing technique: is it already in use, and what are the strongest candidates if it isn't?

## Repo Architecture Summary

Before evaluating each technique, here's the landscape that matters:

| Layer | Key Components | Stateful? | Network? | Cross-language? |
|-------|---------------|-----------|----------|-----------------|
| `packages/protocol` | JSON Schema (Ajv), JSON-RPC framing, Content-Length decoder | No | No | Yes (shared with Go) |
| `packages/core` | EventDispatcher, TransformationState, PluginGraph, ConfigurationResolution, RunLifetime | **Yes** | No | Partially |
| `packages/plugin-sdk` | Plugin manifest, declarative plugins | No | No | No |
| `apps/runtime-node` | RuntimeServer (JSON-RPC), NativePluginSupervisor (child process), LazyPlugin | **Yes** | No | Yes (Go CLI client) |
| `apps/cli-go` | JSON-RPC client, schema validation, transformation helpers | Minimal | No | Yes (Node runtime) |
| `apps/dashboard` | HTTP telemetry server | No | HTTP | No |

---

## 1. Concurrency Testing (fast-check scheduler)

**Status: NOT IN USE**

The `test-strategies.json` defines this strategy (`id: "deterministic-scheduling"`) with `gateMode: "affected"`, but zero files in the repo import or call `fc.scheduler`. The repo has complex concurrent components tested only with hand-written async scenarios.

### Strongest Candidates

**EventDispatcher** (`packages/core/src/event-dispatcher.ts`) — The single best candidate. The existing `event-dispatcher.test.ts` has 13 hand-written tests covering reentrant publication, lagging observers, and terminal ordering. But the interleaving space between `subscribe`, `emit`, `complete`, `dispose`, and `next` across multiple observers with different capacities is enormous. `fc.scheduler` could systematically explore Promise interleavings that hand-written tests miss:
- Reentrant emission from a sink callback while observers are mid-read
- Concurrent `dispose()` and `emit()` on the same observer
- Multiple observers reading at different rates while `complete()` fires
- `next()` called concurrently on the same subscription (the existing test checks the error, but not every interleaving)

**NativePluginSupervisor** (`apps/runtime-node/src/native-plugin.ts`) — The `RpcRequest` class races timeout, abort signal, process exit, protocol error, and data arrival. The existing tests cover specific scenarios, but `fc.scheduler` could exercise interleavings of:
- Abort signal firing during in-flight request
- Process exit arriving between `initialize` and `invoke`
- Protocol error and timeout arriving nearly simultaneously
- `dispose()` called while a request is mid-flight

**RunLifetime** (`packages/core/src/run-lifetime.ts`) — The parent-abort vs timeout race is tested with fake timers, but `fc.scheduler` could verify that no interleaving of `dispose()`, parent abort, and timeout can leave the signal in an inconsistent state.

---

## 2. Coverage-Guided Fuzzing (jazzer.js)

**Status: NOT IN USE**

`test-strategies.json` defines this (`id: "coverage-guided-fuzzing"`) with `gateMode: "capability-triggered"`. No Jazzer.js dependency or configuration exists.

### Strongest Candidates

**JSONC Parser** (`packages/core/src/configuration-jsonc.ts`) — Parses untrusted JSONC text with comments, trailing commas, and encoding edge cases. This is the primary attack surface for malformed input. Jazzer.js could evolve inputs toward unexplored parsing paths in the Ajv schema validation pipeline.

**Content-Length Decoder** (`packages/protocol/src/index.ts`) — The `ContentLengthDecoder.push()` method performs buffer manipulation with boundary checks (`MAX_FRAME_BYTES`, header parsing, partial-read accumulation). A fuzzer could discover buffer overflows, integer overflows in length parsing, or partial-header edge cases that hand-written tests don't cover.

**JSON Schema Validators** (`packages/protocol/src/index.ts`) — `validatePromptDocument` and `validatePatch` compile Ajv schemas that process arbitrary JSON. Fuzzing could find inputs that bypass validation or cause Ajv to throw unexpected errors.

**Go CLI Schema Validation** (`apps/cli-go/schema.go`) — Uses `jsonschema/v6` to validate Run Results. Coverage-guided fuzzing could find validation bypasses or panics in the Go JSON schema compiler.

---

## 3. Differential Testing

**Status: PARTIALLY IN USE**

This is the most interesting finding. The repo already has a differential testing pattern, though it's not labeled as such:

- `spec/fixtures/transformation-state.json` is a **shared fixture consumed by both TypeScript and Go implementations** of the same transformation logic
- `packages/core/src/transformation-state.test.ts` (line 172) loads this fixture and runs it through the TS `applyPatch`
- `apps/cli-go/transformation_test.go` (line 44) loads the same fixture and runs it through Go `validateSelector` / `RebaseSelector`
- `spec/fixture-consumers.json` explicitly maps this fixture to both consumers

The integration test (`scripts/test-integration-identity`) also acts as a differential test: it runs the Go CLI against the Node runtime and verifies the output matches expected values.

### Strongest Candidates for Expansion

**Go CLI → Node Runtime JSON-RPC** — The Go `protocol.go` implements the same Content-Length framing as the TS `protocol.ts`. A generator-based differential test could send arbitrary JSON-RPC messages through both implementations and compare behavior.

**Schema validation** — Both `packages/protocol` (Ajv) and `apps/cli-go/schema.go` (jsonschema/v6) validate the same Run Result schema. Generating arbitrary JSON and feeding it to both validators would expose any divergence.

**Transformation helpers** — The Go `ScalarToByteOffset` / `ByteToScalarOffset` implement the same Unicode scalar offset logic as the TS `transformation-state.ts`. The existing fixture covers known cases, but a generator could produce arbitrary Unicode strings and compare results.

---

## 4. Metamorphic Testing

**Status: PARTIALLY IN USE**

The repo has metamorphic relations embedded in property tests, but no systematic framework:

- `plugin-graph.property.test.ts` asserts that `compilePluginGraph` output is **independent of manifest discovery order** and **preserves dependency chains regardless of contribution order** — these are metamorphic relations (the output should be invariant under input permutation)
- `transformation-state.test.ts` asserts that **applying a stale-revision patch always fails** and **applying a valid patch always succeeds** regardless of the content — another metamorphic relation

`test-strategies.json` defines this (`id: "metamorphic"`) with applicability to "normalization, serialization, transformation, ranking."

### Strongest Candidates

**Configuration Resolution** (`packages/core/src/configuration-resolution.ts`) — Merges configuration layers with policies. Metamorphic relations:
- Merging the same layer twice should produce the same result (idempotency)
- Adding an empty layer should not change the result
- Swapping two independent layers (different pointers) should not change the result

**Plugin Graph Compilation** — Already partially covered, but could be extended:
- Adding a plugin with no contributions should not change the graph
- Selecting a subset of plugins should produce a subgraph of the full selection

**JSON-RPC Framing** — Round-trip metamorphic relation:
- Encoding a message and decoding it should produce the same message
- Encoding a message that exceeds `MAX_FRAME_BYTES` should always throw

---

## 5. Contract Testing (Pact)

**Status: NOT IN USE**

`test-strategies.json` defines this (`id: "service-contract"`) with `gateMode: "capability-triggered"`. No Pact dependency or configuration exists.

### Assessment

**Not immediately needed.** The repo currently has no independently deployed HTTP services. The Go CLI communicates with the Node runtime via stdio JSON-RPC, not HTTP. Pact is designed for HTTP consumer-provider contracts.

The closest equivalent is the **shared fixture approach** already in use: `spec/fixtures/transformation-state.json` acts as a contract between the Go and TypeScript implementations, and `spec/fixture-consumers.json` enforces that both consume it.

**Future candidate:** If the runtime exposes an HTTP API (the `inspect`/`doctor` methods are natural candidates), Pact would become relevant.

---

## 6. Schema-Driven API Fuzzing (Schemathesis)

**Status: NOT IN USE**

`test-strategies.json` defines this (`id: "schema-api-fuzzing"`) with `gateMode: "capability-triggered"`. No Schemathesis dependency or configuration exists.

### Assessment

**Not immediately needed.** The dashboard server (`apps/dashboard/server.mjs`) is the only HTTP endpoint, and it's extremely simple (3 routes, no authentication, no complex request bodies). The Go CLI → Node runtime communication uses stdio, not HTTP.

**Future candidate:** If the runtime exposes an OpenAPI-documented HTTP API, Schemathesis would be the right tool. The JSON-RPC protocol could also be fuzzed, but that's better suited to a custom fuzzer or Jazzer.js.

---

## 7. Fault Injection (Toxiproxy)

**Status: NOT IN USE**

`test-strategies.json` defines this (`id: "network-fault-injection"`) with `gateMode: "capability-triggered"`. No Toxiproxy dependency or configuration exists.

### Assessment

**Not immediately needed.** The repo has no network dependencies. The Go CLI communicates via stdio pipes, not TCP. The `NativePluginSupervisor` spawns local child processes, not network services.

**Future candidate:** If the runtime adds network-based provider connectivity (the `doctor` checks include `provider-connectivity` and `provider-authentication` as deferred checks), Toxiproxy would become relevant for testing retry policies and connection resilience.

---

## 8. Real-Dependency Testing (Testcontainers)

**Status: NOT IN USE**

`test-strategies.json` defines this (`id: "real-dependency"`) with `gateMode: "capability-triggered"`. No Testcontainers dependency or configuration exists.

### Assessment

**Not immediately needed.** The repo has no external infrastructure dependencies (no databases, message brokers, or external services). All state is in-memory or filesystem-based.

**Future candidate:** If the runtime adds persistence (e.g., a run history database, plugin registry, or caching layer), Testcontainers would be appropriate.

---

## 9. Type-Level Testing (tsd)

**Status: NOT IN USE**

`test-strategies.json` defines this (`id: "type-contract"`) with `gateMode: "affected"`. The description notes: "tsc now; tsd when a public declaration surface requires it." No `tsd` dependency or `.test-d.ts` files exist.

### Assessment

**Partially needed.** The packages export public TypeScript APIs (`PluginManifest`, `Event`, `RunResult`, `Patch`, etc.) that downstream consumers depend on. The existing tests verify runtime behavior but not compile-time type contracts.

However, the current API surface is relatively simple (mostly interfaces and type aliases, few generics), so `tsc` alone catches most type issues. `tsd` would become valuable if:
- Generic inference contracts need testing (e.g., `Event<T>` parameterization)
- Type narrowing behavior needs verification (e.g., discriminated union exhaustiveness)
- Declaration file accuracy needs enforcement

**Strongest candidates:**
- `packages/protocol` — The `Event<T>`, `JsonRpcMessage` discriminated union, and `PatchOperation` union
- `packages/plugin-sdk` — The `definePlugin` return type preservation and `PluginRegistration` activation types

---

## 10. Accessibility Testing

**Status: NOT IN USE**

`PRODUCT.md` has an "Accessibility & Inclusion" section, but no automated a11y tests exist. The dashboard (`apps/dashboard`) serves HTML with a `Content-Security-Policy` but no `aria-*` attributes are tested.

### Assessment

**Low priority.** The dashboard is a minimal internal evidence viewer (3 HTML pages, no forms, no complex interactions). Automated a11y testing (axe-core, pa11y) would add cost without proportional value for this use case.

**Future candidate:** If the dashboard grows to include interactive components (forms, navigation, data tables), a11y testing would become relevant.

---

## 11. Model Checking (TLA+ / TLC)

**Status: NOT IN USE**

`test-strategies.json` defines this (`id: "model-checking"`) with `gateMode: "capability-triggered"`. No TLA+ specifications or TLC configuration exist.

### Strongest Candidates

**EventDispatcher** — The most complex stateful component. A TLA+ specification could formalize:
- The subscriber lifecycle (subscribe → read → dispose/detach)
- The event delivery guarantees (monotonic sequences, terminal event ordering)
- The reentrant publication invariant (sink callback emitting new events)
- The lagging observer policy (progress dropping, critical event detachment)

**NativePluginSupervisor** — The child process lifecycle has subtle state transitions:
- Spawning → initialized → invoking → shutting down → exited
- Timeout vs abort vs protocol error race conditions
- Concurrent invocation denial

**RunLifetime** — The parent-abort vs timeout race with disposal is a classic model-checking target.

---

## Additional Techniques (Not in the Original List)

These are already in use or strongly applicable:

### Architecture Testing (ast-grep) — ✅ IN USE

Custom rules in `tooling/ast-grep/rules/`:
- `no-disabled-tests` — Prevents `test.skip`, `test.only`, `it.skip`, `describe.only`, etc.
- `no-internal-workspace-imports` — Enforces public API boundaries (`@promptiris/protocol` not `@promptiris/protocol/src/internal.js`)

Each rule has snapshot tests in `tooling/ast-grep/tests/` with valid/invalid examples.

### Mutation Testing (Stryker) — ✅ CONFIGURED

`stryker.config.mjs` exists at the root. The `test:mutation` script runs Stryker with a Vitest runner. Production TypeScript files are registered as mutation targets via `scripts/register-mutation-target.mjs`.

### Golden-Master / Snapshot Testing — ❌ NOT IN USE

`test-strategies.json` defines this (`id: "golden-master"`) but no Vitest snapshots (`toMatchSnapshot`, `toMatchInlineSnapshot`) exist in the codebase. The shared fixtures under `spec/` serve a similar purpose but are manually maintained rather than auto-generated.

**Candidate:** The JSON-RPC response shapes from `RuntimeServer.handle()` would benefit from golden-master snapshots to detect accidental drift in protocol output.

### Cross-Language Shared Fixture Testing — ✅ IN USE

`spec/fixtures/transformation-state.json` is consumed by both TypeScript and Go tests. `spec/fixture-consumers.json` enforces this with a deterministic check (`scripts/check-generated`).

### Integration Testing (Go CLI → Node Runtime) — ✅ IN USE

`scripts/test-integration-identity` runs the full pipeline: build, Go CLI enhance/inspect/doctor against the Node runtime, with secret redaction verification and invalid-configuration rejection.

### CodeQL Security Analysis — ✅ IN USE

Custom query in `tooling/codeql/javascript/NativeProcessBoundary.ql` governs every Node process-launch API (`exec`, `execFile`, `fork`, `spawn`). The CI workflow runs security-and-quality analysis for both JavaScript/TypeScript and Go.

---

## Summary Matrix

| Technique | In Use? | `test-strategies.json` | Strongest Candidate | Priority |
|-----------|---------|----------------------|---------------------|----------|
| Concurrency (fc.scheduler) | ❌ | ✅ Defined | EventDispatcher | **High** |
| Coverage-guided fuzzing (Jazzer.js) | ❌ | ✅ Defined | JSONC parser, Content-Length decoder | **Medium** |
| Differential testing | ✅ Partial | ✅ Defined | Go↔TS schema validation | **Medium** |
| Metamorphic testing | ✅ Partial | ✅ Defined | Configuration resolution | **Medium** |
| Contract testing (Pact) | ❌ | ✅ Defined | N/A (no HTTP services) | Low |
| Schema API fuzzing (Schemathesis) | ❌ | ✅ Defined | N/A (no OpenAPI) | Low |
| Fault injection (Toxiproxy) | ❌ | ✅ Defined | N/A (no network deps) | Low |
| Real-dependency (Testcontainers) | ❌ | ✅ Defined | N/A (no infra deps) | Low |
| Type-level testing (tsd) | ❌ | ✅ Defined | Protocol discriminated unions | Low |
| Accessibility testing | ❌ | — | Dashboard (minimal) | Low |
| Model checking (TLA+/TLC) | ❌ | ✅ Defined | EventDispatcher | **High** |
| Architecture (ast-grep) | ✅ | — | No disabled tests, no internal imports | Already done |
| Mutation (Stryker) | ✅ | — | Production TypeScript | Already done |
| Golden-master snapshots | ❌ | ✅ Defined | RuntimeServer JSON-RPC output | Low |
