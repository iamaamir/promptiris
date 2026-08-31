# Enforce harness integrity across agents

Status: in-progress
GitHub issue: <https://github.com/iamaamir/promptiris/issues/28>
Branch: `harness-integrity`
Parent: .scratch/harness-integrity/PRD.md
Blocked by: none
Parallel-safe: no; owns shared development policy, verification, telemetry, and agent coordination scripts
Patch policy: 1
Golden changes: denied
Test deletion: denied
Allowed paths:

- `AGENTS.md`
- `.github/**`
- `.scratch/harness-integrity/**`
- `.scratch/verification-strategies/**`
- `apps/dashboard/**`
- `apps/runtime-node/src/native-plugin.test.ts`
- `apps/runtime-node/test/fixtures/native-plugin.mjs`
- `docs/agents/**`
- `docs/development/**`
- `knip.json`
- `package.json`
- `packages/core/src/transformation-state.test.ts`
- `scripts/**`
- `spec/schemas/**`
- `tooling/**`
- `tsconfig.base.json`

## Acceptance

- Agent orientation identifies branch, Work Item, worktree, base, lease, sibling worktrees, and integration-checkout misuse.
- Atomic local claims prevent duplicate Work Item ownership and converge to GitHub status without making GitHub authoritative.
- Tool Traces carry agent, worktree, branch, repository, and candidate identity into a repository-wide dashboard.
- Imported CI and every local worktree contribute to telemetry without duplicate traces.
- Candidate verification rejects weakened mutation/coverage policy, new suppressions/skips, and changed production files outside mutation governance.
- A base-revision diff firewall rejects unauthorized paths, test deletion, and unapproved golden drift.
- Tested AST laws reject disabled/focused tests, while sanitized Tool Traces record redaction counts.
- Discovery, gate, and orchestration capabilities are distinct and visible to humans in the dashboard.
- The strategy registry activates model, scheduler, differential, metamorphic, contract, fuzz, fault, real-dependency, type, and model-checking Evidence only on applicable surfaces.
- Transformation state passes generated model-command sequences with replayable seeds and paths.
- Reviewer, Hardener, and source-blind QA reports are schema validated and bound to the candidate content digest.
- Critical verifier surfaces require external ownership review.
