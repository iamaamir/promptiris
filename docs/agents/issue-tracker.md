# Issue tracker: durable local packets with GitHub projection

Prompt Iris keeps Work Items locally so repository operation never depends on one hosting service. GitHub Issues project those packets for remote discovery, assignment, dependency visibility, discussion, and PR linkage.

Authority is intentionally one-directional:

- `.scratch/` owns the goal, boundaries, acceptance criteria, dependency declarations, branch, and durable status;
- the GitHub Issue body mirrors its local issue file exactly;
- GitHub owns remote assignment, comments, notifications, and PR relationships; and
- accepted decisions from comments return to the local packet or canonical documentation before they become durable project state.

Do not edit both bodies independently. Update the local packet, then run `./scripts/issue-sync push <issue-file>`. Run `./scripts/issue-sync check <issue-file>` to detect drift without changing either side.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`.
- The PRD is `.scratch/<feature-slug>/PRD.md`.
- Implementation issues are `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`.
- A `Status:` line near the top of each issue uses a role from `triage-labels.md`.
- A `GitHub issue:` line contains the exact projected issue URL or `pending` before creation.
- `Branch:` names at most three hyphen-separated words and contains no slash or type prefix.
- `Blocked by:`, `Blocks:`, and `Parallel-safe:` make scheduling constraints visible before assignment.
- Comments and handoff notes append under `## Comments`.

`.scratch/` coordinates active local work. Durable domain language, architecture, public contracts, and accepted decisions belong in their canonical repository documents and Git history. Task packets reference those artifacts rather than copying them.

## Branch and workspace isolation

Every independently deliverable feature or fix owns one branch. A normal single-agent task uses that branch in the current checkout; it does not create a worktree merely for ceremony. Concurrent agents on the same machine require separate worktrees because branches do not isolate filesystem writes. Worktrees are disposable execution directories, never durable task state.

The issue-owning agent runs the internal Specifier, Implementer, Reviewer, Cleaner, Hardener, source-blind QA, and deterministic verification loop until the PR is green. The internal Reviewer remains independent for high-risk changes. External maintainers perform the final PR review and merge decision.

Do not start a blocked issue. Do not run issues in parallel when they claim the same Conflict Domain or overlapping ownership. A dependency change must update the local packet and its GitHub projection before another agent takes the issue.

## Projection workflow

1. Create or update the local PRD and issue packet.
2. Create the GitHub Issue from the local file and record its URL locally.
3. Push the refreshed local body with `./scripts/issue-sync push`.
4. Before assignment and at phase boundaries, run `./scripts/issue-sync check`.
5. Link the feature PR to the GitHub Issue while retaining the `.scratch` path in the PR body.
6. After merge, record completion evidence locally and close the projected issue.

When a skill says to publish to the issue tracker, write the corresponding local packet first and then update its GitHub projection. When it says to fetch a ticket, orient from the local packet and use GitHub only for remote coordination deltas.
