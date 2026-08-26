---
status: accepted
---

# Use typed atomic domain Patches

Plugins will propose atomic, revision-aware Patches using a small versioned union of Meta Prompt operations that target stable block IDs and carry content preconditions. Reusing RFC 6902 would reduce initial protocol work, but generic JSON paths expose internal schema, array indexes drift under composition, and unrestricted operations could bypass immutable constraints or Kernel-owned fields; arbitrary Plugin products remain extensible through Artifacts rather than executable custom Patch opcodes.

## Consequences

The Kernel owns validation, application, diff provenance, and rollback information for every operation type. Adding a new mutation semantic requires a protocol change and conformance fixtures, while Plugin authors gain deterministic conflicts and the same behavior in-process, across subprocesses, and from other languages.
