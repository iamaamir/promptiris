# T002-02 — Declarative plugin execution

Status: ready-for-agent

## Outcome

Execute one explicitly selected, data-only declarative plugin lazily through the same contribution plan used by all plugins.

## Boundaries

- No embedded expression language or arbitrary code evaluation.
- Use a deliberately small portable operation sufficient to prove the path.
- Preserve immutable artifact snapshots and deterministic output.

## Acceptance

- Loading the manifest performs no transformation and loads no runtime implementation.
- First invocation activates only the selected plugin.
- A public host-facing run applies the transformation and emits standard lifecycle events.
- Invalid declarative data yields a normalized diagnostic and the last valid artifact.
