import type { DebugRecord, DebugRecordSink, EventDispatcher } from '@promptiris/core';
import type { Event } from '@promptiris/protocol';

/** @public */
export interface EventSink {
  write(event: Event): void;
}
/** @public */
export interface ConsoleSinkOptions {
  readonly writer?: (line: string) => void;
}
const MAX_TEXT = 256;
const SAFE_KEYS = new Set([
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
]);
const polluting = new Set(['__proto__', 'constructor', 'prototype']);
function boundedText(value: string): string {
  return value.length <= MAX_TEXT ? value : `${value.slice(0, MAX_TEXT)}…`;
}
function safeScalar(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    typeof value === 'boolean' ||
    value === null
  );
}
function projectObject(value: object, depth: number): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value).slice(0, 32)) {
    if (polluting.has(key) || (depth === 0 && !SAFE_KEYS.has(key))) continue;
    const projected = projectValue(nested, depth + 1);
    if (projected !== undefined) output[key] = projected;
  }
  return output;
}
function projectValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]';
  if (typeof value === 'string') return boundedText(value);
  if (safeScalar(value)) return value;
  if (Array.isArray(value)) return value.slice(0, 16).map((item) => projectValue(item, depth + 1));
  return typeof value === 'object' && value !== null ? projectObject(value, depth) : undefined;
}
function dataOf(event: Event): Record<string, unknown> {
  return typeof event.data === 'object' && event.data !== null && !Array.isArray(event.data)
    ? (event.data as Record<string, unknown>)
    : {};
}
function formatEvent(event: Event): string {
  const data = dataOf(event);
  const fields = Object.entries(data)
    .filter(([key, item]) => SAFE_KEYS.has(key) && safeScalar(item))
    .map(([key, item]) => `${key}=${boundedText(String(item))}`);
  return `[${String(event.sequence)}] ${event.type} source=${event.source} ${fields.join(' ')} delivery=${event.delivery}`;
}
/** @public */
export function createConsoleSink(options: ConsoleSinkOptions = {}): EventSink {
  const writer = options.writer ?? ((line: string) => console.log(line));
  return {
    write(event): void {
      try {
        writer(formatEvent(event));
      } catch {
        /* observer isolation */
      }
    },
  };
}
/** @public */
export class JsonLinesSink implements EventSink {
  readonly #lines: string[] = [];
  readonly #capacity: number;
  constructor(options: { readonly capacity?: number } = {}) {
    this.#capacity = options.capacity ?? 512;
    if (!Number.isSafeInteger(this.#capacity) || this.#capacity <= 0)
      throw new RangeError('capacity must be positive integer');
  }
  write(event: Event): void {
    try {
      if (this.#lines.length >= this.#capacity) return;
      const data =
        event.classification !== 'metadata' ? { redacted: true } : (projectValue(event.data) ?? {});
      this.#lines.push(
        JSON.stringify({
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
          data,
        }),
      );
    } catch {
      /* observer isolation */
    }
  }
  get lines(): readonly string[] {
    return this.#lines;
  }
  clear(): void {
    this.#lines.length = 0;
  }
}
/** @public */
export interface DebugCapture extends DebugRecordSink {
  readonly records: readonly DebugRecord[];
  readonly dropped: number;
}
/** @public */
export function createDebugCapture(limit = 128): DebugCapture {
  if (!Number.isSafeInteger(limit) || limit <= 0)
    throw new RangeError('limit must be positive integer');
  const records: DebugRecord[] = [];
  let dropped = 0;
  return {
    capture(record): void {
      if (records.length >= limit) {
        records.shift();
        dropped += 1;
      }
      records.push(record);
    },
    records,
    get dropped(): number {
      return dropped;
    },
  };
}
/** @public */
export interface EventCapture extends EventSink {
  readonly events: readonly Event[];
  readonly dropped: number;
}
/** @public */
export function createEventCapture(limit = 256): EventCapture {
  if (!Number.isSafeInteger(limit) || limit <= 0)
    throw new RangeError('limit must be positive integer');
  const events: Event[] = [];
  let dropped = 0;
  return {
    write(event): void {
      if (events.length >= limit) {
        events.shift();
        dropped += 1;
      }
      events.push(event);
    },
    events,
    get dropped(): number {
      return dropped;
    },
  };
}
/** @public */
export interface ObserverAttachment extends AsyncDisposable {
  readonly done: Promise<void>;
  detach(): Promise<void>;
}
function startPump(
  subscription: AsyncIterable<Event>,
  sink: EventSink,
  done: () => void,
  stopped: () => boolean,
): void {
  void (async (): Promise<void> => {
    try {
      for await (const event of subscription) {
        if (!stopped())
          try {
            sink.write(event);
          } catch {
            /* observer isolation */
          }
      }
    } catch {
      /* iterator isolation */
    } finally {
      done();
    }
  })();
}
/** @public */
export function attachObserver(
  dispatcher: EventDispatcher,
  sink: EventSink,
  options: { readonly observerId?: string; readonly capacity?: number } = {},
): ObserverAttachment {
  const observerId = options.observerId ?? 'promptiris/observer-devtools';
  const subscription = dispatcher.subscribe({ observerId, capacity: options.capacity ?? 64 });
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  let detached = false;
  startPump(subscription, sink, resolveDone, () => detached);
  return {
    done,
    async detach(): Promise<void> {
      detached = true;
      try {
        await subscription.return();
      } catch {
        /* disposal isolation */
      }
      await done;
    },
    async [Symbol.asyncDispose](): Promise<void> {
      await this.detach();
    },
  };
}
/** @public */
export interface BundleInput {
  readonly observerId: string;
  readonly events: readonly Event[];
  readonly debugRecords: readonly DebugRecord[];
  readonly manifestIds?: readonly string[];
  readonly configTraceId?: string;
  readonly runId?: string;
  readonly traceId?: string;
  readonly createdAt?: string;
}
/** @public */
export interface SupportBundle {
  readonly schemaVersion: '1';
  readonly createdAt: string;
  readonly observerId: string;
  readonly runId?: string;
  readonly traceId?: string;
  readonly bounded: true;
  readonly redacted: true;
  readonly deterministic: true;
  readonly events: readonly unknown[];
  readonly debugRecords: readonly unknown[];
  readonly manifestRefs: readonly string[];
  readonly configTraceRef?: string;
}
/** @public */
export const SUPPORT_BUNDLE_SCHEMA_VERSION = '1' as const;
/** @public */
export const MAX_BUNDLE_EVENTS = 256;
/** @public */
export const MAX_BUNDLE_DEBUG_RECORDS = 128;
/** @public */
export const MAX_BUNDLE_BYTES = 256 * 1024;
function redactEvent(event: Event): unknown {
  return {
    schemaVersion: event.schemaVersion,
    id: event.id,
    type: event.type,
    time: event.time,
    sequence: event.sequence,
    runId: event.runId,
    traceId: event.traceId,
    source: event.source,
    dataSchema: event.dataSchema,
    data:
      event.classification === 'metadata' ? (projectValue(event.data) ?? {}) : { redacted: true },
    classification: event.classification,
    delivery: event.delivery,
  };
}
function redactDebug(record: DebugRecord): unknown {
  return {
    id: record.id,
    runId: record.runId,
    traceId: record.traceId,
    operation: record.operation,
    ...(record.pluginId ? { pluginId: record.pluginId } : {}),
    ...(record.contributionId ? { contributionId: record.contributionId } : {}),
    exception: { type: record.exception.type, message: '[redacted]' },
  };
}
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort())
      : item,
  );
}
function bytes(value: unknown): number {
  return new TextEncoder().encode(stable(value)).length;
}
/** @public */
export function createSupportBundle(input: BundleInput): SupportBundle {
  const refs = [...new Set((input.manifestIds ?? []).map((ref) => boundedText(ref)))]
    .sort()
    .slice(0, 64);
  const events = input.events
    .slice(-MAX_BUNDLE_EVENTS)
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))
    .map(redactEvent);
  const debug = input.debugRecords.slice(0, MAX_BUNDLE_DEBUG_RECORDS).map(redactDebug);
  const base: SupportBundle = {
    schemaVersion: '1',
    createdAt: input.createdAt ?? '1970-01-01T00:00:00.000Z',
    observerId: boundedText(input.observerId),
    ...(input.runId ? { runId: boundedText(input.runId) } : {}),
    ...(input.traceId ? { traceId: boundedText(input.traceId) } : {}),
    bounded: true as const,
    redacted: true as const,
    deterministic: true as const,
    events,
    debugRecords: debug,
    manifestRefs: refs,
    ...(input.configTraceId ? { configTraceRef: boundedText(input.configTraceId) } : {}),
  };
  if (bytes(base) <= MAX_BUNDLE_BYTES) return Object.freeze(base);
  const minimal = { ...base, events: [], debugRecords: [], manifestRefs: [] };
  return Object.freeze(minimal);
}
