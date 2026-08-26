---
status: accepted
---

# Constrain the portable JSON Schema dialect

Meta Prompt will use an explicit subset of JSON Schema Draft 2020-12 rather than treating every feature accepted by Ajv as portable. The full dialect offers more expressive schemas, but dynamic references, unevaluated semantics, regex differences, mutation options, and custom vocabularies make cross-language validation and generated types less predictable; the profile can expand only with Node/Go conformance evidence and a protocol revision when necessary.

## Consequences

Every schema is linted against the profile, bundled without runtime network resolution, and differentially tested in Ajv and `santhosh-tekuri/jsonschema/v6`. Plugin authors trade some schema expressiveness for deterministic behavior across Hosts and languages.
