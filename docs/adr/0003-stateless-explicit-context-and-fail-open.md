---
status: accepted
---

# Keep transformation stateless, context-explicit, and fail-open by default

The Kernel will not retain history or discover ambient context, and optional transformation failure will return an Artifact derived from the original Input. Implicit memory and fail-closed enhancement can feel convenient, but they make privacy, reproducibility, and host reliability unpredictable; persistence is therefore a Plugin, Context is Host-supplied, and only explicit Guards or strict Host policy may block.

## Consequences

Every Recipe declares required and optional Context capabilities. Results expose degraded status and provenance so fallback is visible rather than silent.
