/** @public */
export type Phase = 'preflight' | 'analyze' | 'transform' | 'adapt' | 'validate' | 'render';

/** @public */
export interface TextBlock {
  id: string;
  text: string;
}
/** @public */
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
/** @public */
export type NamespacedId = `${string}/${string}`;
/** @public */
export interface SecretReference {
  /** Logical reference such as `env:OPENAI_API_KEY`; never credential material. */
  readonly ref: string;
}
/** @public */
export interface SourceLocation {
  readonly uri?: string;
  /** One-based source line. */
  readonly line?: number;
  /** One-based source column. */
  readonly column?: number;
}
/** @public */
export type CandidateDisposition = 'accepted' | 'overridden' | 'rejected';
/** @public */
export type CapabilityRequirement = 'required' | 'preferred' | 'optional';
/** @public */
export type SafePreview =
  | { readonly kind: 'literal'; readonly value: JsonValue }
  | { readonly kind: 'redacted'; readonly digest?: string }
  | { readonly kind: 'secret-reference'; readonly scheme: string };
/** @public */
export interface ConfigTraceCandidate {
  readonly sourceId: string;
  readonly location?: SourceLocation;
  readonly disposition: CandidateDisposition;
  readonly preview?: SafePreview;
  readonly reason: string;
}
/** @public */
export interface ConfigTraceEntry {
  readonly pointer: string;
  readonly schemaRule: string;
  readonly candidates: readonly ConfigTraceCandidate[];
  readonly merge: 'default' | 'replace' | 'merge' | 'append' | 'union';
  readonly effectiveSource?: string;
}
/** @public */
export interface ConfigTrace {
  readonly entries: Readonly<Record<string, ConfigTraceEntry>>;
}
/** @public */
export interface PolicyRecord {
  readonly policyId: string;
  readonly decision: 'allowed' | 'forced' | 'clamped' | 'denied';
  readonly pointer: string;
  readonly sourceId?: string;
  readonly reason: string;
}
/** @public */
export interface CapabilityEvidence {
  readonly evidenceId: string;
  readonly capability: NamespacedId;
  readonly bindingFingerprint: string;
  readonly state: 'supported' | 'unsupported' | 'unknown';
  readonly source: {
    readonly kind: 'policy' | 'configuration' | 'profile' | 'observation';
    readonly id: string;
  };
  readonly digest?: string;
  readonly observedAt?: string;
  readonly reason?: string;
}
/** @public */
export interface CapabilityResolution {
  readonly capability: NamespacedId;
  readonly bindingFingerprint: string;
  readonly requirement: CapabilityRequirement;
  readonly outcome: 'satisfied' | 'fallback' | 'missing' | 'conflict';
  readonly evidence: readonly CapabilityEvidence[];
  readonly reason?: string;
  readonly diagnostic?: Diagnostic;
}
/** @public */
export interface PermissionHint {
  readonly effect: 'filesystem' | 'network' | 'process' | 'credential';
  readonly scope?: string;
  readonly reason?: string;
}
/** @public */
export interface InspectParams {
  readonly recipe?: NamespacedId;
  readonly configUri?: string;
}
/** @public */
export interface InspectResult {
  readonly schemaVersion: '1';
  readonly redacted: true;
  readonly config: JsonValue;
  readonly configTrace: ConfigTrace;
  readonly policies: readonly PolicyRecord[];
  readonly resolutions: readonly CapabilityResolution[];
  readonly permissionHints: readonly PermissionHint[];
}
/** @public */
export interface DoctorParams {
  readonly recipe?: NamespacedId;
  readonly configUri?: string;
}
/** @public */
export interface DoctorCheck {
  readonly id: NamespacedId;
  readonly status: 'passed' | 'failed' | 'deferred';
  readonly reason?: string;
}
/** @public */
export interface DoctorResult {
  readonly schemaVersion: '1';
  readonly ready: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly checks: readonly DoctorCheck[];
  readonly resolutions: readonly CapabilityResolution[];
}
/** @public */
export interface ResourceReference {
  uri: string;
  mediaType?: string;
  name?: string;
  digest?: string;
}
/** @public */
export interface TextSelector {
  blockId: string;
  revision: number;
  range: { unit: 'unicode-scalar'; start: number; end: number };
  quote: { exact: string; prefix?: string; suffix?: string };
}
/** @public */
export interface Protection {
  id: NamespacedId;
  selector: TextSelector;
  reason?: string;
}
/** @public */
export interface Constraint {
  id: NamespacedId;
  kind: NamespacedId;
  value: JsonValue;
}
/** @public */
export interface ReplaceText {
  type: 'replace-text';
  selector: TextSelector;
  text: string;
}
/** @public */
export interface InsertContentBlock {
  type: 'insert-content-block';
  block: TextBlock;
  beforeBlockId?: string;
}
/** @public */
export interface ReplaceContentBlock {
  type: 'replace-content-block';
  blockId: string;
  expectedDigest: string;
  block: TextBlock;
}
/** @public */
export interface RemoveContentBlock {
  type: 'remove-content-block';
  blockId: string;
  expectedDigest: string;
}
/** @public */
export interface SetNamespacedExtension {
  type: 'set-namespaced-extension';
  key: NamespacedId;
  value: JsonValue;
}
/** @public */
export type PatchOperation =
  | ReplaceText
  | InsertContentBlock
  | ReplaceContentBlock
  | RemoveContentBlock
  | SetNamespacedExtension;
