# Postmortem: PR #46 EventDispatcher Concurrency Tests

**Date:** 2026-09-02
**Author:** Buffy (Codebuff agent)
**PR:** [#46](https://github.com/iamaamir/promptiris/pull/46)
**Branch:** `concurrency-tests`

---

## Summary

PR #46 added model-based and scheduler-based concurrency tests for `EventDispatcher`. The PR required 3 review rounds (1 human, 2 Axiom), 12 commits, and ~45 agent turns to land with all 18 verification gates green. The postmortem identifies why it took so long and what to do differently.

## Timeline

| Phase | Date | Commits | What happened |
|-------|------|---------|---------------|
| Initial implementation | Sep 1 | 6 | Wrote tests, evidence files, lint fixes |
| PR review feedback | Sep 2 | 2 | Rebased, addressed 6 review findings |
| Axiom round 1 | Sep 2 | 2 | Rewrote model, scheduler test, removed broken test |
| Axiom round 2 | Sep 2 | 2 | Cleanup: extracted functions, removed dead code |
| **Total** | | **12** | **4 code, 4 evidence, 2 lint, 2 docs** |

## What Went Wrong

### 1. Tests written without understanding the implementation

The EventDispatcher has a nuanced dispatch pipeline:

- **Progress vs critical overflow** — progress events get `progress-dropped` notifications; critical events trigger detach. The initial model treated all overflow as detach.
- **`dropReported` flag** — prevents duplicate drop notifications per drain cycle. Not modeled at all.
- **Notification dispatch to survivors** — when an observer detaches, surviving observers receive a notification. Not tracked.
- **Terminal event can cause further detachment** — if an observer's buffer is full when the terminal is enqueued, it overflows and gets detached *after* the terminal.

Each gap surfaced as a test failure or review finding.

### 2. Fix-the-flag, not fix-the-system

The first review came back with 6 specific findings. Each was addressed individually:

- "Command test doesn't compare model with real" → added `expectedSequences` tracking
- "Lagging test doesn't verify detach" → added detach assertions
- "fc.scheduler not in use" → updated audit doc

But the underlying model was never validated against the real dispatcher's behavior. Each fix patched one symptom while leaving systemic issues. The Axiom review found the root causes that individual fixes couldn't reach.

### 3. Evidence rebinding overhead

The verification system computes a SHA256 of `git diff --raw` excluding evidence files. Every code change changes the diff hash, requiring:

1. Recompute hash
2. Update 3 evidence JSON files
3. Commit evidence
4. Re-run verification

This created 3 evidence-rebind commits and consumed ~10 turns on bookkeeping alone.

### 4. Full verification not run until late

Individual checks (`vitest run`, `pnpm lint`, `prettier --check`) passed early, but `verify-candidate` wasn't run until the end. Integration issues (evidence schema violations, stale revisions, uncommitted source errors) only surfaced after multiple commits.

### 5. Co-Authored-By violation

The commit template included `Co-Authored-By: Codebuff` trailers. AGENTS.md rule 13 explicitly forbids this. Required rewriting commit history.

### 6. Scheduler test was conceptually wrong

`fc.scheduler()` was used to "test Promise resolution order" but:

- Emits were synchronous — scheduler couldn't control them
- Multiple `next()` calls on the same subscription created concurrent reads (API violation)
- The scheduler only reordered trivially-resolved promises from a pre-filled buffer

The test looked like it tested concurrency but tested nothing.

## What Was Fixed

| Finding | Severity | Fix |
|---------|----------|-----|
| Model doesn't track `#dropReported` | BLOCKER | Added `dropReported` to `ObserverState`, branch on progress vs critical overflow |
| Model doesn't dispatch notifications to survivors | BLOCKER | `notifySurvivors()` helper dispatches detached/drop notifications |
| Scheduler test doesn't test concurrency | BLOCKER | Replaced with `Promise.all([drainEvents(subA), drainEvents(subB)])` |
| Lagging test comment mischaracterizes scenario | BLOCKER | Rewrote comment to match actual behavior |
| Mutation test contradicts itself | HIGH | Removed entirely (own comment concluded E2C) |
| `sink.at(-1)` assertion wrong | HIGH | Terminal may not be last — detached notifications can follow |
| Stale agent report stubs | HIGH | Deleted `.agent/reports/concurrency-tests/` |
| Dead code in `assertMonotonicSequences` | MEDIUM | Removed unreachable undefined checks |
| `handleOverflow` as private method | MEDIUM | Extracted as standalone function |
| `count` parameter misleading | MEDIUM | Removed; loop body already checks `!obs.closed` |
| `fc.constant({})` wrapper noise | LOW | Replaced with plain `it()` block |

## Metrics

| Metric | Value |
|--------|-------|
| Total agent turns | ~45 |
| Commits | 12 |
| Review rounds | 3 |
| Findings fixed | 11 |
| Evidence rebinds | 3 |
| Wall clock | ~25 hours |

## Lessons Learned

### Read before writing

The single most impactful improvement: spend 5 minutes tracing the implementation end-to-end before writing any test. The 5 minutes of reading would have prevented 30+ turns of fixing.

### Run full verification on first commit

`verify-candidate` catches evidence, schema, and integration issues that individual checks miss. Running it on the first commit would have caught 3 rounds of evidence rebinding.

### Validate the model against a concrete example

Pick a specific scenario (subscribe → emit → overflow → complete) and trace it through both the real code and the model side-by-side. If they diverge, the model is wrong.

### Self-review before pushing

The issues Axiom found (dropReported, notifications, scheduler correctness) were all discoverable by reading the code carefully. A 10-minute self-review would have caught them.

### Check project conventions first

The Co-Authored-By rule, the evidence binding process, the verify-candidate gate — these are all documented in AGENTS.md. Read it before writing the first commit.

## Action Items

- [ ] Automate evidence rebinding into a single script
- [ ] Add pre-commit hook that runs `verify-candidate`
- [ ] Create agent checklist for pre-commit validation
