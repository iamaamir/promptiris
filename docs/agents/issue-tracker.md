# Issue tracker: Local Markdown

Issues and PRDs for this repository live only as Markdown files under `.scratch/`. Agents do not create or synchronize remote issues.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`.
- The PRD is `.scratch/<feature-slug>/PRD.md`.
- Implementation issues are `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`.
- A `Status:` line near the top of each issue uses a role from `triage-labels.md`.
- Comments and handoff notes append under `## Comments`.

`.scratch/` coordinates active local work. Durable domain language, architecture, public contracts, and accepted decisions belong in their canonical repository documents and Git history. Task packets reference those artifacts rather than copying them.

When a skill says to publish to the issue tracker, create or update the corresponding file under `.scratch/<feature-slug>/`. When it says to fetch a ticket, read the referenced local file.
