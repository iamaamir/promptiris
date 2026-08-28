# Adoption workflows

## Audit

1. Snapshot exact repository and working-tree state.
2. Identify existing instructions, domain docs, decision records, issue/task system, CI, verification commands, test/quality tools, generated reports, and local agent state.
3. Execute no expensive or mutating command unless requested.
4. Classify maturity from demonstrated evidence.
5. Return gaps, conflicts, and one smallest next increment.

## Bootstrap

Prefer the minimum Level 1 loop:

1. merge a tiny constitution into existing root instructions;
2. identify existing authoritative domain/decision locations instead of duplicating them;
3. define a task-scoped state or issue convention;
4. add a read-only context command that reports dirty state;
5. connect it to existing verification rather than replacing the build system;
6. prove a fresh worker can orient from repository state.

Use [../templates/AGENTS.fragment.md](../templates/AGENTS.fragment.md), [../templates/work-item.md](../templates/work-item.md), and [../templates/agent-context.sh](../templates/agent-context.sh) selectively.

## Adopt one level

- Establish current demonstrated level.
- Select one missing capability with immediate task value.
- Define observable acceptance and non-goals.
- Reuse the repository's language, task runner, CI, and artifact formats.
- Implement a vertical path from invocation to evidence.
- Test normal, failure, stale-state, and dirty-tree behavior.
- Update durable operating documentation.

Never scaffold every later level horizontally.

## Harden

Read [quality-gauntlet.md](quality-gauntlet.md). Select evidence by risk and language support. Do not install every named tool. Prefer affected checks while iterating and one deliberate full profile for acceptance.

## Evolve

Read [tool-routing-and-automation.md](tool-routing-and-automation.md). Mine operational traces only when measurement boundaries are explicit. Output candidates; do not create or activate automation unless separately authorized.

## Validate

Exercise behavior rather than checking file presence:

- context command works with staged, unstaged, and untracked changes;
- verifier exits nonzero on a controlled failure;
- evidence names exact candidate state;
- large output is retained but bounded in model-visible summaries;
- a replacement worker can identify next action without conversation history;
- unavailable/unobserved capabilities are reported honestly;
- automation and observers cannot waive acceptance.

## Brownfield rules

- Treat existing changes as user-owned.
- Never replace CI, issue tracking, task runners, or conventions merely for uniformity.
- Map equivalent concepts before adding files.
- Surface contradictory authority instead of inventing another source of truth.
- Introduce one useful path, measure it, and expand only after use.

## Greenfield rules

- Avoid speculative orchestration.
- Begin with Git, a small constitution, one work item, one context command, and one verifier.
- Add tools after code and risks make their value observable.
- Keep human invocation first-class.
