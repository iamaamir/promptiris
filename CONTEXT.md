# Meta Prompt

Meta Prompt is the bounded context concerned with compiling an input through an explicitly selected transformation composition and returning a traceable result. This glossary defines its domain language; implementation details live elsewhere.

## Language

**Input**:
The user-authored content submitted for transformation. An Input may include explicitly supplied Context and Protected Spans.
_Avoid_: Raw prompt, query

**Context**:
Host-supplied information or Resource References that a Recipe may use in addition to the Input. Context is explicit; it is never discovered ambiently by the Kernel.
_Avoid_: Memory, global context

**Resource Reference**:
A Host-supplied pointer and description of an external resource that may become Context if an authorized Plugin resolves it. It is not the resource's contents.
_Avoid_: Attachment when the distinction between a reference and embedded content matters

**Protected Span**:
A precisely identified portion of an Input that the Kernel must preserve textually exactly, such as a placeholder, quotation, identifier, or literal value.
_Avoid_: Frozen token

**Semantic Constraint**:
An explicit meaning-level requirement that a Guard evaluates after transformation, such as preserving intent or a public API. Unlike a Protected Span, the Kernel cannot prove it through textual identity alone.
_Avoid_: Semantic protection, Protected Span

**Prompt Document**:
The canonical text-first representation of an Input and its declared Context, constraints, Protected Spans, Resource References, and namespaced extensions. A string is only shorthand for constructing one.
_Avoid_: Prompt string, message

**Artifact**:
A typed product created during a Run. Every Artifact declares its kind, media type, schema when applicable, value, and provenance.
_Avoid_: Output blob

**Primary Artifact**:
The Artifact a Recipe declares as its main product. An enhanced prompt is one possible Primary Artifact, not a universal output type.
_Avoid_: Final prompt

**Exposed Artifact**:
An Artifact that a Recipe intentionally includes in its Result contract. Internal Artifacts remain available only within their Run.
_Avoid_: Public Artifact

**Result**:
The complete outcome of a Run: status, primary and alternate Artifacts, diagnostics, assumptions, optional clarifications, provenance, and metadata.
_Avoid_: Response

**Kernel**:
The policy-free orchestration core that discovers and validates Plugins, compiles a Recipe, executes its lifecycle, applies returned changes, and dispatches standard events.
_Avoid_: Enhancer, agent

**Plugin**:
A namespaced, versioned contribution that declares capabilities and participates in a defined extension plane. Installing a Plugin does not activate it.
_Avoid_: Extension when referring to a Meta Prompt contribution

**Pipeline Plugin**:
A Plugin that analyzes or changes a Prompt Document during a Run by returning Artifacts, patches, diagnostics, or events.
_Avoid_: Middleware when the precise plugin type is known

**Provider Plugin**:
A Plugin that resolves a logical Model Binding and performs model generation through a declared capability contract.
_Avoid_: Model when referring to the integration

**Guard Plugin**:
A Plugin that checks or enforces declared invariants and may be configured to block a Run.
_Avoid_: Validator when enforcement is intended

**Renderer Plugin**:
A Plugin that creates a representation of an Artifact for a target model, host, media type, or consumer.
_Avoid_: Formatter

**Observer Plugin**:
A Plugin that subscribes to standard events without affecting the transformation outcome. Persistence and export are separate observer concerns.
_Avoid_: Logger when it may export traces or metrics

**Host Adapter**:
A Plugin outside the transformation pipeline that maps a host's input, context, progress, confirmation, fallback, and output semantics to the Meta Prompt SDK.
_Avoid_: Pipeline Plugin, Host

**Recipe**:
An explicitly activated, shareable composition of Plugins and configuration that declares its input requirements and output contract.
_Avoid_: Workflow, preset

**Recipe Overlay**:
A Recipe that extends exactly one base Recipe by explicitly adding, replacing, removing, or configuring known contributions.
_Avoid_: Inheritance chain, monkey patch

**Default Enhance Recipe**:
The bundled Recipe that performs a single-call, model-neutral improvement while preserving intent and exposing assumptions.
_Avoid_: The Kernel, optimizer

