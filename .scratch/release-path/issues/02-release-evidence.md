# Release evidence and beta matrix

Status: ready-for-agent

GitHub issue: <https://github.com/iamaamir/promptiris/issues/19>
Branch: `release-evidence`
Parent: ROADMAP.md
Blocked by: .scratch/provider-path/issues/03-provider-doctor.md, .scratch/enhance-path/issues/03-evaluation-harness.md, .scratch/discovery-path/issues/01-plugin-discovery.md, .scratch/host-path/issues/02-pi-adapter.md, .scratch/release-path/issues/01-adjacent-bundle.md
Blocks: none
Parallel-safe: no; owns release workflows, provenance, compatibility matrix, public beta docs, and publication gates

## Outcome

Publish only from a revision whose behavior, packages, provenance, and quality evidence are reproducible and inspectable.

## Acceptance

- The matrix covers supported Node/Go/OS/architecture/libc, CLI, Pi, Provider, Plugin, failure, installation, upgrade, and offline paths.
- Packages include licenses, SBOM, checksums, attestations, and signing or an explicit unsigned-beta warning.
- Versioning and protocol compatibility are consistent across packages, schemas, runtime payloads, and lockfiles.
- Clean extracted artifacts pass conformance and smoke tests without hidden workspace state.
- Default Enhance meets frozen release thresholds and every required quality/evidence gate is revision-bound.
- Third-party-style Plugin and Provider examples use public APIs only.
- Reviewer, Hardener, source-blind QA, and full release verification report no unresolved blocker/high finding.
