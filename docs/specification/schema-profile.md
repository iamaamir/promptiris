# Portable JSON Schema profile

Prompt Iris schemas use JSON Schema Draft 2020-12 through a deliberately constrained profile. The profile is the compatibility contract; support for a keyword in one validator does not make it available to Plugins.

## Root requirements

- Every standalone schema declares `$schema: "https://json-schema.org/draft/2020-12/schema"` and a stable absolute `$id`.
- Schema IDs are versioned URIs. Incompatible shape changes receive a new ID.
- `$ref` may target only the same bundled schema set by absolute known ID or local `#/$defs/...` fragment.
- Runtime network resolution and unknown vocabularies are forbidden.
- Schemas themselves pass a Prompt Iris profile meta-schema/linter before registration.

## Allowed keywords

| Group | Keywords |
| --- | --- |
| Identity/reference | `$schema`, `$id`, `$defs`, `$ref` |
| Documentation | `title`, `description`, `deprecated`, `examples`, `default` |
| Common validation | `type`, `enum`, `const` |
| Numeric | `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf` |
| String | `minLength`, `maxLength`, `pattern`, `format` |
| Array | `items`, `prefixItems`, `minItems`, `maxItems`, `uniqueItems` |
| Object | `properties`, `required`, `additionalProperties`, `minProperties`, `maxProperties`, `propertyNames`, `dependentRequired` |
| Composition | `allOf`, `anyOf`, `oneOf` |

`pattern` is limited to a linted cross-language regular-expression subset: literals, character classes, Unicode code-point escapes, grouping, alternation, anchors, and bounded/common quantifiers. Lookaround, backreferences, named captures, engine flags, and implementation-specific escapes are rejected.

`format` is an assertion, not an annotation, and v1 permits only `date-time`, `date`, `time`, `duration`, `email`, `hostname`, `ipv4`, `ipv6`, `uri`, `uri-reference`, `uuid`, `json-pointer`, and `regex` where the last uses the portable subset. Both runtimes use conformance fixtures for canonical edge cases.

`default` is annotation-only during validation. The configuration resolver may deliberately read a single valid default while producing provenance; validators never mutate instances.

## Excluded in v1

- `$dynamicRef`, `$dynamicAnchor`, `$anchor`, `$vocabulary`, custom keywords, and remote references;
- `unevaluatedProperties`, `unevaluatedItems`, `contains`, `minContains`, `maxContains`, `dependentSchemas`, `patternProperties`, `not`, and `if`/`then`/`else`;
- content decoding/assertion keywords and schema-driven coercion;
- ambiguous unions whose branches can validate the same value when used as protocol discriminators.

Exclusion does not mean these features are defective. They are omitted because evaluation order, annotation collection, regex behavior, code generation, or cross-implementation support would enlarge the v1 compatibility surface without a current contract requiring them.

## JSON value restrictions

Protocol JSON is stricter than a language's generic JSON parser:

- duplicate object names are invalid;
- numbers are finite; integers are within JavaScript's exact safe range unless represented by a schema-defined decimal string;
- strings contain valid Unicode scalar sequences with no unpaired surrogates;
- object keys are strings;
- parsers enforce the negotiated byte and depth limits before validation.

## Implementations and conformance

The Node runtime uses Ajv's Draft 2020-12 implementation in strict, all-errors, non-mutating mode with remote loading disabled and error counts bounded. The Go client/runtime utilities use `github.com/santhosh-tekuri/jsonschema/v6` with format assertions enabled and an in-memory bundled registry. TypeBox may author structural schemas, but emitted JSON Schema files are reviewed and are the runtime authority.

CI runs:

1. the profile meta-schema/linter against every shipped and fixture schema;
2. the applicable official JSON Schema Test Suite cases in both validators;
3. Prompt Iris positive/negative/limit fixtures through Node and Go;
4. differential output checks so both implementations agree on validity, normalized instance path, keyword, and bounded error category;
5. Bowtie reports as ecosystem evidence, not as a substitute for the project fixtures.

Validation never inserts defaults, coerces types, removes unknown fields, or normalizes strings. Error wording is implementation-specific; only normalized paths, keywords, and Prompt Iris Diagnostic codes are portable.
