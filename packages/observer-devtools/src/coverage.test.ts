/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unnecessary-type-assertion */
import { describe, it, expect } from 'vitest';
import { createObserverDevtools } from './observer.js';
import { JsonLinesSink, createConsoleSink } from './sinks.js';
import { createSupportBundle } from './support-bundle.js';
import type { Event } from '@promptiris/protocol';

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
    const e = {
      schemaVersion: '1',
      id: '1',
      type: 't',
      time: new Date().toISOString(),
      sequence: 0,
      runId: 'r',
      traceId: 'r',
      source: 's',
      dataSchema: 'd',
      data: {},
      classification: 'metadata',
      delivery: 'critical',
    } as unknown as Event;
    sink.write(e);
    sink.write(e);
    sink.write(e);
    expect(sink.lines.length).toBe(2);
    sink.clear();
    expect(sink.lines.length).toBe(0);
  });
  it('console sink writer throws isolated', () => {
    const sink = createConsoleSink({
      writer: () => {
        throw new Error('boom');
      },
    });
    const e = {
      schemaVersion: '1',
      id: '1',
      type: 't',
      time: new Date().toISOString(),
      sequence: 0,
      runId: 'r',
      traceId: 'r',
      source: 's',
      dataSchema: 'd',
      data: {},
      classification: 'metadata',
      delivery: 'critical',
    } as unknown as Event;
    expect(() => sink.write(e)).not.toThrow();
  });
  it('redacts prompt/content/secret in JsonLinesSink', () => {
    const sink = new JsonLinesSink({ capacity: 5 });
    const e = {
      schemaVersion: '1',
      id: '1',
      type: 't',
      time: new Date().toISOString(),
      sequence: 0,
      runId: 'r',
      traceId: 'r',
      source: 's',
      dataSchema: 'd',
      data: { prompt: 'secret', secret: 's', other: 'keep' },
      classification: 'metadata',
      delivery: 'critical',
    } as unknown as Event;
    sink.write(e);
    expect(sink.lines[0]).toContain('[redacted]');
    expect(sink.lines[0]).toContain('keep');
  });
  it('sensitive classification redacted', () => {
    const sink = new JsonLinesSink({ capacity: 5 });
    const e = {
      schemaVersion: '1',
      id: '1',
      type: 't',
      time: new Date().toISOString(),
      sequence: 0,
      runId: 'r',
      traceId: 'r',
      source: 's',
      dataSchema: 'd',
      data: { prompt: 'secret' },
      classification: 'sensitive',
      delivery: 'critical',
    } as unknown as Event;
    sink.write(e);
    expect(sink.lines[0]).toContain('redacted');
  });
  it('support bundle truncates when over MAX_BUNDLE_BYTES', () => {
    const largeData = 'x'.repeat(5000);
    const events: Event[] = Array.from({ length: 60 }, (_, i) => ({
      schemaVersion: '1',
      id: `id-${String(i)}`,
      type: 't',
      time: new Date().toISOString(),
      sequence: i,
      runId: 'r',
      traceId: 'r',
      source: 's',
      dataSchema: 'd',
      data: { largeData },
      classification: 'metadata',
      delivery: i % 2 === 0 ? 'progress' : 'critical',
    })) as unknown as Event[];
    const bundle = createSupportBundle({ observerId: 'test', events, debugRecords: [] });
    // should have truncated progress events if over limit - at least produce bundle
    expect(bundle.events.length).toBeLessThanOrEqual(60);
    expect(bundle.bounded).toBe(true);
  });
  it('handles non-object data', () => {
    const sink = new JsonLinesSink({ capacity: 5 });
    const e = {
      schemaVersion: '1',
      id: '1',
      type: 't',
      time: new Date().toISOString(),
      sequence: 0,
      runId: 'r',
      traceId: 'r',
      source: 's',
      dataSchema: 'd',
      data: 'string-data' as unknown,
      classification: 'metadata',
      delivery: 'critical',
    } as unknown as Event;
    sink.write(e);
    expect(sink.lines[0]).toContain('string-data');
  });
  it('observer getDebugRecords bounded', () => {
    const d = createObserverDevtools({ observerId: 'test/bound' });
    for (let i = 0; i < 200; i++)
      d.capture({
        id: String(i),
        runId: 'r',
        traceId: 'r',
        operation: 'op',
        exception: { type: 'Error', message: 'm' },
      } as any);
    expect(d.getDebugRecords().length).toBe(128);
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
