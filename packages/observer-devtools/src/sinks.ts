import type { Event } from '@promptiris/protocol';

/** @public */
export interface EventSink {
  write(event: Event): void;
}

/** @public */
export interface ConsoleSinkOptions {
  readonly writer?: (line: string) => void;
}

const ALLOWLISTED_KEYS = [
  'phase',
  'status',
  'pluginId',
  'contributionId',
  'observerId',
  'reason',
  'fallback',
  'from',
  'to',
  'durationMs',
  'timing',
  'timings',
  'kind',
  'artifactKind',
  'mediaType',
  'digest',
] as const;

function isAllowlistedKey(key: string): boolean {
  return (ALLOWLISTED_KEYS as readonly string[]).includes(key);
}

const MAX_STRING_LENGTH = 256;

function isPlainValue(value: unknown): boolean {
  const t = typeof value;
  return t === 'string' || t === 'number' || t === 'boolean';
}

function boundedString(value: string): string {
  return value.length <= MAX_STRING_LENGTH ? value : `${value.slice(0, MAX_STRING_LENGTH)}…`;
}

function isPollutionKey(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

function isAllowedEntry(key: string, value: unknown): boolean {
  if (!isAllowlistedKey(key)) return false;
  if (isPollutionKey(key)) return false;
  if (!isPlainValue(value)) return false;
  if (typeof value === 'number' && !Number.isFinite(value)) return false;
  return true;
}

function projectData(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) return undefined;
  if (Array.isArray(data)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (!isAllowedEntry(k, v)) continue;
    out[k] = typeof v === 'string' ? boundedString(v) : v;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

function pushIfString(parts: string[], key: string, value: unknown): void {
  if (typeof value === 'string') parts.push(`${key}=${value}`);
}

function pushIfNumber(parts: string[], key: string, value: unknown): void {
  if (typeof value === 'number' && Number.isFinite(value)) parts.push(`${key}=${String(value)}`);
}

const STRING_FIELDS: [string, string][] = [
  ['phase', 'phase'],
  ['plugin', 'pluginId'],
  ['contrib', 'contributionId'],
  ['status', 'status'],
  ['observer', 'observerId'],
  ['reason', 'reason'],
  ['fallback', 'fallback'],
  ['kind', 'kind'],
  ['artifactKind', 'artifactKind'],
  ['digest', 'digest'],
];

const NUMBER_FIELDS: [string, string][] = [
  ['durationMs', 'durationMs'],
  ['timing', 'timing'],
];

/** @public */
export function formatEvent(event: Event): string {
  const data = event.data as Record<string, unknown>;
  const parts: string[] = [];
  parts.push(`[${String(event.sequence)}]`);
  parts.push(event.type);
  parts.push(`source=${event.source}`);
  for (const [label, key] of STRING_FIELDS) pushIfString(parts, label, data?.[key]);
  for (const [label, key] of NUMBER_FIELDS) pushIfNumber(parts, label, data?.[key]);
  parts.push(`delivery=${event.delivery}`);
  return parts.join(' ');
}

/** @public */
export function createConsoleSink(options: ConsoleSinkOptions = {}): EventSink {
  const writer = options.writer ?? ((line: string) => console.log(line));
  return {
    write(event: Event): void {
      try {
        const line = formatEvent(event);
        writer(line);
      } catch {
        // Sink failure must not fail transformation.
      }
    },
  };
}

/** @public */
export interface JsonLinesSinkOptions {
  readonly capacity?: number;
}

/** @public */
export class JsonLinesSink implements EventSink {
  readonly #capacity: number;
  readonly #lines: string[] = [];

  constructor(options: JsonLinesSinkOptions = {}) {
    const cap = options.capacity ?? 512;
    if (!Number.isSafeInteger(cap) || cap <= 0)
      throw new RangeError('capacity must be positive integer');
    this.#capacity = cap;
  }

  write(event: Event): void {
    try {
      if (this.#lines.length >= this.#capacity) return;
      const projectedData =
        event.classification === 'sensitive' ? { redacted: true } : (projectData(event.data) ?? {});
      const projected = {
        schemaVersion: event.schemaVersion,
        id: event.id,
        type: event.type,
        sequence: event.sequence,
        runId: event.runId,
        traceId: event.traceId,
        source: event.source,
        dataSchema: event.dataSchema,
        classification: event.classification,
        delivery: event.delivery,
        data: projectedData,
      };
      this.#lines.push(JSON.stringify(projected));
    } catch {
      // Sink failure must not propagate.
    }
  }

  get lines(): readonly string[] {
    return this.#lines;
  }

  clear(): void {
    this.#lines.length = 0;
  }
}
