# Examples

## Brownfield audit

Request:

```text
Use agent-native-repository in audit mode. Inspect the current dirty tree,
existing CI, contributor instructions, tests, and reports. Classify only
demonstrated maturity. Make no changes.
```

Expected result:

- demonstrated maturity level;
- partial higher-level capabilities;
- inspected versus executed evidence;
- contradictory or duplicate sources of truth;
- smallest useful next increment.

## Greenfield bootstrap

Request:

```text
Bootstrap Level 1. Add a small agent constitution, one work-item convention,
and a read-only context command. Reuse the existing test command and do not
add dependencies or CI.
```

Expected behavior:

- detect and merge with existing instructions;
- keep conditional guidance outside the root constitution;
- make the context command work on a dirty tree;
- verify shell syntax and actual output;
- report changed files and remaining Level 2 gap.

## Replacement worker

Request:

```text
Use reorient mode. Continue the active task without using prior conversation
history. Reuse fresh evidence and identify one next action.
```

Expected behavior:

- run the repository context entrypoint;
- identify exact state, task, contracts, and evidence;
- expand only directly relevant references;
- state missing repository knowledge when continuation still depends on private explanation.

## Hardening

Request:

```text
Use harden mode on the changed state-machine package. Prefer current tools,
run affected checks first, and do not lower existing thresholds.
```

Expected behavior:

- select evidence according to changed risk;
- distinguish coverage, mutation, property/state, compatibility, and adversity claims;
- reduce surviving mutants through meaningful assertions or code removal;
- record narrow equivalent-mutant rationale where unavoidable.

## Automation evolution

Request:

```text
Use evolve mode. Analyze existing operational tool traces read-only. Report
repeated sequences that may merit deterministic automation. Do not create or
register scripts.
```

Expected behavior:

- respect the declared measurement boundary;
- require repetition across independent tasks;
- distinguish automation opportunity from workflow or architecture defects;
- report candidate economics and trace references;
- recommend review, not self-activation.