/** @public */
export interface Patch {
  schemaVersion: '1';
  id: string;
  baseRevision: number;
  operations: PatchOperation[];
}
/** @public */
export interface PromptDocument {
  schemaVersion: '1';
  content: TextBlock[];
  context?: (TextBlock | ResourceReference)[];
  constraints?: Constraint[];
  protections?: Protection[];
  extensions?: Record<NamespacedId, JsonValue>;
}
/** @public */
export interface Artifact {
  schemaVersion: '1';
  id: string;
  kind: NamespacedId;
  mediaType: string;
  value: JsonValue | ResourceReference;
  dataSchema?: SchemaReference;
  digest?: string;
  provenance: Provenance;
  classification: 'public' | 'internal' | 'sensitive';
  extensions?: Record<NamespacedId, JsonValue>;
}
/** @public */
export interface SchemaReference {
  uri: string;
}
/** @public */
export interface Provenance {
  pluginId: string;
  contributionId: string;
  invocationId: string;
  phase: Phase;
  parentArtifactIds: string[];
  patchIds: string[];
  modelCallRef?: string;
}
/** @public */
export interface LockedRecipeReference {
  id: string;
  version: string;
}
/** @public */
export interface Diagnostic {
  schemaVersion: '1';
  id: string;
  code: string;
  category: string;
  severity: 'info' | 'warning' | 'error' | 'fatal';
  title: string;
  detail?: string;
}
/** @public */
export interface Event<T = unknown> {
  schemaVersion: '1';
  id: string;
  type: string;
  time: string;
  sequence: number;
  runId: string;
  source: string;
  traceId: string;
  dataSchema: string;
  data: T;
  classification: 'metadata' | 'content' | 'sensitive';
  delivery: 'critical' | 'progress';
}
/** @public */
export interface RunResult {
  schemaVersion: '1';
  runId: string;
  recipe: LockedRecipeReference;
  status: 'success' | 'degraded' | 'blocked' | 'cancelled' | 'failed';
  primary?: Artifact;
  primaryOrigin?: 'transformed' | 'original';
  alternatives: Artifact[];
  exposed: Record<string, Artifact[]>;
  assumptions: unknown[];
  clarifications: unknown[];
  diagnostics: Diagnostic[];
  summary: { traceId: string; durationMs: number; completedPhases: Phase[]; failedPhases: Phase[] };
}

