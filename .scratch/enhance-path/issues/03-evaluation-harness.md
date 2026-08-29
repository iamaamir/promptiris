# Enhancement evaluation harness

Status: ready-for-agent

GitHub issue: <https://github.com/iamaamir/promptiris/issues/12>
Branch: `enhance-evaluation`
Parent: ROADMAP.md
Blocked by: .scratch/enhance-path/issues/01-default-enhance.md, .scratch/enhance-path/issues/02-guard-renderer.md
Blocks: .scratch/release-path/issues/02-release-evidence.md
Parallel-safe: yes; owns evaluation corpora, graders, reports, and release thresholds

## Outcome

Make enhancement quality a reproducible release decision rather than a subjective demo.

## Acceptance

- Versioned train/development/held-out splits cover intent preservation, usefulness, robustness, injection resistance, and fail-open behavior.
- Deterministic graders run first; calibrated model or human grading is isolated, versioned, and auditable where semantics require it.
- Baseline, candidate, and regression reports record Provider/model configuration, prompt version, seeds where supported, cost, latency, and artifacts.
- Thresholds and uncertainty rules prevent tuning against held-out examples and prevent regression masking by averages.
- The harness can compare the neutral Recipe and optional target adapters without making one model mandatory.
- Reproducibility, Reviewer, Hardener, QA, and full verification pass.
