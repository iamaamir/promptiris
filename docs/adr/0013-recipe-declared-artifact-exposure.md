---
status: accepted
---

# Let Recipes declare Artifact exposure

Artifacts will be immutable typed envelopes with compact provenance, but only a Recipe may declare which Artifact kinds are internal, exposed, alternatives, or eligible as the Primary Artifact. Letting each Plugin publish arbitrary products directly to the Result appears maximally extensible, yet it would leak analysis, sensitive Context, and unstable implementation details across Host boundaries; Recipe contracts provide composition-level review and predictable Results.

## Consequences

The Kernel intersects Recipe exposure with Artifact classification and Host policy. Internal Plugin collaboration remains open through namespaced Artifacts without making every intermediate value part of the public compatibility surface.
