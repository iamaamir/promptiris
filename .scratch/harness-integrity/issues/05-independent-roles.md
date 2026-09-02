# Enforce independently executed quality roles

Status: ready-for-agent
GitHub issue: <https://github.com/iamaamir/promptiris/issues/49>
Branch: `independent-roles`
Parent: .scratch/role-assurance/PRD.md
Blocked by: .scratch/harness-integrity/issues/00-role-work-items.md
Blocks: .scratch/harness-integrity/issues/06-model-routing.md, .scratch/harness-integrity/issues/07-feature-postmortems.md, .scratch/harness-integrity/issues/08-feature-gauntlet.md
Parallel-safe: no; owns role contracts, prompt registry, role input manifests, attestation normalization, and role-evidence verification
Conflict domain: role prompts, manifests, attestations, attempt ledger, and role-report schemas
Shared integration paths: AGENTS.md, package.json, scripts/agent-context, scripts/agent-work, scripts/bind-role-evidence.mjs, scripts/finalize-candidate.mjs, scripts/verify-role-evidence.mjs, spec/schemas/reviewer-report.schema.json, spec/schemas/quality-stage-report.schema.json, tooling/capabilities.json
Shared integration authority: serialized after declared blockers; may integrate but never weaken, replace, or silently reinterpret a predecessor contract
Risk: high
Model floor: general
Independent roles: required
Patch policy: 1
Golden changes: denied
Test deletion: denied
Allowed paths:

- `.scratch/harness-integrity/issues/05-independent-roles.md`
- `.scratch/harness-integrity/issues/05-independent-roles.evidence/**`
- `AGENTS.md`
- `docs/development/independent-role-assurance.md`
- `package.json`
- `scripts/agent-context`
- `scripts/agent-work`
- `scripts/bind-role-evidence.mjs`
- `scripts/finalize-candidate.mjs`
- `scripts/verify-role-evidence.mjs`
- `scripts/agent-role`
- `spec/schemas/reviewer-report.schema.json`
- `spec/schemas/quality-stage-report.schema.json`
- `spec/schemas/role-attempt.schema.json`
- `spec/schemas/role-attestation-envelope.schema.json`
- `spec/schemas/role-input-manifest.schema.json`
- `spec/schemas/role-ledger.schema.json`
- `tooling/capabilities.json`
- `tooling/quality/role-evidence-policy.mjs`
- `tooling/quality/role-evidence-policy.test.mjs`
- `tooling/roles/registry.json`
- `tooling/roles/prompts/reviewer.md`
- `tooling/roles/prompts/hardener.md`
- `tooling/roles/prompts/qa.md`

## Goal

Make Reviewer, adversarial Hardener, and source-blind QA reports evidence of distinct role executions rather than JSON that the Implementer can fill in and self-assert as independent.

## Acceptance

