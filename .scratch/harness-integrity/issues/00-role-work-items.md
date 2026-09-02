# Seed independent-role workflow slices

Status: complete
GitHub issue: <https://github.com/iamaamir/promptiris/issues/53>
Branch: `role-work-items`
Parent: .scratch/role-assurance/PRD.md
Blocked by: none
Blocks: .scratch/harness-integrity/issues/05-independent-roles.md
Parallel-safe: no; owns only the local/GitHub planning packets for the approved workflow changes
Conflict domain: role-assurance planning packets and their GitHub projections
Risk: medium
Model floor: general
Independent roles: required
Patch policy: 1
Golden changes: denied
Test deletion: denied
Allowed paths:

- `.scratch/role-assurance/PRD.md`
- `.scratch/harness-integrity/issues/00-role-work-items.md`
- `.scratch/harness-integrity/issues/00-role-work-items.evidence/**`
- `.scratch/harness-integrity/issues/05-independent-roles.md`
- `.scratch/harness-integrity/issues/06-model-routing.md`
- `.scratch/harness-integrity/issues/07-feature-postmortems.md`
- `.scratch/harness-integrity/issues/08-feature-gauntlet.md`

## Goal

Turn the approved independent-role, model-routing, postmortem, and streamlined-gauntlet plan into locally authoritative, independently pickable Work Items with synchronized GitHub projections.

## Acceptance

- The changed planning payload is exactly `.scratch/role-assurance/PRD.md`, this seed packet, and issues 05–08; only this seed's evidence directory may accompany those six contract files. The four implementation packets have unique short branches, canonical statuses, one parent, an acyclic reciprocal dependency graph, non-overlapping contract ownership, explicit Conflict Domains, patch authority, and deterministic acceptance. Reciprocity applies to implementation-packet `Blocked by`/`Blocks` edges; `Parent` and the PRD's `Slices` index are hierarchy, not dependency edges. This seed's independent review checks the declared graph, while issue 08 requires the implemented preflight to reject self-edges, cycles, duplicate/missing nodes, non-reciprocal edges, parent mismatch, duplicate branches, and overlapping concurrently writable domains.
- Each implementation packet authorizes only its own packet/evidence path plus named implementation surfaces; it cannot edit sibling Work Items or redefine a blocking slice's schema. Slice-owned schemas, policy modules, tests, and role/postmortem/gauntlet registries use exact paths rather than shared-directory wildcards. Shared integration surfaces are named separately, remain serialized by the dependency graph, and may integrate a predecessor contract but may not weaken, replace, or silently reinterpret it.
- Independent Reviewer, adversarial Hardener, and source-blind QA challenge one frozen seed Candidate through separate attempts. Reports conform to the existing role schemas, bind to the Candidate, and every reported finding ID appears exactly once in an append-only disposition artifact as accepted, rejected with technical rationale, or invalidated by contradictory Candidate bytes.
- At one frozen Candidate revision, independent source-blind QA freshly runs `scripts/issue-sync check` separately for the parent and all five child projections, proving their managed bodies, identity digests, statuses, parent, and dependency relationships match local authority. A Candidate-bound `projection-check.json` in this seed's Evidence directory records every exact command, exit status, local managed-body digest, and result; the schema-validated QA report references its exact digest and `scripts/verify-role-evidence.mjs` validates that reference and the shared Candidate identity. The record is an audit artifact, never authority by itself: readiness requires the fresh successful QA execution and maintainer review, while post-merge completion requires a separate maintainer rerun and closeout. Any stale digest, partial relationship, remote-body conflict, unexpected closure, missing Evidence, or command failure blocks readiness. Existing outage and idempotent-retry behavior remains governed by the issue-sync contract rather than reimplemented here.
- Markdown validation, diff integrity, candidate finalization, `scripts/verify-role-evidence.mjs`, and the applicable documentation Candidate gates pass with artifact references. The Candidate digest includes all six planning contracts and excludes only this seed's evidence directory; any contract, prompt, schema, policy, or planning change invalidates every semantic role report.
- This planning Candidate adds no implementation and does not claim that issues 05–08 are complete, green, or executable.
- Future implementation issues remain `ready-for-agent` as specifications but cannot be claimed while a declared blocker is active. After every internal gate passes, the issue-owning agent runs `scripts/agent-work release .scratch/harness-integrity/issues/00-role-work-items.md ready-for-human`; it never self-declares integration completion. The PR uses `Closes #53`. After merge, the maintainer records the seed's local `complete` status and synchronized closure from the integration revision. Issue 05 may start only after `origin/main` contains the exact planning payload and the local seed is terminal, from a clean `independent-roles` branch whose merge base equals that integration revision.
- Dependent agents treat a retained `Blocked by` reference as resolved only when every referenced local packet has terminal `complete` status, preserving dependency history without manually deleting it.
- Post-merge completion requires `.scratch/harness-integrity/issues/00-role-work-items.evidence/bootstrap-closeout.json`. Its versioned record contains the authenticated maintainer identity, integration revision, frozen Candidate digest, exact changed-path result/digest, and ordered local path, managed-body digest, remote status, and relationship digest for the parent plus issues 53 and 49–52. The record is valid only when `origin/main` contains the planning payload unchanged, all six `issue-sync check` commands pass from that revision, issue 53 is closed by the merge, and every dependent projection remains consistent; missing, stale, tampered, or partially verified closeout blocks local `complete` status and issue 05.
- Any Candidate, contract, prompt, schema, policy, planning, or projection-identity change invalidates all semantic role reports, append-only dispositions, readiness state, projection claims, and bootstrap closeout derived from the prior Candidate. They must be regenerated rather than rebound.

## Notes

Trusted policy intentionally reads patch authority from the base revision. Because this packet creates that authority, its seed PR is a visible bootstrap boundary: candidate-local integrity and independent role Evidence are necessary but cannot self-authorize merge. Only the maintainer may merge after confirming the changed path set is limited to this packet's planning/evidence allowlist. Implementation begins only after the packet is in the trusted base.

No Candidate-controlled file can prove the maintainer's identity before integration. The authenticated GitHub merge event is the external trust boundary; its actor and integration revision become inputs to `bootstrap-closeout.json`. Before that event, the Candidate can become only `ready-for-human`, never `complete`, and no report, projection record, or agent assertion can substitute for the maintainer's review and merge.

This bootstrap must edit the sibling contracts it creates, so their base-revision immutability cannot exist yet. The frozen Candidate digest, independent role reports, exact changed-path predicate, and maintainer-only merge are the explicit bootstrap controls; future implementation packets become base-authoritative and cannot edit siblings.
