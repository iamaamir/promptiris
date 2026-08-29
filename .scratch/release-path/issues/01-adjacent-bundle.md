# Adjacent runtime bundle

Status: ready-for-agent

GitHub issue: <https://github.com/iamaamir/promptiris/issues/18>
Branch: `runtime-bundle`
Parent: ROADMAP.md
Blocked by: .scratch/host-path/issues/01-cli-surface.md
Blocks: .scratch/release-path/issues/02-release-evidence.md
Parallel-safe: no; owns platform payload layout, runtime launch discovery, and extracted-package smoke tests

## Outcome

Package the canonical private Node runtime as adjacent platform payloads that public Hosts can locate and launch predictably.

## Acceptance

- Supported OS/architecture/libc tuples, Node redistribution inputs, payload layout, and compatibility rules are explicit and pinned.
- Install, upgrade, offline cache, missing optional payload, corrupt payload, spaces-in-path, and executable-permission cases have deterministic behavior.
- Extracted tarballs launch the runtime and complete the identity and enhance smoke paths without repository files.
- Hosts verify expected payload identity/integrity before launch and provide actionable failure diagnostics.
- Licenses, notices, size budgets, Reviewer, Hardener, source-blind QA, and platform-matrix verification pass.