- Reviewer, Hardener, and source-blind QA use versioned repository prompts with stable IDs and content digests; prompts define allowed inputs, forbidden assumptions, adversarial responsibilities, severity calibration, evidence requirements, and passing conditions.
- One command prepares a minimal role-specific input manifest for the frozen Candidate without copying the Implementer's narrative. Reviewer receives the contract, diff, affected context, and deterministic Evidence; Hardener receives the contract and attack surfaces; QA receives only public contracts, runnable artifacts, and user procedures.
- Every role attempt carries a globally unique attempt ID, parent/orchestrator invocation ID, Implementer identity, prompt ID/digest, provider-neutral model class, frozen Candidate identity, input-manifest digest, source-access mode, Tool Trace references, and attestation strength. An atomic monotonic sequence is reserved under the Git common-state lock; the final append-only ledger is committed beside Work Item Evidence. Attempts transition only `reserved -> running -> completed|failed|invalidated`, and a completed attempt may later become `superseded`. The highest-sequence completed, non-invalidated, non-superseded attempt with no unresolved findings is authoritative; later failed attempts do not erase an earlier valid result, while Candidate invalidation invalidates all attempts.
- The repository defines one versioned normalized attestation-envelope schema containing issuer, verifier ID, native-proof reference/digest, subject/producer, attempt and parent invocation IDs, role, Candidate, prompt/input digests, source-access mode, issued/expiry times, nonce, and attestation strength (`host-attested`, `maintainer-attested`, or `unsupported`). Host adapters authenticate native proof within their own trust boundary before emitting the envelope. Trusted CI derives maintainer fallback from the authenticated repository review identity. The portable verifier validates schema, registered issuer/verifier, expiry, nonce replay, role coverage, and proof digest; it explicitly does not cryptographically prove Host internals.
- Reviewer, Hardener, and QA identities must differ from the Implementer and each other; duplicate IDs, reused attestations, stale/expired attestations, unregistered issuers/verifiers, and self-declared independence fail.
- Every agent-produced Candidate requires Reviewer, Hardener, and QA as distinct invocations against the same frozen Candidate, regardless of change size. This slice amends the operating model's existing small-change exception; human-only Candidates retain maintainer policy. Roles may execute in parallel.
- Role prompt bytes and their ID/digest are frozen in the input manifest. Reports bind to the complete manifest dependency digest; the later gauntlet controller owns change classification and invalidation transitions.
- QA runs from a read-only materialized allowlisted bundle that rejects every symlink, excludes Git metadata and source paths, starts from an empty environment plus an explicit non-secret allowlist, disables network and ambient filesystem access where the Host supports it, permits execution only through declared public artifact launchers, and records the exact delivered-bundle digest and enforced capabilities. Leakage fixtures cover working directory, `.git`, symlinks, environment, prompt text, executable artifacts, errors, and support files; weaker Hosts report their unenforced isolation as attestation limitations.
- Hardener attack surfaces are derived deterministically from the frozen diff, dependency closure, and protected-surface policy. Omitted, unknown, or unavailable affected surfaces are blocking rather than silently absent.
- A Host without isolated subagent execution records an explicit unsupported capability and reason in the Work Item and PR. Its self-authored reports do not pass and the state becomes `needs-independent-roles`. Completion resumes only after repository-registered Host attestations or an authenticated maintainer review supplies every missing role through the same binding interface; issuer, role coverage, Candidate, expiry, and replay protection are validated.
- The adversarial Hardener role is distinct from deterministic hardening gates: it invents failure models and counterexamples, while registered tools execute and preserve the resulting checks.
- Deterministic tests cover valid distinct invocations, attempt retry/supersession/selection, each identity/provenance rejection, issuer/verifier/proof validation, prompt drift, manifest drift, QA source leakage, unsupported-host disclosure, and external fallback binding.
- Agent orientation shows the frozen Candidate, registered prompt versions, completed/missing role invocations, attestation strength, and unsupported-host state without exposing role narratives or user content.
- Public workflow documentation names the commands, schemas, artifact locations, authorized fallback issuer, and exact transitions for preparing role bundles, recording unsupported capability, binding external Evidence, and moving from `needs-independent-roles` back to verification.
- The public role interface is `scripts/agent-role <prepare|record|unsupported|external|status>`. Volatile attempts live under the shared `.agent/role-attempts/` state; accepted ledgers and reports live under the Work Item's committed evidence directory. Host integrations call this interface rather than writing report identity fields directly.

## Dogfood acceptance

- The final Candidate is reviewed by independent low-cost Reviewer, Hardener, and source-blind QA agents through the new protocol.
- Each role reports from its assigned context rather than receiving the full implementation conversation.
- The PR includes machine-verifiable invocation Evidence and a concise report of defects found per role, repeated work avoided, and remaining limitations.

## Notes

Repository validation can make forged independence visible and difficult. Strong identity proof still depends on the Host or authenticated repository review identity. A portable PKI, model-cognition proof, and Host key-management system are deliberately out of scope; the verifier reports attestation strength rather than claiming certainty it cannot provide.
