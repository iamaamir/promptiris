# Protocol, configuration, and public types

## Canonical data model

`PromptDocument` is the canonical, text-first input envelope. A string overload constructs a document containing one text block. Plugins exchange immutable JSON-compatible values and versioned, namespaced Artifacts.

Its minimum conceptual contract is:

```ts
interface PromptDocument {
  schemaVersion: "1";
  content: TextBlock[];
  context?: Array<TextBlock | ResourceReference>;
  constraints?: Constraint[];
  protections?: Protection[];
  extensions?: Record<NamespacedId, JsonValue>;
}
```

`content` contains the user's Input. `context` is separate so Host-supplied material is never confused with the user's words. Constraints contain only requirements explicitly supplied by the user or Host; inferred constraints are analysis Artifacts. Generated assumptions, Diagnostics, Run identity, and transformation Artifacts are not stored in the Prompt Document.

A Protection is exact and Kernel-enforced. Any Patch operation that overlaps its Protected Span is rejected before application; edits outside the span may rebase its position. Removing or replacing a containing block is rejected unless the Kernel can prove the exact protected text survives at one unambiguous location. Protections and explicit constraints are immutable after Run start.

A Semantic Constraint is meaning-level policy, not a Protection mode. Guard Plugins evaluate it during `validate` and return their declared warning, degradation, or blocking outcome according to Recipe and Host policy. The Kernel never claims it has mechanically protected an intent, API contract, or other semantic property.

Each block has a stable ID. V1 guarantees inline text but does not embed arbitrary binary data. A Resource Reference carries a URI, optional media type/name/digest, and no implied authority to read it. The Host must explicitly supply the reference, and an authorized, capability-declared Plugin must resolve or interpret it. The Kernel never opens files or fetches URLs. Unsupported resources produce a degradation Diagnostic and are never silently discarded.

Resource loaders may derive text or other Artifacts; modality Plugins may later provide image analysis, PDF extraction, OCR, or transcription. Provider/target adaptation may pass supported native resources to a model. Recipes declare capabilities such as `input.text`, `resource.load`, or a future `input.image`. This preserves a forward path for multimodal Recipes without imposing binary transport, model support, token accounting, and media security on v1.

### Patch contract

Plugins return typed Meta Prompt Patches rather than arbitrary JSON Patch documents or mutable Prompt Documents:

```ts
interface Patch {
  id: string;
  baseRevision: number;
  operations: PatchOperation[];
}

type PatchOperation =
  | ReplaceText
  | InsertContentBlock
  | ReplaceContentBlock
  | RemoveContentBlock
  | SetNamespacedExtension;
```

Operations target stable block IDs instead of array positions. Text and block replacements include an expected digest where appropriate; the Kernel rejects stale revisions or mismatched preconditions. All operations in one Patch are atomic, schema-validated, size-bounded, and applied in declared order. A failure rejects the complete Patch and produces a Diagnostic.

Plugins cannot Patch Run identity, provenance, Diagnostics, Kernel-owned fields, or explicit constraints and protections after a Run starts. A Plugin may write only its own namespaced extension data. Context enrichment normally produces an Artifact rather than rewriting Host-supplied Context. The Kernel records the applied diff and sufficient inverse information for inspection and internal rollback; Plugin authors do not implement rollback callbacks.

Patch operation types are a versioned protocol union. Unknown operations are rejected rather than dynamically executed, because every language implementation and the Kernel must share their validation and application semantics. Arbitrary domain output remains extensible through typed Artifacts, not custom mutation opcodes.

Text Patches and Protected Spans use one selector:

```ts
interface TextSelector {
  blockId: string;
  revision: number;
  range: {
    unit: "unicode-scalar";
    start: number;
    end: number;
  };
  quote: {
    exact: string;
    prefix?: string;
    suffix?: string;
  };
}
```

Ranges are zero-based and half-open. Offsets count Unicode scalar values, and both endpoints must lie on extended grapheme-cluster boundaries. Text is compared without normalization. The quoted value must equal the selected text. Prefix and suffix are optional evidence for disambiguation and debugging, never permission for fuzzy application. Stale Plugin Patches are rejected; the Kernel deterministically rebases active Protected Spans after accepted non-overlapping edits. SDK utilities own conversion from JavaScript UTF-16 indexing, Go byte indexing, and editor coordinates.

The generic primary Artifact has this conceptual shape:

```ts
interface Artifact<T extends JsonValue | ResourceReference = JsonValue> {
  schemaVersion: "1";
  id: string;
  kind: NamespacedId;
  mediaType: string;
  dataSchema?: SchemaReference;
  value: T;
  digest?: string;
  provenance: Provenance;
  classification: "public" | "internal" | "sensitive";
  extensions?: Record<NamespacedId, JsonValue>;
}
```

Artifact IDs are Kernel-stamped and unique within a Run. `kind` identifies semantics and is namespaced; `mediaType` identifies representation; `dataSchema` identifies structured value shape. JSON-compatible inline values and Resource References are portable, while arbitrary binary blobs are not. A digest is required for referenced content and optional for small inline values. Provenance records producer Plugin/contribution/invocation, phase, parent Artifact IDs, Patch IDs, and model-call reference where applicable. Credentials are prohibited regardless of classification.

Recipes declare which produced kinds are internal, exposed, eligible as alternatives, and eligible as the Primary Artifact. A Plugin cannot expose its own Artifact merely by labeling it public. The Kernel enforces the intersection of Recipe declaration, Artifact classification, and Host policy.

A Result has the following stable envelope:

