/** @public */
export type Phase = 'preflight' | 'analyze' | 'transform' | 'adapt' | 'validate' | 'render';

/** @public */
export interface TextBlock {
  id: string;
  text: string;
}
/** @public */
export interface PromptDocument {
  schemaVersion: '1';
  content: TextBlock[];
}
/** @public */
export interface Artifact {
  schemaVersion: '1';
  id: string;
  kind: string;
  mediaType: string;
  value: unknown;
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
  serverName: 'meta-prompt-runtime';
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

const promptDocumentSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://meta-prompt.dev/schema/prompt-document-v1.json',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'content'],
  properties: {
    schemaVersion: { const: '1' },
    content: { type: 'array', minItems: 1, items: { $ref: '#/$defs/textBlock' } },
  },
  $defs: {
    textBlock: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'text'],
      properties: { id: { type: 'string', minLength: 1 }, text: { type: 'string' } },
    },
  },
} as const;
// Stryker disable all: these flags are compiler policy; schema conformance tests verify their observable contract.
const validator = new Ajv2020({
  strict: true,
  allErrors: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
}).compile(promptDocumentSchema);
// Stryker restore all
/** @public */
export function validatePromptDocument(value: unknown): value is PromptDocument {
  return validator(value);
}

/** @public */
export function makeTextDocument(text: string): PromptDocument {
  return { schemaVersion: '1', content: [{ id: 'input-1', text }] };
}
/** @public */
export function isPromptDocument(value: unknown): value is PromptDocument {
  // Stryker disable next-line ConditionalExpression: primitive property reads are safe; this guard narrows the type.
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PromptDocument>;
  return (
    candidate.schemaVersion === '1' &&
    Array.isArray(candidate.content) &&
    candidate.content.every(
      (b) => Boolean(b) && typeof b.id === 'string' && typeof b.text === 'string',
    )
  );
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
