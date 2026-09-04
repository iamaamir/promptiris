# Point-of-action guidance for agent workflow

Status: in-progress

GitHub issue: <https://github.com/iamaamir/promptiris/issues/59>
Branch: `point-of-action`
Parent: none
Blocked by: none
Blocks: none
Parallel-safe: yes; owns point-of-action workflow guidance in scripts and CONTRIBUTING
Patch policy: 1
Golden changes: denied
Test deletion: denied
Allowed paths:

- `scripts/agent-work`
- `scripts/agent-context`
- `scripts/verify-candidate`
- `CONTRIBUTING.md`
- `tooling/quality/agent-work.test.sh`
- `tooling/quality/agent-context.test.sh`
- `.scratch/agent-guidance/**`

## Outcome

Move workflow guidance from prose documents to the moment of action, so agents meet the rule exactly when it applies. No new gates, no schema changes, no hosting coupling: every check stays local and `gh`-free.

## Acceptance

- `scripts/agent-work stage <role>` prints a short stage checklist after a successful transition: required inputs, independence/source-blindness rule where applicable, unbound report file to write, and the bind step. Generator and integration stages get checklists too.
- `CONTRIBUTING.md` tells contributors to run `scripts/bootstrap-tools` before `scripts/agent-context`.
- `scripts/agent-context` gains an `ENVIRONMENT` section reporting required-executable presence (`node`, `pnpm`, `go`, `gopls`, `gitleaks`, `rg`, `fd`, `jq`, `ast-grep`, `watchexec`) with a bootstrap hint when anything is missing. Additive output only.
- `scripts/verify-candidate` fails fast in preflight with an actionable message when `gopls` is missing, or `gitleaks` is missing under `--ci`/`--full`, instead of dying mid-run.
- `pnpm lint:shell`, existing `agent-work`/`agent-context` tooling tests, and markdownlint on changed files pass unmodified or extended in place.
- Independent Reviewer and Hardener report no unresolved blocker/high finding, and candidate/full verification pass.

## Non-goals

PR-body rendering and readiness gates (follow-up packet), schema changes, any `gh`/hosting-platform calls in gates, changing gate semantics or thresholds.
