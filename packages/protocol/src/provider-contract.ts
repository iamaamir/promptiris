import { Ajv2020 } from 'ajv/dist/2020.js';
import type { CapabilityEvidence, Diagnostic, JsonValue, NamespacedId } from './index.js';
import providerAjvOptions from './provider-ajv-options.json' with { type: 'json' };

const namespacedPattern = '^[A-Za-z][A-Za-z0-9._-]*/[A-Za-z][A-Za-z0-9._-]*(?:/[A-Za-z0-9._-]+)*$';
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

/** A logical, explicit model selection. It never includes credentials. @public */
export interface ModelBinding {
  readonly provider: NamespacedId;
  readonly model: string;
  readonly endpoint?: string;
  readonly fingerprint: string;
}

/** The active configuration and its binding-scoped capability evidence. @public */
export interface ProviderConfiguration {
  readonly schemaVersion: '1';
  readonly binding: ModelBinding;
  readonly evidence: readonly CapabilityEvidence[];
}

/** @public */
export interface GenerateMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

/** Portable input for one non-streaming generation. @public */
export interface ProviderGenerateRequest {
  readonly schemaVersion: '1';
  readonly id: string;
  readonly messages: readonly GenerateMessage[];
  readonly requiredCapabilities: readonly NamespacedId[];
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly providerOptions?: Readonly<Record<NamespacedId, JsonValue>>;
}

/** @public */
export interface ProviderUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

/** Portable successful output. @public */
export interface ProviderGenerateResult {
  readonly schemaVersion: '1';
  readonly requestId: string;
  readonly bindingFingerprint: string;
  readonly content: string;
  readonly finishReason: 'stop' | 'length' | 'content-filter';
  readonly usage?: ProviderUsage;
  readonly diagnostics: readonly Diagnostic[];
}

/** Portable normalized failure data. @public */
export interface ProviderFailure {
  readonly schemaVersion: '1';
  readonly kind: ProviderErrorKind;
  readonly message: string;
  readonly retryable: boolean;
  readonly diagnostics: readonly Diagnostic[];
}

const capabilityEvidenceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['evidenceId', 'capability', 'bindingFingerprint', 'state', 'source'],
  properties: {
    evidenceId: { type: 'string', minLength: 1 },
    capability: { type: 'string', pattern: namespacedPattern },
    bindingFingerprint: { type: 'string', minLength: 1 },
    state: { enum: ['supported', 'unsupported', 'unknown'] },
    source: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'id'],
      properties: {
        kind: { enum: ['policy', 'configuration', 'profile', 'observation'] },
        id: { type: 'string', minLength: 1 },
      },
    },
    digest: { type: 'string' },
    observedAt: { type: 'string', minLength: 1 },
    reason: { type: 'string', minLength: 1 },
  },
} as const;

const diagnosticSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'id', 'code', 'category', 'severity', 'title'],
  properties: {
    schemaVersion: { const: '1' },
    id: { type: 'string', minLength: 1 },
    code: { type: 'string', minLength: 1 },
    category: { type: 'string', minLength: 1 },
    severity: { enum: ['info', 'warning', 'error', 'fatal'] },
    title: { type: 'string', minLength: 1 },
    detail: { type: 'string' },
  },
} as const;

const jsonValueSchema = {
  oneOf: [
    { type: 'null' },
    { type: 'boolean' },
    { type: 'number' },
    { type: 'string' },
    { type: 'array', items: { $ref: '#/$defs/jsonValue' } },
    { type: 'object', additionalProperties: { $ref: '#/$defs/jsonValue' } },
  ],
} as const;

const providerConfigurationSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:promptiris:schema:provider-configuration:v1',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'binding', 'evidence'],
  properties: {
    schemaVersion: { const: '1' },
    binding: {
      type: 'object',
      additionalProperties: false,
      required: ['provider', 'model', 'fingerprint'],
      properties: {
        provider: { type: 'string', pattern: namespacedPattern },
        model: { type: 'string', minLength: 1 },
        endpoint: { type: 'string', minLength: 1 },
        fingerprint: { type: 'string', minLength: 1 },
      },
    },
    evidence: { type: 'array', items: capabilityEvidenceSchema },
  },
} as const;

const providerGenerateRequestSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:promptiris:schema:provider-generate-request:v1',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'id', 'messages', 'requiredCapabilities'],
  properties: {
    schemaVersion: { const: '1' },
    id: { type: 'string', minLength: 1 },
    messages: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['role', 'content'],
        properties: {
          role: { enum: ['system', 'user', 'assistant'] },
          content: { type: 'string' },
        },
      },
    },
    requiredCapabilities: {
      type: 'array',
      uniqueItems: true,
      items: { type: 'string', pattern: namespacedPattern },
    },
    maxOutputTokens: { type: 'integer', minimum: 1 },
    temperature: { type: 'number', minimum: 0, maximum: 2 },
    providerOptions: {
      type: 'object',
      propertyNames: { pattern: namespacedPattern },
      additionalProperties: { $ref: '#/$defs/jsonValue' },
    },
  },
  $defs: { jsonValue: jsonValueSchema },
} as const;

const providerGenerateResultSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:promptiris:schema:provider-generate-result:v1',
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'requestId',
    'bindingFingerprint',
    'content',
    'finishReason',
    'diagnostics',
  ],
  properties: {
    schemaVersion: { const: '1' },
    requestId: { type: 'string', minLength: 1 },
    bindingFingerprint: { type: 'string', minLength: 1 },
    content: { type: 'string' },
    finishReason: { enum: ['stop', 'length', 'content-filter'] },
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
    diagnostics: { type: 'array', items: diagnosticSchema },
  },
} as const;

const providerFailureSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:promptiris:schema:provider-failure:v1',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'kind', 'message', 'retryable', 'diagnostics'],
  properties: {
    schemaVersion: { const: '1' },
    kind: {
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
    diagnostics: { type: 'array', items: diagnosticSchema },
  },
} as const;

const hasValidEvidenceDigests = (configuration: ProviderConfiguration): boolean =>
  configuration.evidence.every(
    ({ digest }) => digest === undefined || /^sha256:[0-9a-f]{64}$/.test(digest),
  );

const ajv = new Ajv2020(providerAjvOptions);
const configurationValidator = ajv.compile(providerConfigurationSchema);
const requestValidator = ajv.compile(providerGenerateRequestSchema);
const resultValidator = ajv.compile(providerGenerateResultSchema);
const failureValidator = ajv.compile(providerFailureSchema);

/** @public */
export function validateProviderConfiguration(value: unknown): value is ProviderConfiguration {
  return configurationValidator(value) && hasValidEvidenceDigests(value);
}

/** @public */
export function validateProviderGenerateRequest(value: unknown): value is ProviderGenerateRequest {
  return requestValidator(value);
}

/** @public */
export function validateProviderGenerateResult(value: unknown): value is ProviderGenerateResult {
  return resultValidator(value);
}

/** @public */
export function validateProviderFailure(value: unknown): value is ProviderFailure {
  return failureValidator(value);
}
