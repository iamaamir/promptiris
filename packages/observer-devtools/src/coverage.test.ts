import { describe, it, expect } from 'vitest';
import { createObserverDevtools } from './observer.js';
import { JsonLinesSink, createConsoleSink } from './sinks.js';
import { createSupportBundle } from './support-bundle.js';
import { MAX_BUNDLE_BYTES } from './support-bundle.js';
void MAX_BUNDLE_BYTES;
import type { DebugRecord } from '@promptiris/core';
import type { Event } from '@promptiris/protocol';

function makeEvent(overrides: {
  id: string;
  sequence: number;
  delivery?: 'critical' | 'progress';
  data?: unknown;
  classification?: 'metadata' | 'sensitive';
}): Event {
  return {
    schemaVersion: '1',
    id: overrides.id,
    type: 't',
    time: new Date().toISOString(),
    sequence: overrides.sequence,
    runId: 'r',
    traceId: 'r',
    source: 's',
    dataSchema: 'd',
    data: overrides.data ?? {},
    classification: overrides.classification ?? 'metadata',
    delivery: overrides.delivery ?? 'critical',
  };
}

function makeDebugRecord(id: string): DebugRecord {
  return {
    id,
    runId: 'r',
    traceId: 'r',
    operation: 'op',
    exception: { type: 'Error', message: 'm' },
  };
}

