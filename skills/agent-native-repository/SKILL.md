---
name: agent-native-repository
description: Audits, bootstraps, and evolves repositories so humans and disposable AI agents can re-orient quickly, route mechanical work to deterministic tools, preserve revision-bound evidence, and minimize cost per verified accepted task. Use when starting or improving agent-driven development, repository context handoff, deterministic quality gates, tool routing, parallel-agent workflows, or automation promotion.
---

# Agent-Native Repository

Build a repository that carries its agents. Treat models as untrusted reasoning and generation engines; let repository-owned evidence authorize completion.

## Choose a mode

- `audit`: inspect and report without writing.
- `bootstrap`: add the smallest useful Level 1 control loop.
- `adopt`: implement one explicitly selected maturity increment.
- `harden`: strengthen applicable deterministic evidence without lowering policy.
- `reorient`: compile a minimal continuation packet for a replacement worker.
- `evolve`: mine existing operational traces for reviewed automation candidates.
- `validate`: prove that the installed control plane works as documented.

Default to `audit` when the user has not authorized repository changes.

## Workflow

1. Read repository instructions and determine the exact repository root and current revision.
2. Run `scripts/repository-snapshot.sh <root>` when Bash and Git are available. Otherwise collect the same facts with native read-only tools.
3. Read [references/maturity-model.md](references/maturity-model.md), classify only demonstrated capabilities, and label unknowns rather than guessing.
4. For `reorient`, follow [references/reorientation.md](references/reorientation.md). For every other mode, follow [references/adoption-workflows.md](references/adoption-workflows.md).
5. Preserve existing conventions. Prefer existing commands, CI, issue tracking, documentation, and tools over new machinery.
6. Apply only the smallest authorized increment. Never install tools, rewrite CI, replace instructions, create telemetry, or enable network access without explicit authority.
7. Validate deterministic behavior. Bind evidence to the candidate revision or exact working-tree state.
8. Return a compact result: mode, maturity before/after, files changed, verification references, remaining gaps, and one recommended next increment.

## Non-negotiable rules

- Optimize total model cost per verified accepted task, never cheap calls in isolation.
- Reuse fresh evidence; do not repeat unchanged work.
- Do not delegate listing, searching, parsing, formatting, testing, or exit-code inspection.
- Keep the root agent constitution small and retrieve conditional guidance progressively.
- Store large logs outside model context and communicate by references.
- Treat roles as evidence boundaries, not a mandatory number of agents.
- Keep automation mining read-only. Generated automation never activates itself.
- Never weaken a test, threshold, security control, or acceptance criterion to make adoption pass.
- Keep local content collection and external telemetry disabled by default.
- Do not turn ordinary development scripts into a plugin platform without measured replacement pressure.

## Reference routing

- Read [references/principles.md](references/principles.md) when explaining or adapting the philosophy.
- Read [references/quality-gauntlet.md](references/quality-gauntlet.md) for `harden` or quality-profile design.
- Read [references/tool-routing-and-automation.md](references/tool-routing-and-automation.md) for `evolve`, capability routing, traces, events, or dashboards.
- Read [references/portability-and-extraction.md](references/portability-and-extraction.md) before publishing, packaging, or extracting this skill.
- The long-form rationale is [references/the-repository-is-the-runtime.md](references/the-repository-is-the-runtime.md); do not load it for routine execution.

Use templates as starting points, not overwrite payloads. Merge their intent with existing repository conventions and show material conflicts to the user.