**Enhancement**:
A candidate transformation intended to improve how a model can act on an Input without changing its intent or silently adding requirements.
_Avoid_: Optimization, guaranteed improvement

**Optimization**:
An empirically selected transformation measured against a dataset and explicit metrics or evaluations.
_Avoid_: Enhancement

**Model Binding**:
A logical, explicitly configured reference to a provider, model, endpoint, and optional fallback policy.
_Avoid_: Model name

**Run**:
One isolated execution of a compiled Recipe against a Prompt Document under a host-provided deadline and cancellation signal.
_Avoid_: Session

**Phase**:
A named lifecycle position to which Plugins contribute work. Dependencies determine resolved order within and across Phases.
_Avoid_: Step when referring to the extension point

**Patch**:
A narrow, immutable proposal to change a Prompt Document or Artifact. The Kernel applies accepted Patches in resolved order and records provenance.
_Avoid_: Mutation

**Text Selector**:
A revision-bound identification of text using a block, Unicode code-point range, and exact quoted value. Patches and Protected Spans share this selector.
_Avoid_: String index, line range

**Diagnostic**:
A safe, portable, schema-validated record describing an expected or normalized failure, warning, or informational condition.
_Avoid_: Exception, log

**Debug Record**:
An ephemeral, potentially sensitive development record associated with a Diagnostic but excluded from normal Results and model input.
_Avoid_: Diagnostic

**Event**:
A schema-validated record emitted through the Kernel dispatcher with stable identity, ordering, correlation, and sensitivity metadata.
_Avoid_: Arbitrary callback payload

**Capability**:
A declared feature a Plugin, Provider, Recipe, or Host requires, prefers, or offers. Capabilities express compatibility, not user authorization.
_Avoid_: Permission

**Capability Evidence**:
The scoped source supporting a capability state for one exact binding or component, such as explicit configuration, a versioned profile, or a successful bounded observation.
_Avoid_: Provider brand, guess

**Evidence**:
An immutable, revision-bound record from a trusted deterministic check that identifies its inputs, tool and policy versions, environment, outcome, and reusable artifacts.
_Avoid_: Agent success claim, unbound report

**Quality Profile**:
A versioned policy mapping a change's risk, affected surfaces, and lifecycle stage to required Evidence, budgets, and invalidation rules.
_Avoid_: Universal quality score, arbitrary checklist

**Configuration Trace**:
Immutable, field-addressed evidence explaining how resolved configuration was merged and constrained, including candidates, sources, effective ownership, and Host-policy decisions. Plugins still receive ordinary configuration values.
_Avoid_: Wrapped configuration, config log

**Permission Hint**:
A Plugin declaration describing access it may need so a Host can apply its own trust policy.
_Avoid_: Role, entitlement

## Flagged ambiguities

- “Prompt” can mean the original Input, a Prompt Document, or a rendered Artifact. Use the precise term.
- “Error” can mean a protocol fault, an operational Diagnostic, or a Debug Record. These travel through different channels.
- “Extension” refers to a host ecosystem package such as a Pi extension; use Plugin for Meta Prompt contributions and Host Adapter for the bridge.
- “Enhance with memory” is a Recipe composition, not a second Plugin allowed to shadow the default enhance identity.
- “Protected” means exact textual enforcement by the Kernel; meaning-level preservation is a Semantic Constraint evaluated by Guards.

## Example dialogue

> **Developer:** I installed `acme/memory`, so will it replace the Default Enhance Recipe?
>
> **Domain expert:** No. Installation only makes a Plugin discoverable. Activate a Recipe Overlay that extends the Default Enhance Recipe and adds `acme/memory`.
>
> **Developer:** What happens if that Plugin fails during a Run?
>
> **Domain expert:** The Kernel records a Diagnostic and follows the Recipe's failure policy. Because enhancement is optional by default, the Result is degraded and returns an Artifact derived from the original Input.
>
> **Developer:** Can the Pi extension show that progress?
>
> **Domain expert:** Yes. Its Host Adapter subscribes to standard Events from the Kernel dispatcher and maps them to Pi's UI.
