# T002-04 — Independent hardener and QA acceptance

Status: blocked

Blocked by: T002-01, T002-02, T002-03

## Outcome

Attack the completed slice independently, verify it through deterministic gates, and preserve concise evidence rather than trusting worker claims.

## Acceptance

- Candidate verifier passes before the full verifier is attempted.
- Mutation targets the graph/compiler, lazy activation, fail-open normalization, and native supervision boundaries.
- Coverage and CRAP meet repository policy; changed Go code meets the visible 80% target if Go is touched.
- Secret, dependency, static, type, lint, formatting, and public-path checks pass.
- Human-style QA uses only documented public exports and fixtures.
- Repeated failures are normalized and compared before any retry.
