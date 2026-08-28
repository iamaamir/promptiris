# Quality gauntlet

Quality is a vector of independent claims. Select applicable evidence by risk; one strong result never offsets another required failure.

## Responsibilities

```text
bounded work item
  -> specifier
  -> implementer
  -> cleaner
  -> hardener
  -> source-blind QA
  -> deterministic verifier
  -> integration queue
```

These are evidence boundaries, not a mandatory number of agents.

## Evidence classes

| Class | Candidate defenses |
| --- | --- |
| Structure | Complexity/CRAP, duplication, dependency direction, dead code, tested architecture rules |
| Test sensitivity | Coverage plus mutation with survivor and exclusion disposition |
| Generated state space | Property, state-model, and fuzz tests with replay and minimized regressions |
| Cross-implementation | Shared differential and conformance fixtures |
| Public compatibility | API reports, schema/profile comparison, generated drift |
| Runtime adversity | Cancellation, race, fault, termination, leak, and resource-limit tests |
| Security/supply chain | Structural/data-flow policy, secret scan, reachable vulnerability/license evidence |
| Performance/resources | Versioned startup, latency, memory, allocation, and artifact-size budgets |
| Evidence integrity | Revision/input/tool binding, replay, clean execution, and invalidation |
| Product behavior | Source-blind public-path scenarios and deterministic replays |

## Cleaner guidance

- Use CRAP as a risk locator, not a universal style score.
- Review public API growth and dependency direction.
- Remove redundant behavior before adding contrived tests.
- Preserve accepted behavior while simplifying structure.

## Hardener guidance

- Mutation measures whether tests constrain plausible faults; coverage only measures execution.
- Track aggregate and critical-target mutation floors plus survivor, uncovered, and ignored ceilings.
- Classify equivalent mutants narrowly with observable rationale; never use broad unexplained exclusions.
- Promote generated counterexamples into permanent regression fixtures.
- Test failure containment and safe fallback, not only success.

## Profiles

- Fast/affected: cheapest relevant feedback during implementation.
- Candidate: every applicable changed and affected invariant.
- Integration: reuse fresh candidate evidence and rerun invalidated combined closures.
- Scheduled/release: deliberate clean, whole-system, long-running, platform, security, and performance evidence.

The verifier owns policy. Tool adapters emit findings and cannot waive gates.
