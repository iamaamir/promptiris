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
- Expanded mutation scope covers protocol, SDK, graph compilation, execution, and native supervision. Contract hardening raised the corrected line-scoped score from a forced 75.94% baseline to 93.90%; the breaking threshold is now 90%.
- Package mutation targets score 100%. Native supervision scores 82.16% after exact protocol, boundary, timeout, cancellation, shutdown, shell-isolation, stderr-drain, and listener-cleanup tests.
- Dead stderr-tail buffering was removed. Equivalent or public-result-neutral lifecycle mutations are excluded only at specific source lines with rationale; broad exclusions are forbidden.
- Full verification run `verify-20260827T182041Z-9895` passed all 20 gates, including the new 90% mutation break threshold, in 44.24 seconds.
- Source-blind public-path QA reran the built Go CLI to Node runtime identity path without implementation imports. Trace `.agent/traces/20260827T182150-12318.json` passed in 1.53 seconds; its raw evidence is `.agent/logs/tool-20260827T182150-12318.log`.
- Dashboard telemetry was regenerated after verification.
