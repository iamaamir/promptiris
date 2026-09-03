# Agent constitution

Optimize for correctness and verified acceptance before efficiency. The target metric is total tokens and model cost per verified, accepted task—not tokens per individual call.

## Prime directive

> **Reason with models.**\
> **Compute with tools.**\
> **Search structurally.**\
> **Store state externally.**\
> **Communicate through references.**\
> **Verify deterministically.**\
> **Retrieve progressively.**\
> **Delegate narrowly.**\
> **Automate repetition.**\
> **Measure everything.**

## Invariants

- Verify every change before declaring completion. No Change Producer self-certifies, including maintainers and strong models.
- Before editing, claim the local Work Item with `scripts/agent-work claim PACKET AGENT_ID`; concurrent writers use separate worktrees and the integration checkout stays on `main`.
- Completion requires SHA-bound structured Reviewer, Hardener, and source-blind QA reports. A green mechanical job without those reports is incomplete. Only external maintainers decide whether to merge.

## Policy pointers

Read the linked policy when it applies; do not copy it into model context.

- Execution routing and tool use: [tool-aware execution](docs/development/tool-aware-execution.md), `tooling/capabilities.json`, `tooling/tasks.json`, `scripts/tool-router`, `scripts/tool-trace`.
- Context, search, and evidence reuse: [operating model](docs/development/agent-operating-model.md) (authority boundary, context compiler, evidence reuse, deterministic loops), `scripts/agent-context`, `scripts/verify-candidate`.
- Traces, promotion, and measurement: [tool-aware execution](docs/development/tool-aware-execution.md) (Tool Trace, Automation Promotion Loop, measurement), `spec/schemas/tool-trace.schema.json`, `CONTRIBUTING.md` (`.agent/` references, not large logs).
- Code, review, and quality gates: [code quality and review](docs/development/code-quality-and-review.md) (primitives, boundaries, structure, Reviewer contract, mutation targets), `spec/schemas/reviewer-report.schema.json`, `tooling/quality/mutation-policy.json`, `sgconfig.yml`, `.github/workflows/verify.yml`, `.github/workflows/policy-integrity.yml`.
- Work items, branches, and commits: [issue tracker](docs/agents/issue-tracker.md) (branch, worktree, lease, patch policy, gauntlet ownership), [triage labels](docs/agents/triage-labels.md), `scripts/agent-work`, `scripts/finalize-candidate.mjs`, `CONTRIBUTING.md` (Conventional Commits).

During the documentation-only phase, inspect repository state with deterministic tools. Once implemented, `scripts/agent-context` is the standard local orientation entrypoint. Commit style follows `CONTRIBUTING.md`.

## Agent skills

### Issue tracker

Authoritative Work Items live as Markdown under `.scratch/<feature>/` and are projected to GitHub Issues for assignment, discussion, and review. `ROADMAP.md` is the parent index; use `scripts/issue-sync push --all` to update the projection. See `docs/agents/issue-tracker.md`.

### Triage labels

Use `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Use the single root `CONTEXT.md` and `docs/adr/` layout. See `docs/agents/domain.md`.
