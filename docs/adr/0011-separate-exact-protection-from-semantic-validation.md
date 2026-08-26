---
status: accepted
---

# Separate exact protection from semantic validation

A Protected Span will mean a precisely selected, textually exact invariant enforced by the Kernel, while meaning-level requirements are Semantic Constraints evaluated by Guard Plugins during `validate`. Combining both behind an `exact | semantic` mode would imply equal guarantees even though the Kernel can mechanically reject overlapping text edits but cannot prove preserved intent or API behavior without domain-specific evaluation.

## Consequences

The Kernel can state exact preservation truthfully and consistently across languages. Recipes choose the Guard and failure policy appropriate to each Semantic Constraint, and diagnostics distinguish a mechanical protection conflict from uncertain or failed semantic validation.
