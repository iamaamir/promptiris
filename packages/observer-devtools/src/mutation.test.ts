import { describe, it, expect } from 'vitest';
import { JsonLinesSink, formatEvent } from './sinks.js';
import {
  createSupportBundle,
  MAX_BUNDLE_BYTES,
  MAX_BUNDLE_DEBUG_RECORDS,
  MAX_BUNDLE_EVENTS,
} from './support-bundle.js';
import type { Event } from '@promptiris/protocol';
import type { DebugRecord } from '@promptiris/core';

function makeEvent(data: unknown, overrides: Partial<Event> = {}): Event {
  const base: Event = {
    schemaVersion: '1',
    id: overrides.id ?? 'id',
    type: 't',
    time: new Date().toISOString(),
    sequence: overrides.sequence ?? 0,
    runId: 'r',
    traceId: 'r',
    source: 's',
    dataSchema: 'd',
    data: data,
    classification: overrides.classification ?? 'metadata',
    delivery: overrides.delivery ?? 'critical',
  };
  return {
    ...base,
    ...overrides,
    data: data,
    id: base.id,
    sequence: base.sequence,
  };
}

describe('mutation killers', () => {
  it('keeps all allowlisted keys and strips others', () => {
    const sink = new JsonLinesSink({ capacity: 10 });
    const data = {
      phase: 'a',
      status: 'b',
      pluginId: 'c',
      contributionId: 'd',
      observerId: 'e',
      reason: 'f',
      fallback: 'g',
      from: 'h',
      to: 'i',
      durationMs: 42,
      timing: 5,
      kind: 'j',
      artifactKind: 'k',
      mediaType: 'l',
      digest: 'm',
      prompt: 'leak',
      secret: 'leak',
      unknown: 'leak',
    };
    sink.write(makeEvent(data));
    const line = sink.lines[0] ?? '';
    expect(line).toContain('"phase":"a"');
    expect(line).toContain('"digest":"m"');
    expect(line).not.toContain('"prompt"');
    expect(line).not.toContain('"unknown"');
  });

  it('truncates long strings', () => {
    const sink = new JsonLinesSink({ capacity: 10 });
    const long = 'x'.repeat(300);
    sink.write(makeEvent({ phase: long }));
    const line = sink.lines[0] ?? '';
    expect(line).toContain('…');
    // truncated to 257 inc ellipsis, original 300 not present
    expect(line).not.toContain(long);
  });

  it('drops non-finite numbers', () => {
    const sink = new JsonLinesSink({ capacity: 10 });
    sink.write(makeEvent({ durationMs: Infinity }));
    expect(sink.lines[0] ?? '').not.toContain('durationMs');
    sink.clear();
    sink.write(makeEvent({ durationMs: NaN }));
    expect(sink.lines[0] ?? '').not.toContain('durationMs');
  });

  it('handles sensitive redaction', () => {
    const sink = new JsonLinesSink({ capacity: 10 });
    sink.write(makeEvent({ phase: 'x' }, { classification: 'sensitive' }));
    expect(sink.lines[0] ?? '').toContain('"redacted":true');
  });

  it('formatEvent includes all allowlisted fields', () => {
    const e = makeEvent({
      phase: 'transform',
      status: 'success',
      pluginId: 'p/a',
      contributionId: 'c1',
      observerId: 'o1',
      reason: 'r',
      fallback: 'f',
      kind: 'k',
      artifactKind: 'ak',
      digest: 'd',
      durationMs: 10,
      timing: 5,
    });
    const line = formatEvent(e);
    expect(line).toContain('phase=transform');
    expect(line).toContain('plugin=p/a');
    expect(line).toContain('fallback=f');
    expect(line).toContain('durationMs=10');
    expect(line).toContain('digest=d');
  });

  it('support bundle sorts by sequence then id', () => {
    const e1 = makeEvent({}, { id: 'b', sequence: 1 });
    const e2 = makeEvent({}, { id: 'a', sequence: 1 });
    const e3 = makeEvent({}, { id: 'c', sequence: 0 });
    const bundle = createSupportBundle({
      observerId: 'test',
      events: [e1, e2, e3],
      debugRecords: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(bundle.events[0]?.id).toBe('c');
    expect(bundle.events[1]?.id).toBe('a');
    expect(bundle.events[2]?.id).toBe('b');
  });

  it('support bundle slices beyond max', () => {
    const events = Array.from({ length: 300 }, (_, i) =>
      makeEvent({}, { id: `id-${String(i)}`, sequence: i }),
    );
    const bundle = createSupportBundle({
      observerId: 'test',
      events,
      debugRecords: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(bundle.events.length).toBe(MAX_BUNDLE_EVENTS);
  });

  it('support bundle slices debug beyond max', () => {
    const debugRecords: DebugRecord[] = Array.from({ length: 200 }, (_, i) => ({
      id: String(i),
      runId: 'r',
      traceId: 'r',
      operation: 'op',
      exception: { type: 'Error', message: 'm' },
    }));
    const bundle = createSupportBundle({
      observerId: 'test',
      events: [],
      debugRecords,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(bundle.debugRecords.length).toBe(MAX_BUNDLE_DEBUG_RECORDS);
  });

  it('support bundle redacts debug records', () => {
    const rec: DebugRecord = {
      id: '1',
      runId: 'r',
      traceId: 'r',
      operation: 'op',
      pluginId: 'p',
      contributionId: 'c',
      exception: { type: 'Error', message: 'secret', stack: 'stack' },
    };
    const bundle = createSupportBundle({
      observerId: 'test',
      events: [],
      debugRecords: [rec],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(bundle.debugRecords[0]?.exception.message).toBe('[redacted]');
    expect(JSON.stringify(bundle.debugRecords[0])).not.toContain('stack');
    expect(bundle.debugRecords[0]?.pluginId).toBe('p');
  });

  it('support bundle byte cap drops progress first', () => {
    const big = 'x'.repeat(256);
    const fullData = {
      phase: big,
      status: big,
      pluginId: big,
      contributionId: big,
      observerId: big,
      reason: big,
      fallback: big,
      from: big,
      to: big,
      kind: big,
      artifactKind: big,
      mediaType: big,
      digest: big,
    };
    const progressEvents = Array.from({ length: 50 }, (_, i) =>
      makeEvent(fullData, { id: `p-${String(i)}`, sequence: i, delivery: 'progress' }),
    );
    const criticalEvents = Array.from({ length: 50 }, (_, i) =>
      makeEvent(fullData, { id: `c-${String(i)}`, sequence: 50 + i, delivery: 'critical' }),
    );
    const all = [...progressEvents, ...criticalEvents];
    const bundle = createSupportBundle({
      observerId: 'test',
      events: all,
      debugRecords: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const bytes = new TextEncoder().encode(JSON.stringify(bundle)).length;
    expect(bytes).toBeLessThanOrEqual(MAX_BUNDLE_BYTES);
    if (bundle.events.length < all.length) {
      expect(bundle.events.every((e) => e.delivery !== 'progress')).toBe(true);
    }
  });
  it('strips non-plain allowlisted values', () => {
    const sink = new JsonLinesSink({ capacity: 10 });
    sink.write(makeEvent({ phase: { nested: 'x' } }));
    expect(sink.lines[0] ?? '').not.toContain('"phase"');
    sink.clear();
    sink.write(makeEvent({ phase: ['a'] }));
    expect(sink.lines[0] ?? '').not.toContain('"phase"');
    sink.clear();
    sink.write(makeEvent({ phase: true }));
    expect(sink.lines[0] ?? '').toContain('"phase":true');
  });
});
