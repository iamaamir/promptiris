# Independent role assurance and streamlined delivery

Status: in-progress
GitHub issue: <https://github.com/iamaamir/promptiris/issues/54>
Parent: ROADMAP.md
Blocked by: none
Blocks: none

## Outcome

Make agent-produced Reviewer, Hardener, and source-blind QA evidence independently executed and inspectable while reducing repeated verification, report bookkeeping, and serial repair loops.

## Slices

- [00 — Seed independent-role workflow slices](../harness-integrity/issues/00-role-work-items.md)
- [05 — Enforce independently executed quality roles](../harness-integrity/issues/05-independent-roles.md)
- [06 — Route work by risk and model floor](../harness-integrity/issues/06-model-routing.md)
- [07 — Generate evidence-backed feature postmortems](../harness-integrity/issues/07-feature-postmortems.md)
- [08 — Orchestrate one non-repetitive feature gauntlet](../harness-integrity/issues/08-feature-gauntlet.md)

## Contract ownership

| Slice | Sole contract ownership |
| --- | --- |
| 05 | Role prompts, per-role input manifests, normalized attestation envelopes, attempt ledger, and role reports |
| 06 | Risk taxonomy, model-floor policy, failure fingerprints, and escalation events |
| 07 | Postmortem facts, analysis, evidence binding, and closeout validation |
| 08 | Candidate invalidation, stage state machine, cache keys, finding consolidation, repair loop, and readiness report |

Every consumer pins a schema version owned by its blocking slice. Compatibility changes require an explicit migration and fixture; dependent slices cannot redefine shared fields locally.

`ready-for-agent` means a packet is sufficiently specified for autonomous work; an unresolved `Blocked by` reference still prevents claiming it. Readiness and dependency availability are deliberately orthogonal.
