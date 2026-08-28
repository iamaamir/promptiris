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
// Stryker disable all: these flags are compiler policy; schema conformance tests verify their observable contract.
const ajv = new Ajv2020({
  strict: true,
  allErrors: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
});
ajv.addSchema(promptDocumentSchema);
const validator = ajv.getSchema(promptDocumentSchema.$id);
const patchValidator = ajv.compile(patchSchema);
const jsonValueValidator = ajv.compile({ $ref: `${promptDocumentSchema.$id}#/$defs/jsonValue` });
// Stryker restore all
/** @public */
export function validatePromptDocument(value: unknown): value is PromptDocument {
  return validator?.(value) === true;
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
