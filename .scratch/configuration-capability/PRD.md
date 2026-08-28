# Configuration and Capability Path

Status: complete

## Goal

Prove the smallest cross-language configuration vertical slice. Prompt Iris loads one human-authored JSONC project configuration, resolves immutable schema-directed layers with explainable provenance, represents credentials only as logical references, evaluates explicit capability evidence, and exposes read-only `inspect` and non-generating `doctor` commands through the existing Go-to-Node protocol.

This slice prepares Provider execution without making a model call. It keeps configuration mechanics in the Kernel while Plugin manifests declare behavior-specific defaults, capabilities, and Permission Hints.

## Canonical decisions

- Resolution precedence is schema, Plugin, Recipe, Host, user, project, then Run; Host or organization policy is a separate constraint decision.
- Unknown keys are errors. Scalars replace, objects merge only when their schema allows it, arrays replace unless append or union is declared, and `null` remains schema-defined.
- Plugins receive a plain deeply immutable resolved value. `ConfigTrace` is a separate immutable sidecar keyed by RFC 6901 JSON Pointer.
- Trace candidates are ordered low-to-high and retain source identity, optional location, merge operation, effective source, and a safe reason. Secret material never enters the trace.
- Configuration contains logical Secret References, never credentials. Actual resolution is deferred to the selected Provider boundary in T005.
- Capability state is `supported`, `unsupported`, or `unknown`, scoped to an exact binding fingerprint and backed by explicit evidence. Requirements are `required`, `preferred`, or `optional`. Restrictions outrank positive claims; branding or endpoint shape proves nothing; irreconcilable same-strength positive claims fail inspection instead of guessing.
- Permission Hints are inspectable manifest metadata for Host authorization decisions, not an RBAC system and not proof of authority.
- `inspect` is deterministic and side-effect free. T004 `doctor` performs the local validation/runtime subset of the canonical command and marks Provider connectivity, authentication, and model-list checks as deferred; it never resolves credentials or accesses the network. T005 adds those non-generating Provider checks. Paid or generative probes remain separately authorized and deferred.
- Keep this tracer vertical inside existing packages. Do not create a general configuration platform, devtools package, policy language, Provider implementation, or lockfile generator.

## Public behavior

1. A strict JSONC loader accepts comments and trailing commas while rejecting malformed input and duplicate keys.
2. The resolver applies declared layers deterministically and produces a deeply frozen value plus `ConfigTrace`.
3. Unknown keys, invalid values, forbidden literals in secret fields, invalid merge rules, and invalid policy decisions produce stable configuration Diagnostics. Policy records cover `allowed`, `forced`, `clamped`, and `denied` with policy identity, safe reason, and affected source.
4. Secret References remain references in resolved configuration, inspection, errors, Events, and Results.
5. Explicit capability evidence resolves deterministically for one binding fingerprint; unsupported evidence cannot be overridden by a weaker positive claim, and irreconcilable positive claims produce a stable inspection failure.
6. Plugin manifests expose immutable capability declarations and Permission Hints without activating Plugin code.
7. Runtime `inspect` returns redacted configuration provenance, capability evidence, and Permission Hints without loading credentials or invoking Plugins.
8. Runtime `doctor` reports configuration/schema/runtime readiness, explicitly marks deferred Provider checks, and performs no credential resolution, generation, or network access in this slice.
9. The Go CLI forwards `--config`, prints machine-readable inspection/readiness output to stdout, and keeps Diagnostics on stderr.
10. Required missing capabilities produce `capability.missing` before execution; preferred missing capabilities select a declared fallback with degradation; optional missing capabilities remain inspectable without blocking.
11. Existing identity execution remains compatible and does not receive the provenance sidecar.

## Out of scope

- Provider HTTP, SSE, authentication, model listing, or conformance probes
- Environment/keychain/helper secret material resolution
- User-global search and repository-root discovery beyond an explicit `--config` tracer path
- Generated lockfiles, installation, discovery catalogs, or persistent capability observations
- General policy language, roles, entitlements, or sandbox enforcement
- Default Enhance, target adaptation, Pi integration, or model evaluation

## Acceptance

- Protocol and manifest public types cover source locations, trace entries, policy records, Secret References, capability evidence, Permission Hints, `inspect`, and `doctor`.
- Example and property tests prove precedence, pointer escaping, schema-directed object/array/null semantics, deterministic union ordering, policy separation, deep immutability, and secret-safe output.
- Black-box runtime/CLI tests prove `inspect` and `doctor` are protocol compatible, do not activate Plugins, resolve credentials, access the network, or generate, and emit no partial stdout on invalid configuration.
- Invalid JSONC, duplicate keys, unknown keys, literal secrets, conflicting evidence, and missing required capabilities have stable observable outcomes.
- Existing identity, Plugin, transformation, and fail-open behavior remains unchanged.
- Candidate verification passes before independent review and source-blind QA; the full Hardener profile remains green with mutation at least 90% for every changed governed target. Deferred Provider and release-only gates stay visibly deferred.

## References

- `CONTEXT.md`
- `docs/architecture/protocol.md`
- `docs/architecture/plugins-and-recipes.md`
- `docs/specification/schema-profile.md`
- `docs/specification/openai-compatible-provider.md`
- `docs/adr/0016-sidecar-configuration-provenance.md`
- `docs/adr/0017-capabilities-require-evidence.md`
- `docs/security/threat-model.md`
