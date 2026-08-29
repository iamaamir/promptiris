# Plugin discovery, activation, and lockfile

Status: ready-for-agent

GitHub issue: <https://github.com/iamaamir/promptiris/issues/9>
Branch: `plugin-discovery`
Parent: ROADMAP.md
Blocked by: none
Blocks: .scratch/host-path/issues/01-cli-surface.md, .scratch/host-path/issues/02-pi-adapter.md, .scratch/release-path/issues/02-release-evidence.md
Parallel-safe: no; owns discovery metadata, lockfile, installation UX, and graph activation inputs

## Outcome

Discover explicitly tagged local or npm Plugins, lock resolved identity and integrity, and activate only selected entries.

## Acceptance

- Discovery consumes documented package metadata and tags, never executes package code, and produces deterministic candidates.
- Installation is an explicit Host operation; activation remains separate and uses the existing permission/capability graph.
- A versioned lockfile records source, package/version, manifest digest, integrity, entrypoint, and compatible protocol range.
- Offline, missing, duplicated, renamed, incompatible, tampered, and upgrade cases have stable diagnostics and recovery guidance.
- Third-party package managers and non-npm discovery can be added outside the Kernel.
- Supply-chain checks, mutation, Reviewer, Hardener, source-blind QA, and full verification pass.
