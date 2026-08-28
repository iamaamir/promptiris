# Domain documentation

Prompt Iris uses a single bounded-context documentation layout.

Before semantic exploration or implementation, agents read:

- `CONTEXT.md` for canonical domain vocabulary;
- the ADRs under `docs/adr/` that govern the affected surface;
- the smallest relevant architecture, product, specification, or development documents linked by the task packet.

Use glossary terms in issue titles, test names, interfaces, and completion reports. Do not substitute a term listed under `_Avoid_`. If required language is absent, report the gap rather than silently inventing a competing term.

Surface conflicts with accepted ADRs explicitly. Never override an ADR through implementation alone; a durable decision change requires the repository's documented supersession process.

Agents retrieve progressively. Task packets point to canonical documents and exact repository surfaces rather than embedding large copies. Subagents return concise results and Evidence references, not narratives or private reasoning.
