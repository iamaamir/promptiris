# Provider doctor and conformance probes

Status: ready-for-agent

GitHub issue: <https://github.com/iamaamir/promptiris/issues/17>
Branch: `provider-doctor`
Parent: ROADMAP.md
Blocked by: .scratch/provider-path/issues/01-provider-contract.md, .scratch/provider-path/issues/02-openai-compatible.md
Blocks: .scratch/release-path/issues/02-release-evidence.md
Parallel-safe: yes; owns opt-in Provider probing, evidence records, and conformance reports

## Outcome

Turn uncertain Provider behavior into explicit, inspectable, binding-specific evidence.

## Acceptance

- Doctor probes are opt-in, bounded, cancellable, and declare possible cost and data exposure before network access.
- Results record supported, unsupported, inconclusive, and conflicting evidence with source, time, binding fingerprint, and digest.
- Probes cover text, streaming, JSON/schema modes where advertised, limits, error shape, and cancellation without demanding unsupported features.
- Cached evidence invalidates when material binding configuration changes.
- Human-readable and machine-readable reports redact secrets and link raw artifacts by reference.
- Conformance fixtures, Reviewer, Hardener, QA, and candidate verification pass.
