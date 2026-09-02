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

function isAllowedEntry(key: string, value: unknown): boolean {
  if (!isAllowlistedKey(key)) return false;
  if (!isPlainValue(value)) return false;
  if (typeof value === 'number' && !Number.isFinite(value)) return false;
  return true;
}

function projectData(data: unknown): Record<string, unknown> {
  if (data == null || Array.isArray(data)) return Object.create(null) as Record<string, unknown>;
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (!isAllowedEntry(k, v)) continue;
    out[k] = typeof v === 'string' ? boundedString(v) : v;
  }
  return out;
}

function pushIfString(parts: string[], key: string, value: unknown): void {
  if (typeof value === 'string') parts.push(`${key}=${value}`);
}

function pushIfNumber(parts: string[], key: string, value: unknown): void {
  if (Number.isFinite(value)) parts.push(`${key}=${String(value)}`);
}

/** @public */
export function formatEvent(event: Event): string {
  const prefix = `[${String(event.sequence)}] ${event.type} source=${event.source}`;
  if (event.classification !== 'metadata') return `${prefix} [redacted] delivery=${event.delivery}`;
  const data = (event.data ?? {}) as Record<string, unknown>;
  const parts: string[] = [`[${String(event.sequence)}]`, event.type, `source=${event.source}`];
  pushIfString(parts, 'phase', data.phase);
  pushIfString(parts, 'plugin', data.pluginId);
  pushIfString(parts, 'contrib', data.contributionId);
  pushIfString(parts, 'status', data.status);
  pushIfString(parts, 'observer', data.observerId);
  pushIfString(parts, 'reason', data.reason);
  pushIfString(parts, 'fallback', data.fallback);
  pushIfString(parts, 'kind', data.kind);
  pushIfString(parts, 'artifactKind', data.artifactKind);
  pushIfString(parts, 'digest', data.digest);
  pushIfNumber(parts, 'durationMs', data.durationMs);
  pushIfNumber(parts, 'timing', data.timing);
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
        event.classification !== 'metadata' ? { redacted: true } : projectData(event.data);
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