describe('coverage branches', () => {
  it('rejects invalid observerId', () => {
    expect(() => createObserverDevtools({ observerId: '' })).toThrow();
  });
  it('rejects invalid capacity', () => {
    expect(() => createObserverDevtools({ capacity: 0 })).toThrow();
    expect(() => createObserverDevtools({ capacity: 1.5 })).toThrow();
  });
  it('rejects invalid maxEvents', () => {
    expect(() => createObserverDevtools({ maxEvents: 0 })).toThrow();
  });
  it('handles consoleSink false', () => {
    const d = createObserverDevtools({ observerId: 'test/false', consoleSink: false });
    expect(d.observerId).toBe('test/false');
  });
  it('JsonLinesSink rejects invalid capacity', () => {
    expect(() => new JsonLinesSink({ capacity: 0 })).toThrow();
  });
  it('JsonLinesSink capacity overflow and clear', () => {
    const sink = new JsonLinesSink({ capacity: 2 });
    const e = makeEvent({ id: '1', sequence: 0 });
    sink.write(e);
    sink.write(e);
    sink.write(e);
    expect(sink.lines.length).toBe(2);
    sink.clear();
    expect(sink.lines.length).toBe(0);
  });
  it('console sink writer throws isolated', () => {
    const sink = createConsoleSink({
      writer: (): void => {
        throw new Error('boom');
      },
    });
    const e = makeEvent({ id: '1', sequence: 0 });
    expect(() => sink.write(e)).not.toThrow();
  });
  it('strips non-allowlisted prompt/secret in JsonLinesSink via allowlist', () => {
    const sink = new JsonLinesSink({ capacity: 5 });
    const e = makeEvent({
      id: '1',
      sequence: 0,
      data: { prompt: 'secret', secret: 's', other: 'keep', phase: 'transform' },
    });
    sink.write(e);
    const first = sink.lines[0] ?? '';
    expect(first).toContain('transform');
    expect(first).not.toContain('secret');
    expect(first).not.toContain('prompt');
  });
  it('sensitive classification redacted', () => {
    const sink = new JsonLinesSink({ capacity: 5 });
    const e = makeEvent({
      id: '1',
      sequence: 0,
      data: { prompt: 'secret' },
      classification: 'sensitive',
    });
    sink.write(e);
    const first = sink.lines[0] ?? '';
    expect(first).toContain('redacted');
  });
  it('support bundle truncates when over MAX_BUNDLE_BYTES with exact UTF-8 cap', () => {
    const largeData = 'x'.repeat(5000);
    const events: Event[] = Array.from({ length: 60 }, (_, i) =>
      makeEvent({
        id: `id-${String(i)}`,
        sequence: i,
        data: { largeData, phase: 'transform' },
        delivery: i % 2 === 0 ? 'progress' : 'critical',
      }),
    );
    const bundle = createSupportBundle({
      observerId: 'test',
      events,
      debugRecords: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const bytes = new TextEncoder().encode(JSON.stringify(bundle)).length;
    expect(bytes).toBeLessThanOrEqual(MAX_BUNDLE_BYTES);
    expect(bundle.bounded).toBe(true);
  });
  it('handles non-object data by stripping', () => {
    const sink = new JsonLinesSink({ capacity: 5 });
    const e: Event = {
      schemaVersion: '1',
      id: '1',
      type: 't',
      time: new Date().toISOString(),
      sequence: 0,
      runId: 'r',
      traceId: 'r',
      source: 's',
      dataSchema: 'd',
      data: 'string-data',
      classification: 'metadata',
      delivery: 'critical',
    };
    sink.write(e);
    const first = sink.lines[0] ?? '';
    // string-data stripped because not allowlisted object
    expect(first).not.toContain('string-data');
  });
  it('observer getDebugRecords bounded and redacted', () => {
    const devtools = createObserverDevtools({ observerId: 'test/bound' });
    for (let i = 0; i < 200; i++) devtools.capture(makeDebugRecord(String(i)));
    const bundle = devtools.createBundle({ createdAt: '2026-01-01T00:00:00.000Z' });
    expect(bundle.debugRecords.length).toBe(128);
    expect(bundle.debugRecords[0]?.exception.message).toBe('[redacted]');
  });
  it('observer getEvents bounded', async () => {
    const { createEventDispatcher } = await import('@promptiris/core');
    const disp = createEventDispatcher('r-bound');
    const d = createObserverDevtools({
      observerId: 'test/bound2',
      maxEvents: 3,
      consoleSink: false,
    });
    const h = d.attach(disp);
    for (let i = 0; i < 5; i++)
      disp.emit({
        type: `t-${String(i)}`,
        source: 's',
        dataSchema: 'd',
        data: {},
        classification: 'metadata',
        delivery: 'critical',
      });
    disp.complete('success');
    await new Promise((r) => setTimeout(r, 20));
    expect(d.getEvents().length).toBe(3);
    await h.detach();
  });
  it('projectData handles array and non-plain and non-finite and truncation', () => {
    const sink = new JsonLinesSink({ capacity: 10 });
    const arrayEvent = makeEvent({ id: 'a', sequence: 0, data: ['x'] as unknown });
    sink.write(arrayEvent);
    expect(sink.lines[0] ?? '').not.toContain('x');
    sink.clear();
    class Foo {
      x = 1;
    }
    const instance = new Foo();
    const instanceEvent = makeEvent({ id: 'b', sequence: 1, data: instance });
    sink.write(instanceEvent);
    expect(sink.lines[0] ?? '').not.toContain('x');
    sink.clear();
    const nonFinite = makeEvent({ id: 'c', sequence: 2, data: { durationMs: Infinity } });
    sink.write(nonFinite);
    expect(sink.lines[0] ?? '').not.toContain('Infinity');
    sink.clear();
    const longStr = 'a'.repeat(300);
    const longEvent = makeEvent({ id: 'd', sequence: 3, data: { phase: longStr } });
    sink.write(longEvent);
    const parsed = JSON.parse(sink.lines[0] ?? '{}') as { data?: { phase?: string } };
    expect(parsed.data?.phase?.length).toBeLessThanOrEqual(257);
  });
  it('enforces hard byte cap with many critical events and debug records', () => {
    const bigStr = 'x'.repeat(256);
    const fullData = {
      phase: bigStr,
      status: bigStr,
      pluginId: bigStr,
      contributionId: bigStr,
      observerId: bigStr,
      reason: bigStr,
      fallback: bigStr,
      from: bigStr,
      to: bigStr,
      kind: bigStr,
      artifactKind: bigStr,
      mediaType: bigStr,
      digest: bigStr,
    };
    const events: Event[] = Array.from({ length: 256 }, (_, i) =>
      makeEvent({
        id: `id-${String(i)}`,
        sequence: i,
        data: fullData,
        delivery: 'critical',
      }),
    );
    const debugRecords: DebugRecord[] = Array.from({ length: 128 }, (_, i) => ({
      id: String(i),
      runId: 'r',
      traceId: 'r',
      operation: bigStr,
      exception: { type: 'Error', message: bigStr },
    }));
    const bundle = createSupportBundle({
      observerId: 'test-cap',
      events,
      debugRecords,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const bytes = new TextEncoder().encode(JSON.stringify(bundle)).length;
    expect(bytes).toBeLessThanOrEqual(MAX_BUNDLE_BYTES);
    expect(bundle.events.length).toBeLessThan(256);
  });
  it('covers remaining branches: null data, array data, non-finite, pluginId debug, and byte cap middle branch', () => {
    // null data
    const nullEvent = makeEvent({ id: 'null', sequence: 0, data: null });
    const arrayEvent = makeEvent({ id: 'arr', sequence: 1, data: [1, 2] });
    const nonFiniteEvent = makeEvent({ id: 'nf', sequence: 2, data: { durationMs: Infinity } });
    const bundleNull = createSupportBundle({
      observerId: 'test-null',
      events: [nullEvent, arrayEvent, nonFiniteEvent],
      debugRecords: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(bundleNull.events.length).toBe(3);
    // debug with pluginId/contributionId
    const debugWithIds: DebugRecord = {
      id: 'd1',
      runId: 'r',
      traceId: 'r',
      operation: 'op',
      pluginId: 'plug/a',
      contributionId: 'contrib/b',
      exception: { type: 'Error', message: 'msg' },
    };
    const bundleDebug = createSupportBundle({
      observerId: 'test-debug',
      events: [],
      debugRecords: [debugWithIds],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(bundleDebug.debugRecords[0]?.pluginId).toBe('plug/a');
    // bundle without createdAt to hit new Date branch
    const bundleNoAt = createSupportBundle({
      observerId: 'test-noAt',
      events: [],
      debugRecords: [],
    });
    expect(bundleNoAt.createdAt).toBeDefined();
    // middle branch: over cap initially but under after dropping progress
    const bigStr = 'x'.repeat(256);
    const fullData = {
      phase: bigStr,
      status: bigStr,
      pluginId: bigStr,
      digest: bigStr,
    };
    const mixedEvents: Event[] = [
      ...Array.from({ length: 50 }, (_, i) =>
        makeEvent({
          id: `p-${String(i)}`,
          sequence: i,
          data: fullData,
          delivery: 'progress',
        }),
      ),
      ...Array.from({ length: 50 }, (_, i) =>
        makeEvent({
          id: `c-${String(i)}`,
          sequence: 50 + i,
          data: fullData,
          delivery: 'critical',
        }),
      ),
    ];
    const bundleMid = createSupportBundle({
      observerId: 'test-mid',
      events: mixedEvents,
      debugRecords: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const bytesMid = new TextEncoder().encode(JSON.stringify(bundleMid)).length;
    expect(bytesMid).toBeLessThanOrEqual(MAX_BUNDLE_BYTES);
  });
});
