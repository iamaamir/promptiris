# Prompt Iris

Prompt Iris is a model-neutral, host-neutral framework for transforming natural-language input into a more useful artifact. Prompt enhancement is its first built-in recipe, not the boundary of the product: a recipe may produce a prompt, a typed extraction, a domain-specific structure, or another declared artifact.

The governing philosophy is **everything is a plugin**. The kernel supplies lifecycle and safety mechanics; providers, transformations, guards, renderers, observers, recipes, and host integrations supply behavior.

## Status

Prompt Iris has **completed phase 1** and begun phase 2 with a verified identity tracer. The Go CLI launches the private Node runtime, negotiates the runtime-neutral protocol, streams standard lifecycle Events, invokes the bundled identity Recipe, and returns the original prompt. This deliberately narrow slice proves the cross-language boundary before product behavior is added.

Start with:

- [Domain language](./CONTEXT.md)
- [Phase-one brief](./docs/phase-1/brief.md)
- [Architecture](./docs/architecture/overview.md)
- [Decision register](./docs/decisions.md)
- [Research ledger](./docs/research/ledger.md)
- [Session checkpoint](./docs/phase-1/session-001-checkpoint.md)
- [Implementation handoff](./docs/phase-1/implementation-handoff.md)
- [Implementation roadmap](./ROADMAP.md)
- [Phase-two bootstrap evidence](./docs/phase-2/bootstrap.md)
- [Agent-driven implementation operating model](./docs/development/agent-operating-model.md)
- [Configuration and capability tracer](./docs/development/configuration-capability-tracer.md)
- [Closed questions and deferred roadmap](./docs/phase-1/open-questions.md)

## Core promise

> Produce a model-neutral enhancement by default, then optionally apply a target-specific adaptation plugin.

Prompt Iris is bring-your-own-model, stateless by default, fail-open for optional transformations, explicit about activation, and usable from different hosts without duplicating its kernel.

## Development

Requires Node 24, pnpm 11.24, and Go 1.26. Bootstrap the pinned workspace and repository-local language servers, then retrieve compact state:

```sh
./scripts/bootstrap-tools
./scripts/agent-context
```

Use `pnpm verify` for the fast candidate pipeline. Use `pnpm verify:full` for coverage, CRAP, dead-code, public-API, and mutation evidence. Raw output stays under ignored `.agent/` paths; commands return compact references and exit codes.

Run `pnpm dashboard` and open `http://127.0.0.1:4173` for the local read-only evidence dashboard. It derives tool usage, verifier cost, output reduction, mutation, coverage, CRAP, recent runs, and automation candidates from `.agent` artifacts. See [Repository evidence dashboard](./docs/development/evidence-dashboard.md) for the measurement and privacy boundaries.

Run the current tracer directly with:

```sh
pnpm build
cd apps/cli-go
go run . enhance --runtime ../runtime-node/dist/index.js --input 'Improve this prompt'
```

## Documentation practice

Each resolved term is added to `CONTEXT.md`, durable architectural trade-offs are captured as ADRs, all accepted requirements are kept in `docs/decisions.md`, and external evidence is recorded in `docs/research/ledger.md`. Phase 2 changes must update the decision and contract documents in the same change; accepted ADRs are superseded, not rewritten.
