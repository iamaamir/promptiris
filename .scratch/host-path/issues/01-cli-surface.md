# Complete CLI surface

Status: ready-for-agent

GitHub issue: <https://github.com/iamaamir/promptiris/issues/13>
Branch: `complete-cli`
Parent: ROADMAP.md
Blocked by: .scratch/enhance-path/issues/02-guard-renderer.md, .scratch/resource-path/issues/01-resource-resolver.md, .scratch/discovery-path/issues/01-plugin-discovery.md
Blocks: .scratch/host-path/issues/02-pi-adapter.md, .scratch/release-path/issues/01-adjacent-bundle.md
Parallel-safe: no; owns Go CLI commands, UX, exit codes, streaming, and Host conformance

## Outcome

Make the Go CLI a complete reference Host for run, inspect, doctor, Plugin selection, Resources, and progress.

## Acceptance

- Commands and configuration precedence are documented, scriptable, and consistent with the runtime-neutral protocol.
- stdin, arguments, files, stdout/stderr, JSON output, TTY progress, cancellation, and exit codes have stable contracts.
- Optional transformation failures preserve original input and distinguish degraded success from command/configuration failure.
- The CLI never exposes secrets or mixes progress with machine-readable output.
- Cross-language fixtures and Host conformance cover success, fallback, cancellation, protocol mismatch, malformed runtime, and large output.
- Go race, integration, mutation-equivalent quality evidence, Reviewer, Hardener, source-blind QA, and full verification pass.
