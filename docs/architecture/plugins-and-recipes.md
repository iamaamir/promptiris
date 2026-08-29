# Plugins and Recipes

## Plugin contract

A manifest declares a namespaced ID, package SemVer, protocol version, engine range, Plugin type and entrypoint, contributions, dependencies, conflicts, capabilities, Permission Hints, configuration schema, diagnostic and custom-event schemas, and lazy activation conditions. The manifest is authoritative; package tags only aid discovery.

The Node loader resolves a declared relative entrypoint beneath the Plugin package's real path, requests Host authorization, and only then dynamically imports selected code. Absolute, network, traversal, and symlink-escaping entrypoints are rejected, and the loaded Registration must match the selected manifest. Discovery never executes code.

The authoring API centers on `definePlugin(...)`. It infers a Plugin's configuration, services, hooks, Artifacts, and events while checking its public contract. Plugin authors depend on `@promptiris/plugin-sdk` as a peer dependency and should not import Kernel internals.

Runtime JSON Schema is authoritative across languages. TypeScript types are inferred where possible. Public types use controlled package exports and instance-scoped generics; global module augmentation is not required.

## Contribution rules

- Plugins receive immutable snapshots.
- Plugins return Patches, Artifacts, assumptions, clarifications, Diagnostics, and Events.
- The Kernel stamps provenance and applies changes.
- Read-only work may run concurrently; mutators do not.
- A Plugin must register its diagnostic codes and any custom event schemas.
- Core event and diagnostic namespaces are reserved.
- Unsupported or undeclared behavior is rejected at a boundary.

## Native and declarative Plugins

Declarative Plugins are preferred for portable, low-risk contributions. V1 supports templates and assets, Recipes, configuration and output schemas, static mappings/profiles, JSON Schema validation, a small set of Kernel-owned predicates, and explicit Patch templates. It does not invent a general scripting language.

Arbitrary algorithms, I/O, loops, or provider integrations use native Plugins. Third-party native Plugins run by default in supervised subprocesses behind a narrow JSON-RPC contract. A handshake verifies protocol, capabilities, schemas, and limits. Deadlines, cancellation, output size limits, and process reuse are supervised. A crash becomes a structured Diagnostic and does not crash the Host. Bundled or explicitly trusted native Plugins may opt into in-process execution.

This isolation contains faults and resources; it is not a complete security boundary.

Activated implementations may participate in explicit resource management through `Symbol.asyncDispose`. The Kernel owns reverse-activation-order disposal; adapters keep cleanup idempotent and preserve their existing timeout, cancellation-grace, and forced-containment semantics.

### Native Plugin supervisor profile

V1 defines deterministic defaults so “supervised” has the same meaning across Hosts:

| Limit                              |   Default |                     Absolute v1 ceiling |
| ---------------------------------- | --------: | --------------------------------------: |
| Content-Length header              |     8 KiB |                                   8 KiB |
| JSON frame                         |     8 MiB | 32 MiB after initialization negotiation |
| JSON nesting                       | 64 levels |                               64 levels |
| Inline Artifact value              |     4 MiB |          8 MiB subject to frame ceiling |
| Event `data`                       |    64 KiB |   256 KiB for registered content Events |
| Progress Event `data`              |     8 KiB |                                   8 KiB |
| Safe Diagnostic                    |    32 KiB |                                  32 KiB |
| Captured Debug Record              |   256 KiB |                                 256 KiB |
| Retained stderr tail               |    64 KiB |                                  64 KiB |
| Concurrent invocations per process |         1 |         32 when declared and negotiated |

All sizes measure serialized UTF-8 bytes before framing. Oversized values fail before sending or are rejected before parsing; they never truncate into schema-valid data. Large content uses Resource References. JSON rejects duplicate object keys, non-finite numbers, invalid Unicode, unknown envelope fields, and excessive nesting.

The supervisor continuously drains stderr to avoid pipe deadlock, retains only the rolling tail when debug capture is enabled, and otherwise counts then discards it. stderr is never a protocol or Result channel. Repeated truncation produces one coalesced metadata Event rather than recursive logging.

Initialization must complete within 5 seconds and Plugin activation within 10 seconds unless a Host deliberately configures a smaller bound. An invocation cannot outlive the remaining Run deadline. On cancellation the supervisor sends `plugin/cancel`, allows 500 ms for cooperative completion, then terminates the default single-invocation process. Engine shutdown sends `plugin/shutdown`, waits 2 seconds, requests graceful process termination, waits another 2 seconds, then force-kills. Platform-specific termination is normalized to the same Events and Diagnostics.

Native Plugins are single-invocation by default even though their hook contract must be reentrant. A manifest may declare higher concurrency only after passing concurrent conformance tests; initialization negotiates the lower Host/Plugin limit. A crash never retries the interrupted invocation. The process may restart lazily for a later invocation; three exits within 60 seconds quarantine that Plugin instance for the Engine lifetime and produce a stable Diagnostic. A new Engine or explicit development reset clears quarantine.

Processes launch without a shell, with explicit executable/arguments, a minimal Host-controlled environment, the Plugin package as working directory, and only authorized credential references. Hosts remain responsible for filesystem, network, process, and operating-system sandbox enforcement.

## Permissions and trust

Prompt Iris does not implement RBAC. Capability declarations are mandatory for compatibility. Permission Hints are lightweight metadata that a Host may authorize through a callback or enforce through its own sandbox. A permissive Host may trust all installed native Plugins; a restrictive Host may deny filesystem, network, process, or credential access.

Credentials are logical references. Resolution order is explicit injection, environment, keychain/helper, then a custom credential Plugin. V1 needs environment and programmatic injection. Only the selected Provider receives credential material; credentials must never enter Results, Events, Diagnostics, debug bundles, or model content.

## Recipes and overlays

A Recipe names its input capabilities, Plugin graph, configuration, failure policy, and output contract. It is the unit users activate.

An overlay may extend at most one base Recipe and supports four exact operations: add, replace, remove, and configure. Reusable fragments prevent duplication without creating multiple inheritance. Targets use exact contribution IDs; missing targets, removal of required dependencies, conflicts, and cycles are compilation failures. Wildcard replacement is not allowed. Compilation flattens the graph and records provenance in the lockfile.

Example conceptually:

```json
{
  "id": "acme/enhance-with-memory",
  "extends": "promptiris/enhance",
  "changes": [{ "op": "add", "phase": "analyze", "plugin": "acme/memory-context" }]
}
```

Both Recipes remain installed and addressable. Only the selected one runs.

## Distribution and discovery

V1 discovers explicitly installed npm and local packages. It never installs packages while processing a Run. npm/GitHub topics such as `promptiris-plugin` and type-specific variants support catalog searches, while manifests decide compatibility. Pi-hosted packages may also use `pi-package`.

The lockfile records exact package versions, sources, and integrity. Package version, SDK version, and protocol version are separate because they evolve for different reasons. A centralized registry can be added later without changing the manifest contract.

## Retries, queues, and durability

The Kernel provides IDs, deadlines, cancellation, bounded internal queues, retryability metadata, and structured failure Events. It does not provide a durable queue or dead-letter queue. Retries, rate limiting, circuit breakers, durable delivery, failure sinks, and replay belong in Plugins or Hosts. The Kernel never automatically retries an entire pipeline; a Provider may perform a small, declared retry for a transient call.
