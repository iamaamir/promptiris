# Slim agent constitution and point to policy

Status: in-progress

GitHub issue: <https://github.com/iamaamir/promptiris/issues/58>
Branch: `agents-policy-split`
Parent: none
Blocked by: none
Blocks: none
Parallel-safe: yes; owns AGENTS.md constitution text and CONTRIBUTING.md commit style
Patch policy: 1
Golden changes: denied
Test deletion: denied
Allowed paths:

- `AGENTS.md`
- `CONTRIBUTING.md`
- `.scratch/agent-docs/**`

## Outcome

Reduce always-loaded `AGENTS.md` to prime directive, three invariants, and pointers. Existing policy docs already own the details; no new policy files.

## Acceptance

- `AGENTS.md` keeps prime directive, verify/no-self-certify, claim-before-edit, and SHA-bound completion invariant plus links to operating-model, tool-aware-execution, code-quality-and-review, and issue-tracker.
- Rules 1-6, 8-11, 13-14, 17-18 move to pointers only; destinations listed in packet comments.
- `markdownlint` on `AGENTS.md` and `scripts/verify-candidate` integrity pass for docs-only delta.
- No production code, schema, or threshold change.

## Comments

- Destinations: R1/R4/R9/R10/R17 -> `docs/development/tool-aware-execution.md` + `tooling/capabilities.json` + `tooling/tasks.json` + `scripts/tool-router|tool-trace`; R2/R3 -> capability table + `agent-operating-model.md` context compiler + `scripts/agent-context`; R5 -> operating-model communication + `CONTRIBUTING.md`; R6/R7/R8 -> operating-model authority/evidence/loops + `scripts/verify-candidate`; R11/R12/R18 -> `code-quality-and-review.md` + `spec/schemas/reviewer-report.schema.json` + `tooling/quality/mutation-policy.json` + `sgconfig.yml`; R13 -> `CONTRIBUTING.md`; R14/R15/R16/R19 -> `docs/agents/issue-tracker.md` + `scripts/agent-work` + `scripts/finalize-candidate.mjs`.
