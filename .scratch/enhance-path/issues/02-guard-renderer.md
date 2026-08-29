# Default Guard and Renderer

Status: ready-for-agent

GitHub issue: <https://github.com/iamaamir/promptiris/issues/11>
Branch: `guard-renderer`
Parent: ROADMAP.md
Blocked by: .scratch/enhance-path/issues/01-default-enhance.md
Blocks: .scratch/enhance-path/issues/03-evaluation-harness.md, .scratch/host-path/issues/01-cli-surface.md
Parallel-safe: yes; owns bundled semantic Guard, deterministic Renderer, and fail-open integration

## Outcome

Validate enhancement semantics and render accepted transformation state without trusting model formatting.

## Acceptance

- Guard rejects instruction loss, protected-span changes, fabricated requirements, empty output, and unsafe size expansion through stable findings.
- Renderer deterministically materializes valid Patch state and never calls a model.
- Guard or Renderer failure emits standard diagnostics/events and returns the original input.
- Plugins can replace or extend both stages through ordinary graph composition.
- Property, mutation, adversity, Reviewer, Hardener, source-blind QA, and candidate verification pass.
