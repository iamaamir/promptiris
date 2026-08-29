# Agent constitution

Optimize for correctness and verified acceptance before efficiency. The target metric is total tokens and model cost per verified, accepted task—not tokens per individual call.

## Prime directive

> **Reason with models.**\
> **Compute with tools.**\
> **Search structurally.**\
> **Store state externally.**\
> **Communicate through references.**\
> **Verify deterministically.**\
> **Retrieve progressively.**\
> **Delegate narrowly.**\
> **Automate repetition.**\
> **Measure everything.**

## Working rules

1. Prefer a fresh registered Automation Task, then route to a deterministic Tool Capability, then retrieve/index, and use a model only for semantic reasoning or generation.
2. Search syntax and symbols structurally when relationships matter; use textual search for literal or regular-expression questions.
3. Use deltas and relevant dependency neighborhoods instead of rereading unchanged full state.
4. Do not delegate file listing, search, parsing, counting, formatting, test execution, exit-code inspection, or other mechanical work.
5. Preserve large logs and reports as artifacts; put only concise findings and references in model context.
6. Reuse valid commit-bound evidence. Repeat work only after invalidation, loss of trusted evidence, or for a distinct failure model.
7. Verify every change before declaring completion. An agent cannot self-certify its own work.
8. Stop blind retry loops when normalized failures repeat; broaden evidence or escalate reasoning deliberately.
9. Record operational Tool Traces, not private reasoning. Redact secrets and avoid collecting user content unless explicitly required and authorized.
10. Treat recurring agent actions as Automation Candidates; never self-activate generated automation without tests and deterministic acceptance.
11. Select language/platform primitives by semantic fit. Prefer explicit built-ins such as `Map`/`Set`, iterators, `Symbol`, or `Proxy` only when their ownership, identity, laziness, or interception semantics make the contract clearer; feature usage is never a quality score.
12. High-risk protocol, Kernel, configuration, Provider, native-Plugin, and security changes require an independent Reviewer responsibility. Reviewer output follows `spec/schemas/reviewer-report.schema.json` and unresolved blocker/high findings prevent completion.
13. Do not add `Co-Authored-By` or other AI/tool-attribution trailers to commit messages. Commit authorship comes from Git history alone.
14. Every independently deliverable feature or fix owns one short branch of at most three hyphen-separated words. Do not use slashes or type prefixes. A worktree is required only for concurrent local writers.
15. The issue-owning agent runs the complete Implementer, Reviewer, Cleaner, Hardener, QA, and deterministic verification loop until its PR is green. Only external maintainers decide whether to merge.

The full operating model is [docs/development/agent-operating-model.md](docs/development/agent-operating-model.md), with the execution substrate specified in [docs/development/tool-aware-execution.md](docs/development/tool-aware-execution.md) and code/review requirements in [docs/development/code-quality-and-review.md](docs/development/code-quality-and-review.md). During the documentation-only phase, inspect repository state with deterministic tools. Once implemented, `scripts/agent-context` is the standard local orientation entrypoint.

Commits follow Conventional Commits. Put the required emoji after the type/scope prefix, for example `docs(agents): 📝 record the operating model`.

## Agent skills

### Issue tracker

Authoritative Work Items live as Markdown under `.scratch/<feature>/` and are projected to GitHub Issues for assignment, discussion, and review. See `docs/agents/issue-tracker.md`.

### Triage labels

Use `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Use the single root `CONTEXT.md` and `docs/adr/` layout. See `docs/agents/domain.md`.
