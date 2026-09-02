# Postmortem: Observer Devtools PR #44

**Status:** Open until PR merges  
**Date:** 2026-09-02  
**Scope:** `observer-devtools` implementation, quality gates, review cycle

## Executive summary

PR #44 took too many turns because implementation, policy integration, mutation hardening, evidence generation, rebasing, and review feedback were handled as one evolving stream instead of as an upfront acceptance plan. Local checks were repeatedly treated as near-completion while CI-specific and reviewer-facing requirements were still unknown or stale.

The result was a long sequence of force-pushes, stale SHA-bound evidence, CI-only failures, and reviewer-discovered behavioral gaps. No quality gate was weakened, but the process optimized for repairing failures after discovery rather than preventing them.

## Impact

- PR remained open through multiple review cycles.
- 34 commits accumulated on feature branch after rebase.
- CI failures included CodeQL fixture validation, Prettier, role-evidence schema/digest drift, trusted-policy identity checks, and strict mutation survivors.
- Reviewer found five real behavior gaps after local tests passed:
  - console redaction
  - deterministic observer completion
  - progress retention
  - byte-boundary truthfulness
  - terminal/failure retention priority
- Review latency and maintainer confidence were reduced.

## Timeline highlights

| Phase | Failure pattern | Why it cost turns |
| --- | --- | --- |
| Initial implementation | Multiple production files added before governance was settled | Mutation registration and integrity policy had to be retrofitted |
| Mutation work | Scoped config changes, restoration, then registration conflicts | Protected config semantics were not modeled before editing |
| Evidence | Reports were manually refreshed across rebases and force-pushes | Base/candidate revisions and file digests repeatedly became stale |
| CI | Local lint path differed from CI formatter/parser behavior | CI was not run early enough after each structural change |
| Review | Behavioral contracts were inferred incompletely | Reviewer exposed gaps not represented in tests |
| Final hardening | New branches increased mutation surface | Implementation complexity was added before proving minimal design |

## Root causes

### 1. No acceptance matrix before coding

Required behavior, API shape, mutation policy, CodeQL constraints, evidence schema, and trusted-policy requirements were not captured in one checklist. Work proceeded from implementation to tests to policy repair to review repair.

### 2. Over-complex first design

The support-bundle cap path added multiple degradation branches. Retention logic evolved incrementally from first-N to progress replacement to terminal priority. Each branch increased mutation surface and created equivalent/unreachable paths.

### 3. Tests followed implementation, not contracts

Tests initially validated ordinary flows and timing-based eventual behavior. They did not define adversarial cases early enough:

- sensitive event through default console sink
- full critical buffer followed by terminal event
- progress in a small bundle
- exact UTF-8 boundary
- awaitable pump completion

### 4. Verification evidence was mutable state

Evidence was refreshed manually after commits and rebases. Because candidate revisions are content-derived and evidence digests are SHA-bound, every source/config change invalidated reports. This caused avoidable schema and digest failures.

### 5. Rebase/force-push workflow amplified drift

Rebasing onto updated `main` produced repeated protected-file conflicts. Conflict resolution temporarily dropped mutation registrations, requiring another repair. Force-pushes also left CI status views showing stale runs until new events arrived.

### 6. Local/CI parity was insufficient

Local targeted ESLint passed while the full candidate formatter failed on a template expression. CodeQL also rejected a test fixture that passed runtime tests. CI-only validators were consulted too late.

### 7. Independent roles were not used as an early design gate

Reviewer, hardener, and source-blind QA agents were used during the work, but too late and against intermediate candidates. Their reports were then invalidated by later source changes, rebases, and force-pushes. The workflow lacked a rule that independent roles must review the same final SHA before PR review.

This mattered because:

- Reviewer did not catch default-console sensitive-event leakage before the external inline review.
- QA validated the available test surface rather than a source-blind adversarial acceptance matrix.
- Hardener exposed mutation debt only after implementation branches had accumulated.
- Evidence refresh repaired report metadata but did not replace stale semantic review.
- No independent agent was assigned to challenge retention priority, exact byte boundaries, and completion semantics together.
- The postmortem itself introduced a Markdown table-formatting lint failure (`MD060`) because exact CI-equivalent lint was not run before pushing documentation. A stale Stryker sandbox also caused noisy local lint behavior. Both were fixed, but this repeated the same premature-completion pattern.

### 8. Completion claims were made before all gates were green

Targeted mutation success and package tests were reported while full mutation, hardener, trusted policy, and reviewer evidence were not all green. This created false closure and extra back-and-forth.

## What went well

- No threshold lowering, ignores, suppressions, or policy bypasses were used.
- Regressions identified by review were converted into tests.
- Strict mutation policy ultimately drove meaningful edge-case coverage.
- Rebase was completed without discarding intended production behavior.
- Final local observer-devtools mutation targets reached 100% with zero survivors.

## Corrective actions

### Completed

- Run exact CI-equivalent lint after documentation changes, not only package-scoped formatter/linter checks.
- Keep generated Stryker sandboxes outside lint inputs or remove them before verification.
- Register all production mutation targets through repository tooling.
- Restore protected quality configuration after scoped experiments.
- Add default console redaction.
- Add awaitable observer attachment completion.
- Implement priority-aware retention.
- Preserve progress when bundle remains under cap.
- Bound envelope/debug fields and verify serialized UTF-8 size.
- Remove unreachable final fallback.
- Add exact byte-cap mutation tests.
- Refresh role evidence after final candidate changes.

### Required before merge

- Candidate CI green.
- Hardener CI green with zero observer-devtools survivors.
- Trusted-policy single-maintainer identity check is an expected repository limitation; maintainer may manually bypass it at merge.
- Final PR review confirms all inline comments resolved.

### Process changes for future PRs

1. Create acceptance matrix before implementation, including CI-only validators.
2. Establish minimal API and state-machine design before adding tests.
3. Add adversarial contract tests before implementation branches.
4. Run independent reviewer, hardener, and source-blind QA in parallel against one frozen candidate SHA before opening PR.
5. Require each role to return structured findings and block on unresolved blocker/high findings.
6. Re-run all independent roles after any production change, rebase, or force-push; metadata refresh alone is insufficient.
7. Never manually edit evidence fields; generate them from final HEAD in one command.
8. Rebase before final hardening, not during review.
9. Avoid force-pushes after external review unless necessary; if required, immediately trigger and inspect fresh CI.
10. Treat “targeted pass” as partial evidence, never completion.
11. Do not report ready until candidate, hardener, integrity, CodeQL, evidence, and trusted-policy gates are all green.
12. Prefer removing production branches over adding tests for behavior that cannot be reached or observed.

## Primary lesson

Correctness was eventually achieved, but process correctness lagged. A quality-heavy repository requires designing implementation and verification together. The next comparable feature should arrive at review with one stable candidate, one generated evidence set, and all gates already green—not discover its acceptance contract through PR comments.
