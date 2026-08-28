# Hosts, CLI, and official adapters

## Host boundary

A Host Adapter is a Plugin outside the transformation pipeline. It owns input interception, explicit Context collection, progress presentation, confirmation, fallback, and submission. It creates an Engine instance and maps Host capabilities into Prompt Iris capabilities.

The Kernel never crawls a workspace, chat history, or environment to infer Context. A Recipe declares required and optional Context capabilities; the Host supplies them or compilation reports what is missing.

Adapters must describe what their Host can actually do. A Host that can add context but cannot replace user input must not advertise transparent replacement. Shared adapter conformance tests verify input mapping, cancellation, progress, confirmation, fallback, and safe Diagnostic handling.

## Go CLI

The CLI is a real polyglot integration test. It is written in Go but calls the packaged canonical Node runtime over the application protocol.

V1 commands:

- `promptiris enhance`
- `promptiris run <recipe>`
- `promptiris inspect`
- `promptiris doctor`
- `promptiris trace`
- `promptiris plugins list`
- `promptiris recipes list`

Input may be positional, stdin, `--input`, an explicit Context source, or a structured JSON document. stdout contains only the primary output (or the selected `--json`/`--jsonl` representation); diagnostics and progress go to stderr.

An enhancement failure passes through the original Input and exits zero by default while reporting a degraded status. `--strict` makes transformation failure non-zero. Invalid CLI usage, invalid configuration, or protocol startup failures remain genuine non-zero errors.

The release bundle contains the Go executable and compiled Node runtime. V1 does not embed Node, start a daemon, or implement a second Kernel.

### CLI distribution

A release is one immutable, versioned adjacent-runtime bundle:

```text
promptiris/
  bin/promptiris[.exe]       # Go protocol client
  runtime/node[.exe]          # private pinned Node LTS binary
  runtime/promptiris.mjs     # bundled canonical runtime
  runtime/spec/               # authoritative schemas and fixtures needed at runtime
  manifest.json               # component/protocol versions and SHA-256 digests
  LICENSES/                   # project and redistributed dependency notices
```

The launcher resolves the private runtime relative to its own verified executable location, never from `PATH`, and starts it with explicit arguments and a minimal environment. The runtime and CLI still perform the application-protocol handshake; adjacency is packaging, not a reason to bypass compatibility checks. `doctor` verifies the manifest, executability, protocol negotiation, schema availability, and platform support.

V1 release targets are macOS arm64/x64, Linux glibc arm64/x64, and Windows arm64/x64, conditional on native CI for every shipped tuple and an official Node binary for the pinned LTS release. Unsupported tuples fail install visibly. Linux musl/Alpine and other architectures are deferred rather than served an untested binary.

Distribution channels share the same payload and manifest:

- `.tar.gz`/`.zip` GitHub release archives are the source payloads;
- `@promptiris/cli` selects one generated `@promptiris/cli-<os>-<arch>` optional platform package, following npm's `os`/`cpu` mechanism, so users do not download every runtime;
- a project-owned Homebrew tap consumes immutable checksummed archives for supported macOS/Linux tuples; and
- Windows users have the archive and npm path in v1, with WinGet/Scoop manifests added only after their install/upgrade tests exist.

The platform payload packages are generated release artifacts from this monorepo, not independently developed products. An install never downloads an executable in `postinstall`. npm, Homebrew, or manual archive replacement upgrades the whole bundle; there is no v1 self-updater and no independent Node/runtime/Go update that could create a split version.

Release CI verifies upstream Node signed checksums, builds each Go target, bundles JavaScript without runtime dependency resolution, executes conformance and smoke tests from the extracted artifact on its native runner, emits an SBOM and checksums, and creates build-provenance attestations. macOS and Windows binaries are code-signed/notarized when project signing identities are available; missing signing is a visible release limitation, never a silently skipped step.

Node single-executable applications are explicitly not the v1 path: their current active-development status, module-loading constraints, target caveats, and per-platform signing workflow add risk without removing the need for the Go executable. A future release may change only after the same artifact matrix passes.

## Pi and future adapters

The official Pi adapter ships in `adapters/pi` in the same monorepo and is part of v1. Pi's public extension lifecycle, verified on 2026-08-26, emits an asynchronous `input` event before skill/template expansion and accepts `continue`, `transform`, or `handled`; transformations chain in extension load order. This is the adapter's replacement boundary. Implementation pins and conformance-tests the actual Pi package version rather than relying forever on `main` documentation.

### Pi modes

The installed adapter changes nothing until enabled. Its interaction modes are:

- `confirm` — the default for eligible idle input with usable UI; run the selected Recipe, present a bounded diff/review, then return Pi's `transform` only after acceptance;
- `suggest` — show/copy the candidate without replacing the submitted text;
- `automatic` — explicitly opted-in transformation without review; and
- `manual` — run only through `/promptiris` (with `/promptiris-mode` for inspection/change).

`confirm` without a usable confirmation UI safely behaves as pass-through and emits a bounded notice; it never silently becomes automatic. The Adapter does not transform:

- `event.source === "extension"`, avoiding recursive interception;
- `steer` or `followUp` input while an agent is running, because added model latency could defeat urgent steering;
- slash-prefixed input, because Pi checks extension commands first and expands skills/templates only after the input hook; or
- empty/non-text input.

Attached images remain attached and byte-for-byte outside the transformed text. V1 may represent their presence as explicit opaque Context metadata, but Default Enhance neither reads nor rewrites them. A later modality Plugin can opt into their content under Host capability and policy.

The Adapter creates the Engine lazily on its first eligible action, feeds Pi cancellation into the Run, and closes session-scoped resources idempotently on shutdown/reload. It maps standard Run/Phase/Provider Events to one keyed Pi status indicator and clears it on every terminal path. Debug content does not appear in notifications. Decline, timeout, cancellation, invalid Result, missing Provider configuration, or any transformation failure returns `continue` with the exact original text and a safe Diagnostic summary.

The Prompt Iris transformation Model Binding is explicit and independent of Pi's selected target model. The Adapter may use Pi's current model metadata as target-adaptation Context only when the public API exposes reliable values; it never borrows Pi credentials ambiently. No session history is read or persisted unless a separately activated Plugin supplies that behavior.

The package participates in both Prompt Iris manifest discovery and Pi's package discovery conventions, including the `pi-package` keyword.

Codex and OpenCode adapters can follow later in the same repository. Host-specific limitations remain explicit; the common SDK must not be weakened into assumptions that only one Host supports.
