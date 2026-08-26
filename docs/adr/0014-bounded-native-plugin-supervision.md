---
status: accepted
---

# Bound native Plugin supervision

Third-party native Plugin processes will use negotiated but ceiling-bounded messages, single-invocation execution by default, explicit handshake/cancellation/shutdown grace periods, rolling stderr capture, and crash-loop quarantine. Leaving these values entirely to each Host sounds flexible but makes fault containment, conformance, and debugging inconsistent; large data travels by Resource Reference and Hosts may tighten rather than remove the safety profile.

## Consequences

The protocol fixtures must test every boundary and cross-platform termination path. Plugins that need concurrency declare it and pass tests, while a crash never silently repeats model calls or mutations from the interrupted invocation.
