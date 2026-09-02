# Orchestrate one non-repetitive feature gauntlet

Status: ready-for-agent
GitHub issue: <https://github.com/iamaamir/promptiris/issues/52>
Branch: `feature-gauntlet`
Parent: .scratch/role-assurance/PRD.md
Blocked by: .scratch/harness-integrity/issues/05-independent-roles.md, .scratch/harness-integrity/issues/06-model-routing.md, .scratch/harness-integrity/issues/07-feature-postmortems.md
Blocks: none
Parallel-safe: no; owns the end-to-end stage controller and consolidated repair loop
Conflict domain: gauntlet state machine, invalidation, cache, consolidation, and readiness
Shared integration paths: AGENTS.md, package.json, scripts/agent-context, scripts/agent-work, scripts/verify-candidate
Shared integration authority: serialized after declared blockers; may integrate but never weaken, replace, or silently reinterpret a predecessor contract
Patch policy: 1
Golden changes: denied
Test deletion: denied
Allowed paths:

- `.scratch/harness-integrity/issues/08-feature-gauntlet.md`
- `.scratch/harness-integrity/issues/08-feature-gauntlet.evidence/**`
- `AGENTS.md`
- `docs/development/feature-gauntlet.md`
- `package.json`
- `scripts/agent-context`
- `scripts/agent-work`
- `scripts/feature-gauntlet`
- `scripts/verify-candidate`
- `spec/schemas/feature-gauntlet-state.schema.json`
- `spec/schemas/feature-gauntlet-cache.schema.json`
- `tooling/quality/feature-gauntlet-policy.mjs`
- `tooling/quality/feature-gauntlet-policy.test.mjs`
- `tooling/telemetry/gauntlet-events.mjs`
- `tooling/telemetry/gauntlet-events.test.mjs`

## Goal

Provide one resumable feature workflow that keeps strict stages and independent judgment while eliminating duplicated exploration, repeated deterministic checks, serial finding delivery, and manual Evidence bookkeeping.

## Acceptance

- A versioned state machine permits `specified -> implementing -> preflight -> frozen -> roles-running -> changes-required|final-verification -> postmortem -> ready-for-human`, with side states `needs-independent-roles`, `needs-classification`, `escalated`, `failed`, and `cancelled`. Guarded transitions are atomic under the Work Item lease, idempotent for the same event ID, reject concurrent writers, and preserve terminal state unless an authenticated maintainer starts a new Candidate cycle.
- Early preflight runs affected deterministic checks without pretending to be final SHA-bound verification. Final verification runs only after the Candidate and required semantic roles are stable.
- Reviewer, Hardener, and source-blind QA receive progressive role-specific bundles and return one consolidated finding packet. A production repair invalidates and reruns all semantic roles; evidence-only closeout does not.
- The consolidated packet is an append-only aggregation retaining every immutable finding ID, severity, source role/attempt, disposition, and repair Evidence; deterministic count/completeness checks prevent dropped, rewritten, or falsely resolved findings.
- Valid deterministic Evidence is reused only when a canonical key matches Candidate/base identity, role, prompt digest, delivered-bundle digest, policy/schema/tool/controller versions, environment class, Host attestation, and declared dependency closure. Roles reference it rather than rerunning mechanical checks or copying logs into model context.
- The existing canonical Candidate identity algorithm owns sorted repository-relative paths, Git raw diff bytes, additions/modifications/renames/deletions, base revision, and the Work Item evidence exclusion. Git-derived path and language import/dependency closure—not author labels—decides whether a repair is evidence-only. Every non-evidence change, prompt/schema/policy/controller change, or transitive verifier dependency change invalidates all semantic roles and dependent caches.
- Interrupted execution resumes from content-addressed external state only after artifact existence/digests, Candidate identity, controller/schema versions, and attestation validity are rechecked. Replacement agents can orient without conversation history or repeating valid stages.
- Repeated normalized failures stop the ordinary loop and emit the model-routing escalation event. The issue-owning orchestrator records assumption review or raises the model floor, and the controller exposes the exact suspended/resume state instead of retrying blindly.
- The final readiness report has a public schema, repository location, generation command, and exhaustive unresolved-condition codes. It is compact, reference-based, and cannot claim completion while a required role, gate, postmortem, escalation decision, or unsupported-host disclosure remains unresolved.
- The public controller is `scripts/feature-gauntlet <preflight|freeze|roles|repair|verify|closeout|status> PACKET`; its readiness report is `<packet>.evidence/readiness.json`, and every subcommand emits a typed, idempotent transition event.
- A deterministic end-to-end fixture proves success, semantic repair, stale Evidence invalidation, cache-key collision resistance, tampered/deleted resume artifacts, controller-version drift, interruption/resume, unsupported subagents, repeated-failure escalation, and no duplicated valid checks.
- Readiness resolution validates the local dependency graph atomically: self/cyclic/duplicate/non-reciprocal edges, parent mismatch, conflicting status, stale projection, and non-terminal blockers fail before a claim or transition.

## Notes

The repository prepares packets, validates Evidence, and controls deterministic transitions. Host integrations launch model invocations; the repository does not pretend one portable shell script can spawn subagents in every agent harness.
