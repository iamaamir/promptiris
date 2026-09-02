# Generate evidence-backed feature postmortems

Status: ready-for-agent
GitHub issue: <https://github.com/iamaamir/promptiris/issues/51>
Branch: `feature-postmortems`
Parent: .scratch/role-assurance/PRD.md
Blocked by: .scratch/harness-integrity/issues/05-independent-roles.md
Blocks: .scratch/harness-integrity/issues/08-feature-gauntlet.md
Parallel-safe: no; owns feature closeout schema, evidence extraction, and postmortem validation
Conflict domain: postmortem schema, evidence extraction, and closeout binding
Shared integration paths: AGENTS.md, package.json, scripts/agent-context
Shared integration authority: serialized after declared blockers; may integrate but never weaken, replace, or silently reinterpret a predecessor contract
Patch policy: 1
Golden changes: denied
Test deletion: denied
Allowed paths:

- `.scratch/harness-integrity/issues/07-feature-postmortems.md`
- `.scratch/harness-integrity/issues/07-feature-postmortems.evidence/**`
- `AGENTS.md`
- `docs/development/feature-postmortems.md`
- `docs/postmortems/README.md`
- `package.json`
- `scripts/agent-context`
- `scripts/feature-postmortem`
- `spec/schemas/feature-postmortem.schema.json`
- `tooling/quality/feature-postmortem-policy.mjs`
- `tooling/quality/feature-postmortem-policy.test.mjs`
- `tooling/telemetry/postmortem-evidence.mjs`
- `tooling/telemetry/postmortem-evidence.test.mjs`

## Goal

Turn every completed feature into durable, evidence-backed learning about agent behavior, verification pain, escaped defects, repeated work, and automation opportunities without trusting approximate narrative metrics.

## Acceptance

- A structured postmortem schema separates machine-derived facts from agent-authored causal analysis and references artifacts instead of copying large logs.
- The generator requires Candidate/base identity, commits, changed surfaces, elapsed stage times, role invocations/model classes, failed gates, normalized repeated failures, evidence rebindings, Tool Trace counts, verification outcomes, applicable mutation/coverage/CRAP results, and CI status. Every derived value carries an artifact reference/digest; an unavailable value requires a typed reason and cannot be empty when its source artifact exists.
- The author records root causes, defects found and escaped by stage, unnecessary repeated work, residual risks, corrective actions, and automation candidates. Measurable facts use `true`, `false`, or `unknown` with provenance so missing or untrusted history never becomes negative Evidence.
- Validation detects contradictions between narrative claims and repository Evidence, including claims that a required strategy ran when its provider or trace is absent, and prohibits claims of no escapes/repetition when observation coverage is incomplete.
- A feature cannot become locally complete without a valid postmortem under its Work Item evidence directory. Finalization first freezes the Candidate digest excluding that directory; role artifacts bind to the Candidate; the postmortem body then binds to the Candidate plus the ordered role-artifact digests; a deterministic binder finally adds the postmortem-body digest without hashing its own binding field. This non-circular closeout identity is what readiness verifies.
- Corrective actions reference local Work Items before GitHub projections, and repeated action patterns become inputs to the automation-promotion report rather than activating automation automatically.
- Deterministic fixtures cover complete, partial, contradictory, stale, unsupported-host, repeated-failure, missing-trace, and artifact-present-but-field-empty histories.
- The public closeout interface is `scripts/feature-postmortem <generate|validate|status> PACKET`; it writes the structured body and binding under that packet's evidence directory without copying raw logs.

## Notes

Human and agent analysis explains why events happened. Git, CI, Tool Traces, and verification Evidence own measurable facts.
