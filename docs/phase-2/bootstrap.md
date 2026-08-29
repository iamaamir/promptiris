# Phase 2 development bootstrap

## Accepted slices

Four tracer bullets and a runtime-lifecycle deepening are operational. A Cobra-based Go CLI starts the private Node runtime over Content-Length-framed JSON-RPC, initializes protocol v1, runs the explicit bundled identity Recipe, receives namespaced standard Events, and returns a Run Result. A supervised native Plugin crosses the same boundary. The immutable transformation-state slice accepts typed, revision-aware Patches and Artifact proposals, applies them atomically, enforces exact protections, and exposes only Recipe-authorized public Artifacts. Configuration/capability inspection now traces provenance and evidence. The lifecycle deepening adds owned cancellation/deadlines, explicit Plugin disposal, bounded async Event subscriptions, opt-in structured Debug Records, operational Node execution context, and Host-authorized lazy local loading. These slices intentionally perform no model call and no enhancement yet.

The implementation preserves the product boundary—behavior remains Recipe and Plugin supplied—but the repository development harness is direct infrastructure, not another Plugin system. Scripts, pinned tools, compiler configuration, and CI jobs are allowed to remain boring and replaceable.

## Deterministic control plane

- `scripts/agent-context` compiles Git, active task, last verification, and capability state into a compact orientation packet.
- `scripts/tool-trace` stores raw output and a SHA-256 reference while returning only compact execution metadata unless a command fails.
- `scripts/tool-router` resolves semantic capabilities from `tooling/capabilities.json`.
- `scripts/lsp-query.mjs` provides bounded TypeScript and Go symbol, reference, and definition queries through pinned language servers. Compilers remain authoritative.
- `scripts/repetition-report` finds repeated task-command pairs without recording model reasoning or promoting automation automatically.
- `scripts/telemetry-analyze.mjs` combines versioned Tool Traces and retained quality reports into a machine-readable evidence summary. `pnpm dashboard` serves the same analysis through a loopback-only, read-only dashboard documented in [Repository evidence dashboard](../development/evidence-dashboard.md).
- `scripts/verify-candidate` is the single candidate verdict; `--full` adds the Hardener evidence profile.

## Quality evidence

The candidate profile verifies formatting, lint and complexity rules, portable JSON Schemas, strict types, builds, TypeScript/Go tests, Go vet, the cross-language integration tracer, ast-grep architecture policy, and Gitleaks.

The Hardener profile adds package-specific coverage floors (95% for protocol/core and 85% for other shipped TypeScript), measured Go coverage, CRAP analysis, Knip dead-code/dependency analysis, checked-in API Extractor reports, and Stryker mutation testing. Protocol framing also has deterministic property tests with a recorded seed. The Node stdio entrypoint is the only line-level coverage exclusion because it is process wiring exercised by the Go-to-Node integration test; the runtime server remains covered directly. Go coverage is reported independently and currently remains a visible improvement target rather than a merge threshold.

The mutation build-breaking threshold and every governed file baseline are at least 90%. The current transformation-state tracer baseline is 94.28% aggregate. Survivors remain present in the JSON report for disposition; no exclusion or survivor is silently converted into success.

## Reorientation

Run:

```sh
./scripts/bootstrap-tools
./scripts/agent-context
pnpm verify
```

Large reports and logs belong under ignored `.agent/` paths. Public API snapshots under `packages/*/etc/`, shared schemas, tests, Git history, and this document carry durable understanding between disposable agents.