```ts
interface RunResult {
  schemaVersion: "1";
  runId: string;
  recipe: LockedRecipeReference;
  status: "success" | "degraded" | "blocked" | "cancelled" | "failed";
  primary?: Artifact;
  primaryOrigin?: "transformed" | "original";
  alternatives: Artifact[];
  exposed: Record<NamespacedId, Artifact[]>;
  assumptions: Assumption[];
  clarifications: Clarification[];
  diagnostics: Diagnostic[];
  summary: RunSummary;
}
```

The `primary` member is required for `success` and for any fail-open `degraded`, `cancelled`, or `failed` outcome that can safely return the original Input. It may be absent for blocked preflight and failures before a safe Artifact exists. Alternatives and exposed Artifacts contain only Recipe-declared outputs. Internal Artifacts, Debug Records, full event journals, resolved secrets, and raw provider payloads never enter the Result.

`RunSummary` contains timestamps/duration, completed/failed/skipped phases, bounded usage and cost when reported, trace ID, and degradation flags. It does not duplicate the event journal. `result.prompt` remains an SDK accessor only when the Primary Artifact declares prompt semantics.

Run status is one of `success`, `degraded`, `blocked`, `cancelled`, or `failed`. Primary origin records `transformed` or `original`. Ordinary operational outcomes are returned as typed Results; immediate API misuse may throw.

## Provider abstraction

A `ModelProvider` resolves a logical Model Binding to a Model that exposes capabilities, generation, optional streaming, and close. A common request includes prompt or messages, expected schema, maximum output, common sampling controls, deadline/cancellation, trace context, and namespaced provider options.

Capabilities cover text generation, native structured output, JSON mode, streaming, deterministic seed, context/output limits, usage, and reasoning controls. A Recipe marks capabilities required, preferred, or optional. Missing required capabilities stop compilation. Missing preferred capabilities use a declared fallback and emit a degradation Event. Unsupported request fields are never silently treated as honored.

The bundled OpenAI-compatible Provider follows the normative [compatibility profile](../specification/openai-compatible-provider.md). It does not equate an OpenAI-shaped route with OpenAI feature parity.

The Default Enhance Recipe requires text generation, prefers structured output, and optionally consumes streaming and usage data.

## Schemas

JSON Schema Draft 2020-12 is authoritative under the [portable profile](../specification/schema-profile.md). The profile explicitly allowlists keywords, formats, and a cross-language regular-expression subset. Dynamic/remote references, unevaluated semantics, custom vocabularies, coercion, and mutation during validation are excluded.

TypeScript uses a raw-schema-first `defineSchema`/`Infer` API and may use TypeBox for structural authoring. Ajv runs in strict, all-errors, non-mutating mode and compiles/caches validators from the bundled registry. Go uses `github.com/santhosh-tekuri/jsonschema/v6`. Both must pass official applicable cases plus shared differential conformance fixtures; generated types never replace runtime validation.

## Configuration

Human-authored configuration uses `meta-prompt.config.jsonc`; the generated `meta-prompt.lock.json` is strict machine data. There is no executable JavaScript or TypeScript configuration in v1. SDK consumers can pass a programmatic object; Hosts may parse native formats and pass the resulting object.

Resolution, from lowest to highest precedence:

1. schema defaults
2. Plugin defaults
3. Recipe defaults
4. Host defaults
5. user-global configuration
6. project configuration
7. per-Run configuration

Enforced Host or organization policy is a separate constraint layer and cannot be overridden by these values. Unknown keys are errors. Scalars replace. Objects merge only according to their schema. Arrays replace unless the schema declares append or union semantics. `null` is schema-defined. Secrets are references, never literal config values.

Plugins receive a plain, immutable resolved configuration object. Provenance lives in a separate immutable `ConfigTrace`, indexed by RFC 6901 JSON Pointer, so ordinary Plugin code does not unwrap a special value type at every access. Each trace entry records the schema rule, ordered low-to-high candidates, source ID and optional URI/line/column, merge operation, effective source, and why candidates were accepted or overridden. Values are represented by a safe preview and digest according to capture policy; secret material is never stored.

Host and organization constraints produce explicit policy records—`allowed`, `forced`, `clamped`, or `denied`—with a policy ID, safe reason, and affected source. They are not inserted as a fictitious highest-precedence config layer. `inspect` and development tools may query the trace; routine Plugin invocations, Events, and Results do not receive or emit it. A Host may expose a Plugin's own configuration subtree through a read-only inspection API, subject to the same redaction policy.

The CLI accepts `--config`; otherwise it searches upward to the nearest repository root for the first project config. User-global configuration is resolved separately. Alternate config loaders are Host-plane Plugins because the Kernel must have configuration before it can activate pipeline Plugins.

## Application protocol

Cross-process components use JSON-RPC 2.0 over Content-Length-framed UTF-8 stdio. stdout is protocol-only; stderr is process diagnostics and is never parsed as an application Result. Batch requests are excluded in v1.

The first call is `initialize`, negotiating protocol version, capabilities, and limits. V1 runtime methods are `recipe/compile`, `run/start`, `run/cancel`, `inspect`, `doctor`, and `shutdown`; `run/event` is a notification. Isolated native Plugins receive a narrower `plugin/*` surface.

Framing, message size, and schema validation happen before dispatch. JSON-RPC errors are reserved for malformed framing, invalid requests, unknown methods, invalid parameters, uninitialized peers, and incompatible protocol versions. Transformation failures are valid `RunResult` values.

The same application semantics can later use in-process or network transports without redefining Results or Diagnostics.
