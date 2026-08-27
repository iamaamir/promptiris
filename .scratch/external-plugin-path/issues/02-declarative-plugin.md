# T002-02 — Declarative plugin execution

Status: done

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

## Evidence

- Red trace: `.agent/traces/20260827T101312-15498.json`.
- Hardened targeted trace: `.agent/traces/20260827T101645-17014.json`.
- Public tests: 14 passing across `plugin-sdk` and `core`.
- Independent low-cost hardener review: pass, no remaining actionable findings.
