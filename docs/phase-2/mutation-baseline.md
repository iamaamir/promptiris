# Mutation baseline

The forced, cache-independent identity-slice run mutates `packages/core/src/index.ts` and `packages/protocol/src/index.ts`. It exists to make test sensitivity inspectable rather than inferred from coverage.

The first generated suite scored 66.67%. Assertions added for Recipe identity, full Run Result structure, lifecycle Event payloads and ordering, duration, exact frame limits, strict header parsing, multi-frame buffering, and mixed valid/invalid Prompt Document blocks raised the forced score to 92.38%. After explicit equivalent-mutant disposition, a second forced run exercised 145 generated mutants and reported 100% mutation score with no survivors or uncovered mutants.

The remaining generated survivors were reviewed rather than hidden:

- Ajv `strict`, `allErrors`, `useDefaults`, and related compiler-construction mutations do not change the exported boolean result for the current valid schema and no-default schema. Their observable non-coercion and non-removal contract is tested. This compiler-policy construction is explicitly mutation-disabled at its source with a rationale; schema compilation and conformance remain mandatory gates.
- The `typeof` half of the lightweight shape guard is required for TypeScript narrowing and intent, but JavaScript safely boxes primitive property reads, making its generated removal behaviorally equivalent. The one operator is explicitly disabled with a source rationale.
- The impossible missing capture branch after exactly one anchored regular-expression match was removed. `Number(undefined)` would still fail the following safe-integer guard if the invariant changed.

The canonical machine report is `.agent/reports/mutation.json` and remains ignored because it is revision-specific evidence. CI regenerates it. Any new survivor must be killed, explicitly classified as equivalent with evidence, or cause the configured threshold to fail; it may not disappear through an unexplained exclusion.