/** @public */
export type ModelCapability = 'text-generation' | 'structured-output' | 'tool-use';
/** @public */
export interface ModelBinding {
  readonly modelId: string;
  readonly providerId: NamespacedId;
  readonly fingerprint: string;
}
/** @public */
export interface ProviderCapabilities {
  readonly supported: readonly ModelCapability[];
  readonly unsupported: readonly ModelCapability[];
}
/** @public */
export interface ProviderConfig {
  readonly id: NamespacedId;
  readonly binding: ModelBinding;
  readonly capabilities: ProviderCapabilities;
  readonly secretRef?: SecretReference;
  readonly endpoint?: string;
}
/** @public */
export interface GenerateMessage {
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: string;
}
/** @public */
export interface GenerateParams {
  readonly config: ProviderConfig;
  readonly messages: readonly GenerateMessage[];
  readonly system?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  /** AbortSignal is platform-specific and cannot be serialized. */
  readonly signal?: AbortSignal;
  /** Capability evidence bound to the active Provider configuration fingerprint. */
  readonly evidence?: readonly CapabilityEvidence[];
}
/** @public */
export interface Usage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}
/** @public */
export interface GenerateResult {
  readonly content: string;
  readonly model: string;
  readonly usage: Usage;
  readonly finishReason: 'stop' | 'length' | 'content-filter' | 'error';
  readonly diagnostics?: readonly Diagnostic[];
}
/** @public */
export type ProviderErrorKind =
  | 'unsupported-capability'
  | 'cancelled'
  | 'malformed-output'
  | 'timeout'
  | 'rate-limit'
  | 'authentication'
  | 'network'
  | 'unknown';
/** @public */
export interface ProviderError {
  readonly kind: ProviderErrorKind;
  readonly message: string;
  readonly retryable: boolean;
  readonly cause?: unknown;
}
/** @public */
export interface InitializeParams {
  protocolVersion: '1';
  clientName?: string;
  capabilities?: Record<string, boolean>;
}
/** @public */
export interface InitializeResult {
  protocolVersion: '1';
  serverName: 'promptiris-runtime';
  capabilities: { methods: string[]; events: string[] };
  limits: { maxFrameBytes: number; maxDepth: number };
}
/** @public */
export interface RunStartParams {
  recipe?: string;
  input: PromptDocument;
}
/** @public */
export interface JsonRpcRequest<T = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: T;
}
/** @public */
export interface JsonRpcNotification<T = unknown> {
  jsonrpc: '2.0';
  method: string;
  params?: T;
}
/** @public */
export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}
/** @public */
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

/** @public */
export const MAX_FRAME_BYTES = 8 * 1024 * 1024;

import { Ajv2020 } from 'ajv/dist/2020.js';

const namespacedPattern = '^[A-Za-z][A-Za-z0-9._-]*/[A-Za-z][A-Za-z0-9._-]*(?:/[A-Za-z0-9._-]+)*$';
// Stryker disable next-line StringLiteral: Ajv compiles this module-level schema constant before
// per-test mutation isolation; Prompt Document and Patch tests directly reject malformed digests.
const digestPattern = '^sha256:[0-9a-f]{64}$';

const promptDocumentSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:promptiris:schema:prompt-document:v1',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'content'],
  properties: {
    schemaVersion: { const: '1' },
    content: {
      type: 'array',
      minItems: 1,
      maxItems: 1024,
      items: { $ref: '#/$defs/textBlock' },
    },
    context: {
      type: 'array',
      maxItems: 1024,
      items: {
        oneOf: [{ $ref: '#/$defs/textBlock' }, { $ref: '#/$defs/resourceReference' }],
      },
    },
    constraints: {
      type: 'array',
      maxItems: 1024,
      items: { $ref: '#/$defs/constraint' },
    },
    protections: {
      type: 'array',
      maxItems: 1024,
      items: { $ref: '#/$defs/protection' },
    },
    extensions: {
      type: 'object',
      propertyNames: { pattern: namespacedPattern },
      additionalProperties: { $ref: '#/$defs/jsonValue' },
    },
  },
  $defs: {
    namespacedId: { type: 'string', pattern: namespacedPattern },
    jsonValue: {
      oneOf: [
        { type: 'null' },
        { type: 'boolean' },
        { type: 'number' },
        { type: 'string' },
        { type: 'array', items: { $ref: '#/$defs/jsonValue' } },
        { type: 'object', additionalProperties: { $ref: '#/$defs/jsonValue' } },
      ],
    },
    textBlock: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'text'],
      properties: { id: { type: 'string', minLength: 1 }, text: { type: 'string' } },
    },
    resourceReference: {
      type: 'object',
      additionalProperties: false,
      required: ['uri'],
      properties: {
        uri: { type: 'string', minLength: 1 },
        mediaType: { type: 'string', minLength: 1 },
        name: { type: 'string', minLength: 1 },
        digest: { type: 'string', pattern: digestPattern },
      },
    },
    constraint: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'kind', 'value'],
      properties: {
        id: { $ref: '#/$defs/namespacedId' },
        kind: { $ref: '#/$defs/namespacedId' },
        value: { $ref: '#/$defs/jsonValue' },
      },
    },
    selector: {
      type: 'object',
      additionalProperties: false,
      required: ['blockId', 'revision', 'range', 'quote'],
      properties: {
        blockId: { type: 'string', minLength: 1 },
        revision: { type: 'integer', minimum: 0 },
        range: {
          type: 'object',
          additionalProperties: false,
          required: ['unit', 'start', 'end'],
          properties: {
            unit: { const: 'unicode-scalar' },
            start: { type: 'integer', minimum: 0 },
            end: { type: 'integer', minimum: 0 },
          },
        },
        quote: {
          type: 'object',
          additionalProperties: false,
          required: ['exact'],
          properties: {
            exact: { type: 'string' },
            prefix: { type: 'string' },
            suffix: { type: 'string' },
          },
        },
      },
    },
    protection: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'selector'],
      properties: {
        id: { $ref: '#/$defs/namespacedId' },
        selector: { $ref: '#/$defs/selector' },
        reason: { type: 'string' },
      },
    },
  },
} as const;

const patchSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:promptiris:schema:patch:v1',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'id', 'baseRevision', 'operations'],
  properties: {
    schemaVersion: { const: '1' },
    id: { type: 'string', minLength: 1 },
    baseRevision: { type: 'integer', minimum: 0 },
    operations: {
      type: 'array',
      minItems: 1,
      maxItems: 128,
      items: {
        oneOf: [
          { $ref: '#/$defs/replaceText' },
          { $ref: '#/$defs/insertContentBlock' },
          { $ref: '#/$defs/replaceContentBlock' },
          { $ref: '#/$defs/removeContentBlock' },
          { $ref: '#/$defs/setNamespacedExtension' },
        ],
      },
    },
  },
  $defs: {
    namespacedId: { type: 'string', pattern: namespacedPattern },
    digest: { type: 'string', pattern: digestPattern },
    jsonValue: {
      oneOf: [
        { type: 'null' },
        { type: 'boolean' },
        { type: 'number' },
        { type: 'string' },
        { type: 'array', items: { $ref: '#/$defs/jsonValue' } },
        { type: 'object', additionalProperties: { $ref: '#/$defs/jsonValue' } },
      ],
    },
    textBlock: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'text'],
      properties: { id: { type: 'string', minLength: 1 }, text: { type: 'string' } },
    },
    selector: { $ref: `${promptDocumentSchema.$id}#/$defs/selector` },
    replaceText: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'selector', 'text'],
      properties: {
        type: { const: 'replace-text' },
        selector: { $ref: '#/$defs/selector' },
        text: { type: 'string' },
      },
    },
    insertContentBlock: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'block'],
      properties: {
        type: { const: 'insert-content-block' },
        block: { $ref: '#/$defs/textBlock' },
        beforeBlockId: { type: 'string', minLength: 1 },
      },
    },
    replaceContentBlock: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'blockId', 'expectedDigest', 'block'],
      properties: {
        type: { const: 'replace-content-block' },
        blockId: { type: 'string', minLength: 1 },
        expectedDigest: { $ref: '#/$defs/digest' },
        block: { $ref: '#/$defs/textBlock' },
      },
    },
    removeContentBlock: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'blockId', 'expectedDigest'],
      properties: {
        type: { const: 'remove-content-block' },
        blockId: { type: 'string', minLength: 1 },
        expectedDigest: { $ref: '#/$defs/digest' },
      },
    },
    setNamespacedExtension: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'key', 'value'],
      properties: {
        type: { const: 'set-namespaced-extension' },
        key: { $ref: '#/$defs/namespacedId' },
        value: { $ref: '#/$defs/jsonValue' },
      },
    },
  },
} as const;

