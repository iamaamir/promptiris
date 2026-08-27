# T002-04 — Independent hardener and QA acceptance

Status: done

## Outcome

Attack the completed slice independently, verify it through deterministic gates, and preserve concise evidence rather than trusting worker claims.

## Acceptance

- Candidate verifier passes before the full verifier is attempted.
- Mutation targets the graph/compiler, lazy activation, fail-open normalization, and native supervision boundaries.
- Coverage and CRAP meet repository policy; changed Go code meets the visible 80% target if Go is touched.
- Secret, dependency, static, type, lint, formatting, and public-path checks pass.
- Human-style QA uses only documented public exports and fixtures.
- Repeated failures are normalized and compared before any retry.

## Evidence

- Independent public QA found and closed executable and non-JSON manifest escape paths, including `Date`, cycles, symbol keys, and accessors.
- Expanded mutation scope covers protocol, SDK, graph compilation, execution, and native supervision; score 76.57% passes the 75% break threshold.
- Full verification run `verify-20260827T151632Z-51568` passed formatting, lint, shell, schema, generated files, types, build, unit, Go vet/race, integration, LSP, structural rules, telemetry, secrets, coverage, CRAP, dead code, public API, and mutation.
- Dashboard telemetry was regenerated after verification.
