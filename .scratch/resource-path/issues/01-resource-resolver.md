# Explicit Resource resolver

Status: ready-for-agent

GitHub issue: <https://github.com/iamaamir/promptiris/issues/20>
Branch: `resource-resolver`
Parent: ROADMAP.md
Blocked by: none
Blocks: .scratch/host-path/issues/01-cli-surface.md, .scratch/host-path/issues/02-pi-adapter.md
Parallel-safe: yes; owns Resource reference resolution, limits, and exposure records

## Outcome

Resolve explicitly supplied text and file Resources into bounded, typed content while preserving Host authority and provenance.

## Acceptance

- Resources are references with media type, size, digest, origin, and exposure policy; content is never ambient Run state.
- The Node Host resolves approved text and regular files lazily with realpath containment, byte/time limits, cancellation, and deterministic errors.
- Unsupported binary, directory, special-file, image, and remote references remain typed unresolved Resources rather than guessed content.
- Plugins receive only declared, authorized projections and cannot silently widen exposure.
- Traversal, symlink, race, large-file, encoding, redaction, mutation, Reviewer, Hardener, QA, and full verification pass.

## Non-goals

OCR, image understanding, archive extraction, URL fetching, or a general asset pipeline.
