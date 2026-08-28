# Default Enhance Recipe

## Contract

The bundled `promptiris/enhance` Recipe produces a candidate, model-neutral improvement. It is not an optimizer and does not claim empirical superiority. Its invariant is:

> Produce a model-neutral enhancement by default, then optionally apply a target-specific adaptation plugin.

The strategy preserves intent, constraints, code, literals, examples, quotations, and placeholders; exposes assumptions; and does not answer the request or silently invent requirements. The model handles semantic interpretation of open-ended and mixed instructions. The Kernel does not attempt an exhaustive instruction taxonomy.

## One-call pipeline

1. `preflight`: verify the required Input, Provider capability, and protected invariants.
2. `analyze`: select a capability-adaptive encoding and prepare analysis Artifacts.
3. `transform`: normalize without changing semantics, invoke a versioned model-neutral strategy in one model call, and decode the best available representation.
4. `adapt`: optionally run an explicitly selected target-adaptation Plugin.
5. `validate`: run deterministic invariant and intent-preservation checks.
6. `render`: produce the declared primary Artifact.

Native structured output uses the canonical envelope. JSON mode requests the same shape. A text-only model returns the enhanced prompt and an assumptions section; unavailable metadata is marked `unavailable` or `degraded`, never fabricated.

Decoding attempts strict parsing, then bounded fence removal and field recovery, then treats the complete model text as the candidate with a warning. No automatic second model call repairs malformed output. If validation still fails, the original Input is retained.

## Clarifications and interaction

Ambiguity never blocks the default Recipe. It returns an enhancement, visible assumptions, and optional clarification questions. Applying answers is a separate `refine` Run. Host Adapters choose `suggest`, `confirm`, `automatic`, or `manual` interaction. Interactive Hosts should default to confirmation; automatic replacement requires explicit opt-in.

## Failure and budget

The Host owns the total deadline and cancellation signal. Each Plugin receives a bounded share. Default enhance performs at most one generation. Multi-pass strategies are different, explicitly activated Recipes.

Because enhancement is optional, failure is fail-open: no partial transformation is submitted, the Result is `degraded`, and the primary Artifact derives from the original Input. Strict CLI mode or a blocking Guard can request a non-success outcome.

## Evaluation plan

Default Enhance is governed by the normative [evaluation and release profile](./evaluation.md). The initial transformation corpus contains 400 cases and the paired downstream suite contains 160 tasks. They cover vague requests, already-good prompts, coding, creative work, extraction, protected literals, malicious or conflicting instructions, multilingual inputs, and short and long inputs.

Mechanical invariants have zero tolerance. Semantic preservation and usefulness use blinded review, calibrated model graders as assistants, human adjudication, paired comparisons, and uncertainty reporting across strong, small, and local capability classes. No single judge or aggregate score decides release quality.

Only a future `optimize` Recipe may use datasets, metrics, and search to claim optimization.
