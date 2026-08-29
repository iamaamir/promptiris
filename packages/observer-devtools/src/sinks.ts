import type { Event } from '@promptiris/protocol';

/** @public */
export interface EventSink {
  write(event: Event): void;
}

/** @public */
export interface ConsoleSinkOptions {
  readonly writer?: (line: string) => void;
}

function pushIfString(parts: string[], key: string, value: unknown): void {
  if (typeof value === 'string') parts.push(`${key}=${value}`);
}

/** @public */
export function formatEvent(event: Event): string {
  const data = event.data as Record<string, unknown>;
  const parts: string[] = [];
  parts.push(`[${String(event.sequence)}]`);
  parts.push(event.type);
  parts.push(`source=${event.source}`);
  pushIfString(parts, 'phase', data?.phase);
  pushIfString(parts, 'plugin', data?.pluginId);
  pushIfString(parts, 'contrib', data?.contributionId);
  pushIfString(parts, 'status', data?.status);
  pushIfString(parts, 'observer', data?.observerId);
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
      // Deterministic: store only metadata fields, redact sensitive content.
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
        data: redactData(event.data, event.classification),
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

function redactData(data: unknown, classification: string): unknown {
  if (classification === 'sensitive') return { redacted: true };
  if (typeof data !== 'object' || data === null) return data;
  // Shallow redact known content fields.
  const record = data as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (k === 'prompt' || k === 'content' || k === 'value' || k === 'secret') out[k] = '[redacted]';
    else out[k] = v;
  }
  return out;
}
