# Reorientation workflow

The goal is to compile minimum sufficient current context, not summarize project history.

## Required inputs

- exact repository root;
- HEAD, base, and candidate state;
- staged, unstaged, and untracked changes;
- active Work Item and acceptance criteria;
- current stage and lease/owner if present;
- relevant public contracts and decisions;
- last fresh evidence and known invalidation;
- next unresolved action.

## Retrieval order

1. Run the repository's context command when present.
2. Inspect Git delta and task state.
3. Read root instructions and only directly relevant conditional policy.
4. Follow references to affected contracts, symbols, and tests.
5. Reuse fresh evidence; execute only missing or invalidated checks.
6. Expand to broader architecture only when the task crosses a conflict domain or failures repeat.

## Orientation packet

Emit three layers:

1. mandatory constraints, failures, stale or missing evidence;
2. objective, current delta, relevant contracts/tests, and next action;
3. references for deeper deterministic expansion.

Do not paste unchanged files, full logs, or conversation summaries.

## Continuity test

A new worker should be able to:

1. identify the candidate and bounded objective;
2. explain what is already verified and against which state;
3. locate the next relevant file/test without broad exploration;
4. continue or report a concrete blocker;
5. return a structured handoff with references.

If private explanation from the previous worker is required, record the missing decision, contract, task state, or evidence in the repository before continuing.
