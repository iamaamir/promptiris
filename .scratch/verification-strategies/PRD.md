# Capability-triggered verification strategies

Status: needs-info
GitHub issue: <https://github.com/iamaamir/promptiris/issues/29>
Parent: ROADMAP.md
Blocked by: none

## Outcome

Activate specialized deterministic verification only when a Work Item touches the matching system
surface, while preserving replayable Evidence and avoiding a permanently expensive global gauntlet.

## Strategy authority

`tooling/quality/test-strategies.json` defines applicability, gate mode, cost, and Evidence contracts.
These Work Items implement providers and activation rules without turning tool presence into a quality
score.
