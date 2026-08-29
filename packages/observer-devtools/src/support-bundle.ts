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
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_, v) => {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) sorted[k] = (v as Record<string, unknown>)[k];
      return sorted;
    }
    return v;
  });
}

function redactEvent(event: Event): Event {
  if (event.classification === 'sensitive') {
    return Object.freeze({
      ...event,
      data: { redacted: true },
    });
  }
  const data = event.data as Record<string, unknown> | undefined;
  if (data === undefined) return event;
  const scrubbed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === 'prompt' || k === 'content' || k === 'value') scrubbed[k] = '[redacted]';
    else scrubbed[k] = v;
  }
  return Object.freeze({ ...event, data: scrubbed });
}

/** @public */
export function createSupportBundle(input: BundleInput): SupportBundle {
  const events = input.events.slice(0, MAX_BUNDLE_EVENTS).map(redactEvent);
  // Deterministic: sort by sequence then id
  events.sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));

  const debugRecords = input.debugRecords.slice(0, MAX_BUNDLE_DEBUG_RECORDS);
  const manifestRefs = [...(input.manifestIds ?? [])].sort();

  let bundle: SupportBundle = Object.freeze({
    schemaVersion: SUPPORT_BUNDLE_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    observerId: input.observerId,
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.traceId ? { traceId: input.traceId } : {}),
    bounded: true as const,
    redacted: true as const,
    deterministic: true as const,
    events: Object.freeze(events),
    debugRecords: Object.freeze(debugRecords.map((r) => Object.freeze({ ...r }))),
    manifestRefs: Object.freeze(manifestRefs),
    ...(input.configTraceId ? { configTraceRef: input.configTraceId } : {}),
  });

  // Bounded bytes: truncate if exceeds MAX_BUNDLE_BYTES by dropping oldest progress events first
  let bytes = stableStringify(bundle).length;
  if (bytes > MAX_BUNDLE_BYTES) {
    const filtered = events.filter((e) => e.delivery !== 'progress');
    const truncated = filtered.slice(0, Math.min(filtered.length, MAX_BUNDLE_EVENTS));
    bundle = Object.freeze({ ...bundle, events: Object.freeze(truncated) });
  }
  return bundle;
}
