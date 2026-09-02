# Observer devtools and support bundles

Status: complete

GitHub issue: <https://github.com/iamaamir/promptiris/issues/8>
Branch: `observer-devtools`
Parent: ROADMAP.md
Blocked by: none
Blocks: .scratch/host-path/issues/02-pi-adapter.md
Parallel-safe: yes; owns the devtools Observer, bounded debug projections, and support-bundle format

## Outcome

Provide an official Observer Plugin for progress, failure inspection, Plugin development, and privacy-safe support bundles.

## Acceptance

- The Observer consumes standard dispatcher Events and Debug Records without changing Run outcomes or inventing an event dialect.
- Console and machine-readable sinks show stage progress, fallback, cancellation, Plugin identity, timings, and artifact references.
- Support bundles are explicit, bounded, deterministic, redacted by default, and contain manifests/config traces by reference rather than secrets or prompt content.
- Sink failure, backpressure, and disposal cannot fail the transformation.
- Plugin authors can use the same package and testkit without runtime internals.
- Privacy, adversity, mutation, Reviewer, Hardener, source-blind QA, and full verification pass.
