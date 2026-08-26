---
status: accepted
---

# Transfer failures as data and keep debug records ephemeral

Operational failures will cross SDK, process, language, and Host boundaries as schema-validated Diagnostics rather than JavaScript errors or stderr text. Exception messages and stacks are valuable during development but can be unstable and sensitive, so richer Debug Records remain bounded, opt-in, correlated, and ephemeral unless an explicit Observer persists them.

## Consequences

Plugin manifests register namespaced diagnostic definitions, the Kernel stamps trusted fields and normalizes unexpected throws, protocol errors are reserved for RPC faults, and Go/Pi consumers can handle all Run outcomes without parsing runtime-specific exceptions.
