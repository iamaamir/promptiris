# T004-03 — Runtime inspection and Go CLI tracer

Status: complete

## Outcome

Carry one explicit JSONC project configuration through the existing Go-to-Node boundary and expose side-effect-free `inspect` and non-generating `doctor` commands.

## Boundaries

- Own `apps/runtime-node`, `apps/cli-go`, shared integration fixtures, and directly affected documentation.
- Keep Go as a thin protocol client; configuration semantics remain canonical in TypeScript.
- No Provider request, credential resolution, repository search, paid probe, or Plugin activation during inspection.

## Acceptance

- `inspect` reports redacted resolved configuration, trace, capabilities, and Permission Hints deterministically.
- `doctor` validates local runtime/config readiness, marks Provider checks deferred, and performs no credential resolution, network access, or generation.
- Invalid configuration is a genuine non-zero CLI failure with safe stderr Diagnostics.
- stdout remains primary JSON data only and is empty on invalid configuration; secret literals never appear in any channel.
- Existing `enhance` identity behavior and integration tests remain compatible.
