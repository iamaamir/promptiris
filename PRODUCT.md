# Meta Prompt Product Context

## Register

product

## Users

Meta Prompt serves developers, agent-framework authors, CLI users, plugin authors, and maintainers who need dependable natural-language transformation across hosted, local, weak, and OpenAI-compatible models. They work inside terminals, editors, CI systems, and agent hosts, often under tight context and compute budgets. Their job is to compose transformations, understand what ran, diagnose failures, and accept changes only when repository evidence proves them.

## Product Purpose

Meta Prompt is a model-neutral, host-neutral transformation framework whose first bundled recipe enhances prompts. The kernel remains small while explicitly activated plugins supply providers, transformations, guards, memory, rendering, observation, and host integration. Success means users can extend any stage without kernel changes, optional transformation failures degrade safely, and maintainers can answer operational and quality questions from durable evidence rather than conversation history.

## Brand Personality

Precise, inspectable, and quietly confident. The product should feel like a well-made engineering instrument: dense when the work demands density, calm under failure, honest about uncertainty, and explicit about provenance. Copy is direct and technical without becoming cryptic.

## Anti-references

- Generic AI dashboards that substitute glowing gradients, glass panels, oversized vanity metrics, or decorative motion for evidence.
- Observability products that hide data provenance, mix estimates with measurements, or imply certainty that the underlying data cannot support.
- Plugin marketplaces or workflow builders that make extension points look interchangeable while concealing execution order, authority, and failure policy.
- Developer tools that require an agent to reconstruct project state, repeat mechanical work, or read full logs when a compact reference is available.

## Design Principles

1. **Evidence before assertion.** Every conclusion links to the run, report, log, or source that supports it; unknown and estimated values remain visibly distinct from measured values.
2. **Progressive disclosure.** Lead with current health and material changes, then let users inspect trends, providers, individual runs, and raw artifacts without flooding the first view.
3. **Practice the operating model.** Compute deterministically, keep large output outside model context, automate repetition, and make the interface itself reduce future model calls.
4. **Make extension boundaries legible.** Distinguish Meta Prompt runtime plugins from repository Tool Adapters, and show provider identity, capability, cost, and applicability where those distinctions affect decisions.
5. **Fail visibly and usefully.** Missing, stale, partial, or legacy telemetry produces an actionable state rather than a broken surface or a fabricated metric.

## Accessibility & Inclusion

Target WCAG 2.2 AA. All workflows must work with a keyboard and screen reader; focus remains visible; tables and charts have equivalent textual data; status is never communicated by color alone; reduced-motion preferences are honored; dense layouts reflow without horizontal page scrolling; and terminology, timestamps, units, and estimates are explained in context.
