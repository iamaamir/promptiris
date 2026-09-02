# Route work by risk and model floor

Status: ready-for-agent
GitHub issue: <https://github.com/iamaamir/promptiris/issues/50>
Branch: `model-routing`
Parent: .scratch/role-assurance/PRD.md
Blocked by: .scratch/harness-integrity/issues/05-independent-roles.md
Blocks: .scratch/harness-integrity/issues/08-feature-gauntlet.md
Parallel-safe: no; owns Work Item risk classification, model-floor policy, and projected labels
Conflict domain: Work Item risk policy, model-floor labels, and escalation events
Shared integration paths: AGENTS.md, package.json, scripts/agent-context, scripts/agent-work, scripts/issue-sync, scripts/verify-role-evidence.mjs
Shared integration authority: serialized after declared blockers; may integrate but never weaken, replace, or silently reinterpret a predecessor contract
Patch policy: 1
Golden changes: denied
Test deletion: denied
Allowed paths:

- `.scratch/harness-integrity/issues/06-model-routing.md`
- `.scratch/harness-integrity/issues/06-model-routing.evidence/**`
- `AGENTS.md`
- `docs/development/model-routing.md`
- `package.json`
- `scripts/agent-context`
- `scripts/agent-work`
- `scripts/issue-sync`
- `scripts/verify-role-evidence.mjs`
- `spec/schemas/model-routing.schema.json`
- `spec/schemas/model-escalation.schema.json`
- `tooling/quality/model-routing-policy.mjs`
- `tooling/quality/model-routing-policy.test.mjs`

## Goal

Express task criticality and minimum model capability independently so inexpensive models remain the default without silently assigning weak reasoning to high-consequence work.

## Acceptance

- Work Items declare exactly one `risk:low|medium|high|critical` classification and one provider-neutral `model-floor:quick|general|frontier` classification.
- Checked-in policy owns this minimum mapping: low and medium risk permit `quick`, high requires `general`, and critical requires `frontier`. Protocol, Kernel, configuration, Provider, native-Plugin, concurrency, public API, and verifier changes are at least high; authentication, secret handling, sandboxing, trust-policy, and supply-chain controls are critical. Deterministic path plus TypeScript/Go import graphs classify direct and transitive affected surfaces. The highest applicable classification wins; unknown, mixed, conflicting, or newly introduced surfaces enter a typed `needs-classification` state that only an authenticated maintainer policy change can resolve.
- The Work Item's model floor constrains the issue-owning Implementer/orchestrator. Independent challenge roles record their actual provider-neutral model class but use a separate role policy: `quick` is the default for cost and diversity, while repeated normalized failure, protected-surface review, or an explicit role-specific floor causes monotonic escalation. A challenge role below the Implementer floor is not itself a violation unless the role policy requires the higher class; inexpensive roles may add Evidence but never erase a stronger role's unresolved finding.
- Repeated normalized failures use a versioned fingerprint and checked-in retry threshold. A typed escalation event records the triggering Evidence, requesting role, authority, previous/new floor, and resume state; floors are monotonic for the Candidate, and successful cheap execution never retroactively lowers declared risk.
- GitHub projection manages visible risk and model-floor labels while preserving local packets as authority and preserving unrelated remote labels.
- Deterministic tests cover every matrix row and protected taxonomy class, direct and transitive classification, precedence, unknown/mixed/conflicting surfaces, protected downgrade rejection, maintainer adjudication, versioned failure normalization, monotonic escalation, missing/conflicting labels, issue synchronization, and dashboard/orientation visibility.

## Notes

Risk measures consequence; model floor measures required reasoning capability. They are intentionally separate because a mechanically small security change may still require frontier review.
