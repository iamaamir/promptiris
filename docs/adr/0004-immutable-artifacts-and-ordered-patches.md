---
status: accepted
---

# Exchange immutable Artifacts and apply ordered Patches

Plugins will receive immutable snapshots and return narrow Patches or new Artifacts that the Kernel validates and applies in a deterministic graph order. Shared mutable middleware would be simpler to author but makes provenance, concurrency, rollback, and conflict diagnosis unreliable; Prompt Iris therefore parallelizes read-only analysis, serializes mutators, and refuses to invent a semantic smart merge.

## Consequences

Plugin authors must declare intent more explicitly. The Kernel can show a transformation diff, attribute every change, enforce protected spans, and reject ambiguous graph compositions before execution.
