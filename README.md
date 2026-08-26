# Meta Prompt

Meta Prompt is a model-neutral, host-neutral framework for transforming natural-language input into a more useful artifact. Prompt enhancement is its first built-in recipe, not the boundary of the product: a recipe may produce a prompt, a typed extraction, a domain-specific structure, or another declared artifact.

The governing philosophy is **everything is a plugin**. The kernel supplies lifecycle and safety mechanics; providers, transformations, guards, renderers, observers, recipes, and host integrations supply behavior.

## Status

Meta Prompt has **completed phase 1: requirements, system design, developer experience, user experience, and research**, plus an implementation-governance checkpoint for deterministic agent-driven development. No implementation has begun. The documentation is the implementation baseline produced by the initial 30+ question grill, the autonomous closure pass, and the subsequent quality-control grill.

Start with:

- [Domain language](./CONTEXT.md)
- [Phase-one brief](./docs/phase-1/brief.md)
- [Architecture](./docs/architecture/overview.md)
- [Decision register](./docs/decisions.md)
- [Research ledger](./docs/research/ledger.md)
- [Session checkpoint](./docs/phase-1/session-001-checkpoint.md)
- [Implementation handoff](./docs/phase-1/implementation-handoff.md)
- [Agent-driven implementation operating model](./docs/development/agent-operating-model.md)
- [Closed questions and deferred roadmap](./docs/phase-1/open-questions.md)

## Core promise

> Produce a model-neutral enhancement by default, then optionally apply a target-specific adaptation plugin.

Meta Prompt is bring-your-own-model, stateless by default, fail-open for optional transformations, explicit about activation, and usable from different hosts without duplicating its kernel.

## Documentation practice

Each resolved term is added to `CONTEXT.md`, durable architectural trade-offs are captured as ADRs, all accepted requirements are kept in `docs/decisions.md`, and external evidence is recorded in `docs/research/ledger.md`. Phase 2 changes must update the decision and contract documents in the same change; accepted ADRs are superseded, not rewritten.
