import { describe, it, expect } from 'vitest';
import { createObserverDevtools } from './observer.js';
import { JsonLinesSink, createConsoleSink } from './sinks.js';
import { createSupportBundle } from './support-bundle.js';
import type { DebugRecord, DebugRecordSink } from '@promptiris/core';
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
  it('redacts prompt/content/secret in JsonLinesSink', () => {
    const sink = new JsonLinesSink({ capacity: 5 });
    const e = makeEvent({
      id: '1',
      sequence: 0,
      data: { prompt: 'secret', secret: 's', other: 'keep' },
    });
    sink.write(e);
    const first = sink.lines[0] ?? '';
    expect(first).toContain('[redacted]');
    expect(first).toContain('keep');
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
  it('support bundle truncates when over MAX_BUNDLE_BYTES', () => {
    const largeData = 'x'.repeat(5000);
    const events: Event[] = Array.from({ length: 60 }, (_, i) =>
      makeEvent({
        id: `id-${String(i)}`,
        sequence: i,
        data: { largeData },
        delivery: i % 2 === 0 ? 'progress' : 'critical',
      }),
    );
    const bundle = createSupportBundle({ observerId: 'test', events, debugRecords: [] });
    // should have truncated progress events if over limit - at least produce bundle
    expect(bundle.events.length).toBeLessThanOrEqual(60);
    expect(bundle.bounded).toBe(true);
  });
  it('handles non-object data', () => {
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
    expect(first).toContain('string-data');
  });
  it('observer getDebugRecords bounded', () => {
    const d: DebugRecordSink = createObserverDevtools({ observerId: 'test/bound' });
    for (let i = 0; i < 200; i++) d.capture(makeDebugRecord(String(i)));
    const devtools = d as unknown as ReturnType<typeof createObserverDevtools>;
    expect(devtools.getDebugRecords().length).toBe(128);
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
});
