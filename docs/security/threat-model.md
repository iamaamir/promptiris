# Security and trust model

Prompt Iris executes user-selected transformations and may invoke third-party code or remote/local models. Its primary security promise is explicit authority, bounded data flow, fault containment, and safe fallback—not a universal sandbox.

## Trust boundaries

| Component | Default trust | Boundary |
| --- | --- | --- |
| Host and user | Authority for the Run | Choose Input, Recipe, Plugins, Context, permissions, capture, and submission behavior |
| Kernel and signed official runtime | Trusted computing base | Validate, order, bound, correlate, isolate, and assemble; contain no transformation policy |
| Bundled in-process Plugins | Trusted code | Exact locked versions; same process privileges as Kernel |
| Third-party native Plugins | Trusted-to-install, failure-contained | Supervised subprocess by default; still able to use OS authority unless Host sandboxing denies it |
| Declarative Plugins | Untrusted data within a closed language | Schema/namespace/capability validated; cannot execute arbitrary code |
| Provider/model endpoint | External, potentially unreliable or adversarial | Receives only rendered authorized model input and Provider credentials; output is untrusted and validated |
| Resource References/content | Untrusted, explicitly supplied | Kernel never resolves; authorized loader/modality Plugin enforces scheme/type/size/content policy |
| Observer Plugins | Optional data recipients | Cannot affect Result; receive only policy-allowed classifications and may persist/export only by explicit activation |

Installing a native Plugin is equivalent to installing code. Subprocess supervision prevents ordinary crashes, hangs, protocol corruption, and resource flooding from taking down the Host, but does not prevent data theft or arbitrary OS actions. A restrictive Host must use its own sandbox/containers/OS permissions; Permission Hints support that decision and are not proof.

## Protected assets and threats

| Threat | Required mitigation |
| --- | --- |
| Silent behavior after install | Explicit Recipe activation; no identity shadowing or Run-time auto-install |
| Dependency/config substitution | Exact source/version/integrity lock; immutable catalog snapshot; ConfigTrace and separate enforced policy |
| Plugin crash/hang/protocol abuse | Framing/depth/size limits, deadlines, cooperative cancel then termination, stderr drain, quarantine, safe Diagnostic |
| Malicious model output | Treat as untrusted; bounded decode; schema/Artifact/Patch validation; Protected Spans; semantic Guards; no partial output |
| Prompt/context injection | Preserve Input versus Context/resource provenance; no ambient discovery; modality/loader outputs remain labeled; Recipe Guards decide policy |
| Secret leakage | Logical secret refs; resolve at Provider boundary; never place material in model content, Event, Result, Diagnostic, ConfigTrace, or support bundle |
| Observer exfiltration | No telemetry by default; classification filters; separate debug/content opt-in; explicit Observer activation and Host authorization |
| Resource confused deputy/SSRF/path escape | Kernel never dereferences; loader receives explicit reference and permission; Host enforces schemes/roots/network; digest/media/size verification |
| Supply-chain replacement | Immutable releases, checksums, exact locks, upstream Node checksum verification, SBOM, build provenance, code signing where available |
| Denial of service | Run/Plugin deadlines, cancellation, bounded frames/queues/artifacts/debug, concurrency limits, process quarantine |
| Cross-Run data leakage | Isolated Run state and immutable snapshots; no Kernel history/cache; reusable resources must be reentrant and must not retain content |
| Unsafe automatic replacement | Host-owned confirmation default; automatic opt-in; exact original retained; optional transformation fails open |

## Data classification and retention

`metadata`, `content`, and `sensitive` classifications flow through the standard dispatcher. Credentials are outside this lattice because they are never capturable. The Kernel's bounded journal is ephemeral. `debug` capture may include sanitized exceptions/stderr; `content` is a distinct stronger opt-in. Persistence, remote export, history, cache, and usage collection each require an explicitly activated Plugin and Host permission.

Sanitization is defense in depth, not permission to collect. A support bundle starts with metadata, hashes, schemas, versions, topology, and safe Diagnostics; content, paths, environment values, raw model payloads, and stderr are excluded unless individually authorized and previewed.

## Security failure policy

Optional transformation faults normally return the exact original. A security Guard or enforced Host policy may deliberately block; its visible Diagnostic identifies the rule without exposing detection internals. Protocol corruption terminates the affected Plugin/process. An unusable trusted runtime is fatal and produces no claim that the transformation succeeded.

Security fixes may shorten compatibility/deprecation windows. Published artifacts are never replaced in place. The implementation repository must publish a private vulnerability-reporting path before its first release and document supported versions; this document is architecture, not a substitute for an operational security policy.
