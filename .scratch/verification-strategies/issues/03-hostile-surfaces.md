# Activate hostile-surface verification providers

Status: needs-info
GitHub issue: <https://github.com/iamaamir/promptiris/issues/32>
Branch: `hostile-surfaces`
Parent: .scratch/verification-strategies/PRD.md
Blocked by: none
Parallel-safe: no; activation waits for concrete parser, HTTP, network, or infrastructure surfaces
Patch policy: 1
Golden changes: denied
Test deletion: denied
Allowed paths:

- `tooling/quality/**`
- `package.json`
- `pnpm-lock.yaml`
- `.github/workflows/**`
- `.scratch/verification-strategies/issues/03-hostile-surfaces.md`
- `.scratch/verification-strategies/issues/03-hostile-surfaces.evidence/**`

## Acceptance

- Jazzer.js activates only for untrusted parser/decoder/native boundaries.
- Pact and Schemathesis activate only for independently deployed HTTP/OpenAPI contracts.
- Toxiproxy and Testcontainers activate only for real network or infrastructure dependencies.
- Every provider is pinned, bounded, replayable, measured, and visible in the dashboard before gating.
