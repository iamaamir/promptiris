# Developer experience and implementation tooling

This document fixes the Phase 2 implementation baseline. Tool versions are pinned in the repository and release manifest, but the durable rule is to select supported stable releases and upgrade deliberately; Phase 1 calendar versions are not permanent architecture.

Implementation by humans and models follows the [agent-driven implementation operating model](./agent-operating-model.md). Every producer proposes an untrusted Candidate Change; repository-owned Evidence and the mandatory gauntlet authorize integration. The root `AGENTS.md` stays small, while `scripts/agent-context` will compile stage-specific local context from current state and deterministic analysis providers.

## Repository and toolchains

Use one pnpm workspace and one Go module. Do not add Turbo, Nx, Bazel, or another task graph until repository timings demonstrate a need that pnpm filters and native caches cannot meet.

The TypeScript implementation uses:

- the latest Node LTS line at implementation/release start (Node 24 is Active LTS as checked on 2026-08-26), pinned to an exact patch for release bundles;
- current stable TypeScript, ESM, NodeNext resolution, project references, declaration output, and `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `verbatimModuleSyntax`;
- pnpm with an exact `packageManager` declaration, one lockfile, `workspace:` dependencies, and a central dependency catalog;
- authoritative versioned JSON Schema files under `spec/`, generated TypeScript declarations, and CI drift checks;
- Ajv in strict/all-errors/non-mutating/no-network mode;
- `tsc --build` for type/declaration correctness and esbuild for the single production runtime bundle; and
- Vitest projects for unit, contract, integration, and conformance suites.

Use ESLint flat configuration for semantic/static rules and Prettier for stable source, JSON, Markdown, and YAML formatting. Architecture checks forbid imports from Kernel internals and cycles across public package boundaries. Do not make a formatter or linter part of runtime behavior.

The [code-quality and review standard](./code-quality-and-review.md) governs boundary typing, collection and platform-primitive choice, fixtures, suppressions, and semantic review. Exhaustive switches are enforced for typed unions. Unsafe narrowing assertions are forbidden first at configuration and runtime RPC boundaries and expand to other untrusted boundaries as existing debt is removed.

The Go implementation uses a supported stable Go line (Go 1.27 and 1.26 are supported as checked on 2026-08-26), `gofmt`, `go vet`, the race detector where supported, Cobra for the command tree, the standard library for process/HTTP/JSON where sufficient, and `santhosh-tekuri/jsonschema/v6` for protocol validation. One generated binding package consumes the same schemas/fixtures as TypeScript; generated code is never hand-edited.

## Public workspace surfaces

The initial workspace contains:

```text
apps/runtime-node/              private JSON-RPC application entrypoint
apps/cli-go/                    Go client and bundle launcher
packages/protocol/              schemas, generated TS types, protocol helpers
packages/core/                  Engine and Kernel
packages/plugin-sdk/            public Plugin authoring surface
packages/testkit/               fakes, collectors, conformance, failure injection
packages/devtools/              optional Observer and inspection renderers
packages/builtins/              identity/default-enhance/provider/guards/renderers
adapters/pi/                    official Pi Host Adapter
examples/plugin-minimal/        smallest native/declarative examples
spec/                           authoritative schemas and cross-language fixtures
evals/                          public corpus, rubrics, runners, and reports
docs/
```

Public npm packages are `@promptiris/protocol`, `@promptiris/core`, `@promptiris/plugin-sdk`, `@promptiris/testkit`, `@promptiris/devtools`, `@promptiris/builtins`, and `@promptiris/adapter-pi`. The Node application remains private. `@promptiris/cli` plus generated OS/CPU payloads is distribution machinery, not another Kernel API.

Every package has explicit `exports`; source/internal paths are not exported. The SDK is a peer dependency for third-party Plugins. Official packages use exact internal versions in release artifacts, while third-party peer ranges follow their tested SDK/protocol range.

## Plugin author journey

A first Plugin should be runnable in ten minutes without Kernel knowledge:

1. `promptiris dev init-plugin <directory>` copies a versioned minimal template for declarative or native form.
2. The author declares a namespaced ID, contributions, capabilities, schemas, dependencies, Permission Hints, and lazy activation in one manifest.
3. `definePlugin(...)` provides local type inference without global module augmentation.
4. `promptiris dev test-plugin <directory>` runs manifest/schema checks, lifecycle and cancellation conformance, undeclared-output checks, concurrency/reentrancy checks when claimed, and failure-injection fixtures.
5. `promptiris run <recipe> --plugin <directory> --trace` starts a fresh development Engine with the local Plugin explicitly activated—watching/reload never changes an already-running graph.
6. `promptiris inspect` displays the resolved graph, locked versions, capabilities, configuration provenance, permissions, and output contract before execution.

The optional `@promptiris/devtools` Observer is the standard development/debugging Plugin requested by the product design. It renders the Event tree, phase timings, graph, Patches, protected-selector checks, configuration trace, safe Diagnostic causes, diff, and sanitized support bundle. It is disabled by default, cannot affect a Result, and captures content only after separate explicit opt-in. `@promptiris/testkit` supplies fake Providers, deterministic clocks/IDs, event collectors, fixture builders, crash/timeout/invalid-frame injection, and shared conformance suites.

## User and host experience invariants

- `inspect` and `doctor` perform no model generation unless an explicit probe flag is accepted.
- Commands print stable primary data to stdout and progress/Diagnostics to stderr; `--json` is one Result and `--jsonl` is Events followed by the terminal Result.
- Default transformation failure returns the original and exits zero; `--strict` changes only the host exit policy, not the Run evidence.
- No first run wizard, install hook, Plugin discovery, or debug mode reads credentials or contacts a Provider unexpectedly.
- A missing configuration message names the JSON Pointer, expected schema, searched layers, and a copyable next action without printing secret material.
- Every asynchronous API accepts cancellation/deadline and has a terminal Result/Event path.

## Compatibility and releases

Public packages follow SemVer and declare their API through exports, schemas, and docs. `0.x` releases remain explicitly unstable; `1.0.0` occurs only after the Plugin/Host conformance suites pass and at least one external example Plugin has been built without internal imports.

The protocol negotiates supported major versions and optional capabilities. Within a protocol major, a message schema is immutable at its versioned `$id`; additive fields require a new schema version/capability and are not smuggled past strict validators. A breaking envelope, lifecycle, ordering, or required-method change creates a protocol major. During a major transition, the canonical runtime supports the previous major for at least one minor release when doing so does not preserve a security flaw.

Deprecations appear in types, runtime inspection, docs, and release notes for at least one minor before removal in the next major. Recipe and strategy assets carry both semantic versions and content digests because model behavior can change even when a TypeScript API does not. Evaluation reports lock every participating version.

Commits follow Conventional Commits. To satisfy the repository's emoji convention without breaking parsers, emoji follows the colon: `feat(core): ✨ add graph validation`, `fix(protocol): 🐛 reject duplicate keys`, `docs(phase-1): 📝 close design baseline`. Breaking changes use `!` and a `BREAKING CHANGE:` footer. Contributions use DCO 1.1 sign-off. The project license is Apache-2.0; Phase 2 creates `LICENSE`, `NOTICE`, `CONTRIBUTING.md`, `SECURITY.md`, and generated third-party notices before the first distribution.

## Quality gates

Quality is a set of independent claims, not one score. CRAP identifies risky structure combined with weak coverage; mutation testing measures whether executed tests constrain plausible implementation faults. Neither substitutes for requirements, invariant exploration, compatibility, runtime safety, security, performance, or trustworthy Evidence. A passing class never offsets a required failure in another class.

| Evidence class | Required deterministic defense |
| --- | --- |
| Structure | CRAP/cyclomatic complexity, duplication, dependency direction/cycles, dead code/dependencies, public-surface growth, and tested architecture rules. |
| Test sensitivity | Coverage floors plus mutation score, explicit survivor disposition, and explicit equivalent-mutant/exclusion Evidence. |
| Generated input/state space | Property-based, state-model, and fuzz testing with recorded seeds, minimized counterexamples, and promoted regression corpora. |
| Cross-implementation behavior | Shared TypeScript/Go/native/Host differential and conformance fixtures over normalized Results, Events, Diagnostics, and protocol effects. |
| Public compatibility | TypeScript API reports, Go exported-API comparison, schema/profile compatibility, generated binding drift, and release-to-release contract checks. |
| Runtime adversity | Race detection, cancellation and termination tests, leak/resource checks, and deterministic native-Plugin/Provider/observer fault injection. |
| Security and supply chain | Tested ast-grep/CodeQL policy, secret scanning, reachable dependency vulnerability and license checks, SBOMs, and artifact provenance. |
| Performance and resources | Versioned budgets for cold CLI startup, no-op and per-stage overhead, large-document latency, native-process startup, cancellation latency, peak memory/allocations, leaks, and bundle size. |
| Evidence integrity | Revision/input/tool/environment binding, deterministic seeds and replay, flake detection, clean-environment execution, and explicit invalidation. |
| Product behavior | Source-blind black-box procedures across CLI, Pi, JSON-RPC, installation/configuration, SDK examples, and failure fallback; blockers reduce to replayable Evidence or explicit adjudication. |

Every change runs formatting, lint, strict type checks, Go vet/tests, schema-profile lint, generated-file drift, unit tests, tested architecture rules, public API drift, dead-code/dependency hygiene, and affected conformance fixtures. Pull requests touching protocol, graph, Patch, config, supervision, Events/Diagnostics, public SDKs, or Result code also run affected differential fixtures, property/state-model/fuzz tests, mutation, and fault scenarios.

Randomized checks always print and store replay coordinates. A discovered minimal counterexample becomes a committed regression fixture or corpus entry. Retrying a failing test until green is not passing; quarantine requires a tracked defect and quarantined tests cannot protect an integration or release gate.

Release candidates additionally run:

- full native-Plugin fault tests (bad frames, stderr flood, hangs, cancellation, crash loops, oversized/deep JSON);
- race, termination, leak/soak, and resource-limit profiles where applicable;
- Host conformance for CLI and Pi;
- extracted-bundle smoke tests on every advertised OS/CPU tuple;
- full custom data-flow/security policy, secret, reachable dependency/license/vulnerability review, SBOM, and provenance generation;
- versioned latency, startup, memory/allocation, and artifact-size regression budgets;
- Default Enhance evaluation gates; and
- API/schema compatibility comparison against the latest stable release.

Coverage is a floor, not proof: protocol/Kernel safety packages require at least 95% branch coverage and other shipped TypeScript/Go packages 85%, with justified line-level exclusions. Graph ordering, Patch application/rebasing, selectors, config merging/provenance, result assembly, and frame parsing require property or fuzz tests. Flaky tests are quarantined only with a tracked defect and may not protect a release gate.

CRAP/complexity analysis and mutation testing are first-class Cleaner/Hardener evidence rather than optional reports. Exact package thresholds and performance budgets are calibrated during the first tracer bullets; high-risk protocol/Kernel surfaces receive the strictest profile. Candidate checks operate on affected code, integration checks reuse fresh Evidence and rerun invalidated dependency closures, and scheduled/release checks deliberately prove long-running or whole-bundle properties from controlled clean environments.

Quality providers use replaceable Tool or Verifier Adapters registered with the [tool-aware execution layer](./tool-aware-execution.md), but quality governance is not delegated to them. They are not Prompt Iris Plugins, and the standalone verifier never loads them through the runtime it is verifying. Each provider declares stable identity/version, applicability, inputs, output schema, cost class, cache/invalidation rules, sensitivity, and finding codes. The repository verifier selects the Quality Profile, validates Evidence freshness, dispatches standard Harness Events/diagnostics, and decides gate status. An adapter cannot waive another check, invent a private event channel, convert failure into success, or grant merge authority.
