# Finalize candidate-bound role evidence

Status: in-progress
GitHub issue: <https://github.com/iamaamir/promptiris/issues/36>
Branch: `evidence-finalize`
Parent: .scratch/harness-integrity/PRD.md
Blocked by: .scratch/harness-integrity/issues/01-harness-integrity.md
Parallel-safe: no; extends the shared candidate and role-evidence protocol
Patch policy: 1
Golden changes: denied
Test deletion: denied
Allowed paths:

- `.scratch/harness-integrity/**`
- `.gitignore`
- `.github/workflows/policy-integrity.yml`
- `docs/agents/**`
- `docs/development/**`
- `package.json`
- `scripts/agent-work`
- `scripts/candidate-identity.mjs`
- `scripts/finalize-candidate.mjs`
- `scripts/bind-role-evidence.mjs`
- `scripts/quality-integrity.mjs`
- `scripts/verify-candidate`
- `scripts/verify-role-evidence.mjs`
- `tooling/quality/**`

## Goal

Make role-evidence binding a deliberate, deterministic candidate-finalization cycle rather than a manual edit after every implementation commit.

## Acceptance

- `finalize-candidate` requires a clean implementation tree, an active Work Item claim, and computes one canonical base/diff digest.
- Finalization writes an ignored local manifest containing Work Item, branch, base revision, implementation head, candidate digest, and finalization time.
- Reviewer, Hardener, and source-blind QA may start only after a valid finalization manifest exists and still matches the implementation diff.
- A role-report binding command fills missing Work Item/base/candidate fields from the manifest exactly once.
- Binding refuses an existing report whose candidate differs: stale passed evidence cannot be relabeled for new code.
- Any implementation or protected-policy change invalidates the manifest and prevents later gauntlet stages until a new finalization cycle.
- Evidence-only commits do not invalidate the frozen implementation candidate.
- Deterministic tests cover clean/dirty finalization, post-finalization invalidation, evidence-only stability, single-bind behavior, stale-report rejection, and agent-work stage enforcement.
- Documentation distinguishes implementation commits from a frozen candidate cycle and tells agents not to update `candidateRevision` manually.

## Notes

This intentionally automates identity binding, never role judgment. Reviewer, Hardener, and QA still produce their own factual report body and remain independently accountable.
