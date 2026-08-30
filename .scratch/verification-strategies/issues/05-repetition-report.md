# Unify repetition evidence across all trace stores

Status: ready-for-agent
GitHub issue: <https://github.com/iamaamir/promptiris/issues/35>
Branch: `repetition-report`
Parent: .scratch/verification-strategies/PRD.md
Blocked by: .scratch/harness-integrity/issues/01-harness-integrity.md
Parallel-safe: yes; owns only the repetition-report command and its focused tests
Patch policy: 1
Golden changes: denied
Test deletion: denied
Allowed paths:

- `scripts/repetition-report`
- `tooling/quality/repetition-report.test.sh`
- `package.json`
- `.scratch/verification-strategies/issues/05-repetition-report.md`
- `.scratch/verification-strategies/issues/05-repetition-report.evidence/**`

## Acceptance

- Repetition candidates use the same deduplicated shared-worktree and imported-CI trace set as the telemetry analyzer.
- Output states its observation scope and separates historical observations from current-candidate verification.
- Invalid and unsupported traces cannot create candidates.
- The command has a deterministic fixture covering shared, worktree, imported, and duplicate trace inputs.
