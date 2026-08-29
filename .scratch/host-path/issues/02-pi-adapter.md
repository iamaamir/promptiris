# Official Pi Adapter

Status: ready-for-agent

GitHub issue: <https://github.com/iamaamir/promptiris/issues/14>
Branch: `pi-adapter`
Parent: ROADMAP.md
Blocked by: .scratch/host-path/issues/01-cli-surface.md, .scratch/resource-path/issues/01-resource-resolver.md, .scratch/discovery-path/issues/01-plugin-discovery.md, .scratch/devtools-path/issues/01-observer-devtools.md
Blocks: .scratch/release-path/issues/02-release-evidence.md
Parallel-safe: yes; owns only the Pi extension package, pinned Pi integration, and Host conformance fixtures

## Outcome

Ship a thin official Pi extension that transforms user input before model submission while exposing progress and preserving user control.

## Acceptance

- Manual, suggest, automatic, and confirmation modes use supported pinned Pi extension APIs and clearly show when enhancement is active.
- Progress maps standard Events to Pi UI; failures and cancellation preserve original input without aborting the Host workflow.
- Host policy owns permissions, Resources, secrets, and acceptance; the adapter does not fork Kernel behavior.
- Re-entry, concurrent inputs, unload/disposal, protocol mismatch, unavailable runtime, and upgrade behavior are covered.
- Installation and configuration docs include local development and packaged usage.
- Host conformance, mutation, Reviewer, Hardener, source-blind QA, and full verification pass.
