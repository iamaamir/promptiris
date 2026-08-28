# Configuration and capability tracer

The first configuration vertical slice accepts an explicit `promptiris.config.jsonc` path, validates it without executing code, resolves immutable schema-directed layers, and keeps provenance in a separate redacted trace. Credentials remain logical Secret References; this slice never resolves credential material or accesses a Provider.

Use the Go CLI against a built Node runtime:

```console
promptiris inspect --config ./promptiris.config.jsonc
promptiris doctor --config ./promptiris.config.jsonc
```

Both commands write one JSON value to stdout. Diagnostics go to stderr, and invalid configuration produces no partial stdout. `inspect` reports the resolved value, configuration trace, capability evidence, Permission Hints, and requirement decisions. `doctor` reports local configuration, schema, and runtime readiness while marking Provider connectivity, authentication, and model discovery as deferred. It performs no generation, network access, Plugin activation, or secret resolution.

JSONC permits comments and trailing commas but rejects duplicate or unknown keys. Resolution precedence is schema, Plugin, Recipe, Host, user, project, then Run. Objects merge only where the schema permits; arrays replace unless the schema declares append or union behavior. Host policy is applied as an explicit `allowed`, `forced`, `clamped`, or `denied` decision rather than as a hidden highest-priority layer.

Capability claims are scoped to an exact binding fingerprint and require evidence. Their result is `supported`, `unsupported`, or `unknown`; restrictions outrank weaker positive claims, and equal-strength conflicts fail inspection instead of guessing. Permission Hints are metadata for a Host decision, never proof that an operation is authorized.

Provider connectivity, authentication, model listing, capability conformance, user-global discovery, and repository-root configuration search are deferred to later tracer bullets. Until then, callers must pass `--config` explicitly.
