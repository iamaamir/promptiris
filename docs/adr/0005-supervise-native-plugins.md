---
status: accepted
---

# Supervise third-party native Plugins out of process

Third-party native Plugins will run by default in supervised subprocesses over a narrow, versioned protocol; declarative Plugins run in the Kernel and explicitly trusted bundled Plugins may opt in-process. In-process execution is faster, while a full sandbox is unrealistic across hosts, so subprocess supervision is the chosen middle ground for crash and resource containment without claiming a complete security boundary.

## Consequences

The protocol needs negotiation, cancellation, deadlines, output limits, process reuse, and structured crash Diagnostics. Hosts remain responsible for real permission enforcement.
