# Roadmap and GitHub issue synchronization

Status: ready-for-human

GitHub issue: <https://github.com/iamaamir/promptiris/issues/21>
Branch: `roadmap-sync`
Parent: ROADMAP.md
Blocked by: none
Blocks: none
Parallel-safe: no; owns roadmap packets, issue-tracker policy, and projection tooling

## Outcome

Lay down the remaining v1 roadmap as independently pickable local packets and deterministically project their managed fields to GitHub Issues.

## Acceptance

- `ROADMAP.md` distinguishes delivered foundations, remaining v1 slices, and explicitly deferred work.
- Every remaining v1 slice has an outcome, boundaries, acceptance criteria, short branch, dependencies, and conflict ownership.
- One command creates or updates all projections in two passes and synchronizes managed labels, state, parent, and blocked-by relationships.
- Interrupted creation is idempotently recovered and manual remote body edits are never silently overwritten.
- GitHub-only comments, assignment, milestones, PR links, and non-triage labels are preserved.
- A deterministic fake-GitHub test proves creation, repeat execution, relationships, drift detection, and compact checks.
- Documentation, shell lint, tooling tests, Reviewer, Hardener, QA, and candidate verification pass.

## Delivery dependency

This branch is stacked on `platform-primitives` PR #3; external maintainers merge that dependency before this PR can target `main` cleanly.

## Verification evidence

- `pnpm verify:full` passed every full repository gate, including coverage, CRAP, dead-code, public API, race, security, and mutation checks.
- `./scripts/issue-sync check --all` confirmed exact managed-field and relationship parity for every projected packet.
- The deterministic fake-GitHub test passed creation, interrupted-write recovery, idempotency, parent/dependency projection, status, closing, label reconciliation, and remote-edit refusal.
- Independent low-cost review reported no blocker, high, or unresolved P2 finding after hardening.
