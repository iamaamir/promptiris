import type { DebugRecord } from '@promptiris/core';
import type { Event } from '@promptiris/protocol';

/** @public */
export const SUPPORT_BUNDLE_SCHEMA_VERSION = '1' as const;
/** @public */
export const MAX_BUNDLE_EVENTS = 256;
/** @public */
export const MAX_BUNDLE_DEBUG_RECORDS = 128;
/** @public */
export const MAX_BUNDLE_BYTES = 256 * 1024;

/** @public */
export interface SupportBundle {
  readonly schemaVersion: typeof SUPPORT_BUNDLE_SCHEMA_VERSION;
  readonly createdAt: string;
  readonly observerId: string;
  readonly runId?: string;
  readonly traceId?: string;
  readonly bounded: true;
  readonly redacted: true;
  readonly deterministic: true;
  readonly events: readonly Event[];
  readonly debugRecords: readonly DebugRecord[];
  readonly manifestRefs: readonly string[];
  readonly configTraceRef?: string;
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
const MAX_REFERENCE_LENGTH = 512;
const MAX_REFERENCES = 64;
function boundedReference(value: string): string {
  return value.length <= MAX_REFERENCE_LENGTH ? value : `${value.slice(0, MAX_REFERENCE_LENGTH)}…`;
}

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

function projectData(data: unknown): Record<string, unknown> | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  if (Array.isArray(data)) return undefined;
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [k, v] of Object.entries(data as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!isAllowedEntry(k, v)) continue;
    out[k] = typeof v === 'string' ? boundedString(v) : v;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function redactEvent(event: Event): Event {
  if (event.classification !== 'metadata') {
    return Object.freeze({
      schemaVersion: event.schemaVersion,
      id: event.id,
      type: event.type,
      time: event.time,
      sequence: event.sequence,
      runId: event.runId,
      traceId: event.traceId,
      source: event.source,
      dataSchema: event.dataSchema,
      data: { redacted: true },
      classification: event.classification,
      delivery: event.delivery,
    });
  }
  const projected = projectData(event.data);
  return Object.freeze({
    schemaVersion: event.schemaVersion,
    id: event.id,
    type: event.type,
    time: event.time,
    sequence: event.sequence,
    runId: event.runId,
    traceId: event.traceId,
    source: event.source,
    dataSchema: event.dataSchema,
    data: projected ?? {},
    classification: event.classification,
    delivery: event.delivery,
  });
}

function redactDebugRecord(record: DebugRecord): DebugRecord {
  return Object.freeze({
    id: record.id,
    runId: record.runId,
    traceId: record.traceId,
    operation: record.operation,
    ...(record.pluginId ? { pluginId: record.pluginId } : {}),
    ...(record.contributionId ? { contributionId: record.contributionId } : {}),
    exception: Object.freeze({ type: record.exception.type, message: '[redacted]' }),
  });
}

function buildInitialBundle(
  input: BundleInput,
  events: readonly Event[],
  debugRecords: readonly DebugRecord[],
): SupportBundle {
  const manifestRefs = [...new Set((input.manifestIds ?? []).map(boundedReference))]
    .sort()
    .slice(0, MAX_REFERENCES);
  return Object.freeze({
    schemaVersion: SUPPORT_BUNDLE_SCHEMA_VERSION,
    createdAt: input.createdAt ?? '1970-01-01T00:00:00.000Z',
    observerId: input.observerId,
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.traceId ? { traceId: input.traceId } : {}),
    bounded: true as const,
    redacted: true as const,
    deterministic: true as const,
    events: Object.freeze(events),
    debugRecords: Object.freeze(debugRecords.map((r) => Object.freeze({ ...r }))),
    manifestRefs: Object.freeze(manifestRefs),
    ...(input.configTraceId ? { configTraceRef: boundedReference(input.configTraceId) } : {}),
  });
}

function enforceByteCap(
  bundle: SupportBundle,
  events: readonly Event[],
  debugRecords: readonly DebugRecord[],
): SupportBundle {
  const boundedBundle: SupportBundle = Object.freeze({
    ...bundle,
    events: Object.freeze(events.slice(0, MAX_BUNDLE_EVENTS)),
    debugRecords: Object.freeze(debugRecords.slice(0, MAX_BUNDLE_DEBUG_RECORDS)),
  });
  let bytes = utf8ByteLength(stableStringify(boundedBundle));
  if (bytes <= MAX_BUNDLE_BYTES) return boundedBundle;
  const truncatedEvents = events
    .filter((e) => e.delivery !== 'progress')
    .slice(0, MAX_BUNDLE_EVENTS);
  const tmp: SupportBundle = Object.freeze({
    ...boundedBundle,
    events: Object.freeze(truncatedEvents),
  });
  bytes = utf8ByteLength(stableStringify(tmp));
  if (bytes <= MAX_BUNDLE_BYTES) return tmp;
  const minimal = Object.freeze({
    ...boundedBundle,
    events: Object.freeze([]),
    debugRecords: Object.freeze([]),
    manifestRefs: Object.freeze([]),
  });
  if (utf8ByteLength(stableStringify(minimal)) > MAX_BUNDLE_BYTES)
    throw new RangeError('support bundle byte limit is too small');
  return minimal;
}

/** @public */
export function createSupportBundle(input: BundleInput): SupportBundle {
  const events = input.events.map(redactEvent);
  events.sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
  const debugRecords = input.debugRecords.map(redactDebugRecord);
  const bundle = buildInitialBundle(input, events, debugRecords);
  return enforceByteCap(bundle, events, debugRecords);
}