// Stryker disable all: Provider schema constants follow the same pattern as PromptDocument and Patch schemas; schema conformance tests verify their observable contract.
const providerConfigSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:promptiris:schema:provider-config:v1',
  type: 'object',
  additionalProperties: false,
  required: ['id', 'binding', 'capabilities'],
  properties: {
    id: { type: 'string', pattern: namespacedPattern },
    binding: {
      type: 'object',
      additionalProperties: false,
      required: ['modelId', 'providerId', 'fingerprint'],
      properties: {
        modelId: { type: 'string', minLength: 1 },
        providerId: { type: 'string', pattern: namespacedPattern },
        fingerprint: { type: 'string', minLength: 1 },
      },
    },
    capabilities: {
      type: 'object',
      additionalProperties: false,
      required: ['supported', 'unsupported'],
      properties: {
        supported: {
          type: 'array',
          items: { type: 'string', enum: ['text-generation', 'structured-output', 'tool-use'] },
        },
        unsupported: {
          type: 'array',
          items: { type: 'string', enum: ['text-generation', 'structured-output', 'tool-use'] },
        },
      },
    },
    secretRef: {
      type: 'object',
      additionalProperties: false,
      required: ['ref'],
      properties: { ref: { type: 'string', minLength: 1 } },
    },
    endpoint: { type: 'string' },
  },
} as const;

const capabilityEvidenceSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:promptiris:schema:capability-evidence:v1',
  type: 'object',
  additionalProperties: false,
  required: ['evidenceId', 'capability', 'bindingFingerprint', 'state', 'source'],
  properties: {
    evidenceId: { type: 'string', minLength: 1 },
    capability: { type: 'string', pattern: namespacedPattern },
    bindingFingerprint: { type: 'string', minLength: 1 },
    state: { type: 'string', enum: ['supported', 'unsupported', 'unknown'] },
    source: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'id'],
      properties: {
        kind: { type: 'string', enum: ['policy', 'configuration', 'profile', 'observation'] },
        id: { type: 'string', minLength: 1 },
      },
    },
    digest: { type: 'string' },
    observedAt: { type: 'string' },
    reason: { type: 'string' },
  },
} as const;

const generateParamsSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:promptiris:schema:generate-params:v1',
  type: 'object',
  additionalProperties: false,
  required: ['config', 'messages'],
  properties: {
    config: { $ref: providerConfigSchema.$id },
    messages: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['role', 'content'],
        properties: {
          role: { type: 'string', enum: ['user', 'assistant', 'system'] },
          content: { type: 'string' },
        },
      },
    },
    system: { type: 'string' },
    temperature: { type: 'number', minimum: 0, maximum: 2 },
    maxTokens: { type: 'integer', minimum: 1 },
    evidence: {
      type: 'array',
      items: { $ref: capabilityEvidenceSchema.$id },
    },
  },
} as const;

const generateResultSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:promptiris:schema:generate-result:v1',
  type: 'object',
  additionalProperties: false,
  required: ['content', 'model', 'usage', 'finishReason'],
  properties: {
    content: { type: 'string' },
    model: { type: 'string', minLength: 1 },
    usage: {
      type: 'object',
      additionalProperties: false,
      required: ['promptTokens', 'completionTokens', 'totalTokens'],
      properties: {
        promptTokens: { type: 'integer', minimum: 0 },
        completionTokens: { type: 'integer', minimum: 0 },
        totalTokens: { type: 'integer', minimum: 0 },
      },
    },
    finishReason: { type: 'string', enum: ['stop', 'length', 'content-filter', 'error'] },
    diagnostics: {
      type: 'array',
      items: { type: 'object' },
    },
  },
} as const;

const providerErrorSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:promptiris:schema:provider-error:v1',
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'message', 'retryable'],
  properties: {
    kind: {
      type: 'string',
      enum: [
        'unsupported-capability',
        'cancelled',
        'malformed-output',
        'timeout',
        'rate-limit',
        'authentication',
        'network',
        'unknown',
      ],
    },
    message: { type: 'string', minLength: 1 },
    retryable: { type: 'boolean' },
    cause: {},
  },
} as const;
// Stryker restore all

// Stryker disable all: constructor options are configuration policy; schema conformance tests
// verify their observable contract.
const ajv = new Ajv2020({
  strict: true,
  allErrors: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
});
// Stryker restore all
const validator = ajv.compile(promptDocumentSchema);
const patchValidator = ajv.compile(patchSchema);
const jsonValueValidator = ajv.compile({ $ref: `${promptDocumentSchema.$id}#/$defs/jsonValue` });
const providerConfigValidator = ajv.compile(providerConfigSchema);
const generateResultValidator = ajv.compile(generateResultSchema);
const providerErrorValidator = ajv.compile(providerErrorSchema);
const capabilityEvidenceValidator = ajv.compile(capabilityEvidenceSchema);
const generateParamsValidator = ajv.compile(generateParamsSchema);
/** @public */
export function validatePromptDocument(value: unknown): value is PromptDocument {
  return validator(value);
}
/** @public */
export function validatePatch(value: unknown): value is Patch {
  return patchValidator(value);
}
/** @public */
export function validateJsonValue(value: unknown): value is JsonValue {
  return jsonValueValidator(value);
}

/** @public */
export function validateProviderConfig(value: unknown): value is ProviderConfig {
  return providerConfigValidator(value);
}
/** @public */
export function validateGenerateResult(value: unknown): value is GenerateResult {
  return generateResultValidator(value);
}
/** @public */
export function validateProviderError(value: unknown): value is ProviderError {
  return providerErrorValidator(value);
}
/** @public */
export function validateCapabilityEvidence(value: unknown): value is CapabilityEvidence {
  return capabilityEvidenceValidator(value);
}
/** @public */
export function validateGenerateParams(value: unknown): value is GenerateParams {
  return generateParamsValidator(value);
}
/** @public */
export function makeTextDocument(text: string): PromptDocument {
  return { schemaVersion: '1', content: [{ id: 'input-1', text }] };
}
/** @public */
export function isPromptDocument(value: unknown): value is PromptDocument {
  return validatePromptDocument(value);
}

/** @public */
export function encodeMessage(message: JsonRpcMessage): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  if (body.byteLength > MAX_FRAME_BYTES) throw new Error('JSON-RPC frame exceeds maximum size');
  return Buffer.concat([
    Buffer.from(`Content-Length: ${String(body.byteLength)}\r\n\r\n`, 'ascii'),
    body,
  ]);
}

/** @public */
export class ContentLengthDecoder {
  #buffer = Buffer.alloc(0);
  push(chunk: Buffer): JsonRpcMessage[] {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    const messages: JsonRpcMessage[] = [];
    while (true) {
      const separator = this.#buffer.indexOf('\r\n\r\n');
      if (separator < 0) break;
      const header = this.#buffer.subarray(0, separator).toString('ascii');
      const lengths = header
        .split('\r\n')
        .map((line) => /^Content-Length:\s*([0-9]+)$/i.exec(line))
        .filter((match): match is RegExpExecArray => match !== null);
      if (lengths.length !== 1) throw new Error('invalid Content-Length header');
      const length = Number(lengths[0]?.[1]);
      if (!Number.isSafeInteger(length) || length > MAX_FRAME_BYTES) {
        throw new Error('JSON-RPC frame exceeds maximum size');
      }
      const start = separator + 4;
      if (this.#buffer.byteLength < start + length) break;
      const body = this.#buffer.subarray(start, start + length).toString('utf8');
      this.#buffer = this.#buffer.subarray(start + length);
      messages.push(JSON.parse(body) as JsonRpcMessage);
    }
    return messages;
  }
}
