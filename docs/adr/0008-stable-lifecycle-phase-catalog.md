---
status: accepted
---

# Fix six lifecycle phases in protocol v1

Protocol v1 will expose `preflight`, `analyze`, `transform`, `adapt`, `validate`, and `render` as its complete ordered phase catalog; Plugins may add dependency-ordered nodes within those phases but cannot invent phases. Arbitrary phases appear more extensible, but unrelated Hosts and Plugins could not know their mutation, concurrency, blocking, or model-call semantics, so adding a new phase requires an explicit future protocol revision.

## Consequences

The phase catalog becomes part of protocol compatibility and graph compilation rejects unknown phases or edges that reverse phase order. “Everything is a plugin” applies to pipeline work and policy, while the Kernel retains the small execution vocabulary needed to orchestrate that work safely.
