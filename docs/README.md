# Design documentation

The documentation is organized by purpose so phase-one and implementation-governance reasoning remain maintainable:

- [`../CONTEXT.md`](../CONTEXT.md) — canonical domain vocabulary only.
- [`phase-1/brief.md`](./phase-1/brief.md) — goals, principles, scope, and success criteria.
- [`phase-1/session-001-checkpoint.md`](./phase-1/session-001-checkpoint.md) — narrative checkpoint of the initial grill.
- [`decisions.md`](./decisions.md) — exhaustive accepted-decision register.
- [`architecture/`](./architecture/) — current cohesive system design.
- [`specification/`](./specification/) — protocol profiles and normative contract details.
- [`product/`](./product/) — user-visible behavior of the default Recipe, CLI, and Hosts.
- [`development/`](./development/) — implementation stack, public packages, Plugin-author workflow, compatibility, quality gates, the [agent-driven implementation operating model](./development/agent-operating-model.md), its [tool-aware execution layer](./development/tool-aware-execution.md), the [code-quality and review standard](./development/code-quality-and-review.md), the [configuration and capability tracer](./development/configuration-capability-tracer.md), and the [repository evidence dashboard](./development/evidence-dashboard.md).
- [`security/`](./security/) — trust boundaries, threat model, and explicit non-guarantees.
- [`adr/`](./adr/) — only costly, non-obvious architectural trade-offs and their rationale.
- [`research/ledger.md`](./research/ledger.md) — real-world evidence and adopt/adapt/reject/defer outcomes.
- [`phase-1/open-questions.md`](./phase-1/open-questions.md) — ordered continuation point for the grill.
- [`phase-1/implementation-handoff.md`](./phase-1/implementation-handoff.md) — closed Phase 1 baseline and ordered Phase 2 tracer bullets.

## Update discipline

When the grill resolves a question:

1. sharpen any new domain term in `CONTEXT.md`;
2. add or revise the accepted item in `decisions.md`;
3. update the relevant architecture or product document;
4. record sources and their influence in the research ledger;
5. create an ADR only when the choice is hard to reverse, surprising without context, and based on a real trade-off;
6. remove the resolved question from `open-questions.md` and add the next unresolved branch.

ADRs are append-only history. A changed architectural decision gets a new ADR that supersedes the old one.
