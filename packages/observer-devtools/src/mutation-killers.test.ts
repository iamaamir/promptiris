import { describe, it, expect, vi } from 'vitest';
import { JsonLinesSink, formatEvent, createConsoleSink } from './sinks.js';
import {
  createSupportBundle,
  MAX_BUNDLE_BYTES,
  MAX_BUNDLE_DEBUG_RECORDS,
  MAX_BUNDLE_EVENTS,
} from './support-bundle.js';
import { createObserverDevtools } from './observer.js';
import type { Event } from '@promptiris/protocol';
import type { DebugRecord } from '@promptiris/core';

function ev(data: unknown, overrides: Partial<Event> = {}): Event {
  return {
    schemaVersion: '1',
    id: overrides.id ?? 'id',
    type: 't',
    time: new Date().toISOString(),
    sequence: overrides.sequence ?? 0,
    runId: 'r',
    traceId: 't',
    source: 's',
    dataSchema: 'd',
    data,
    classification: overrides.classification ?? 'metadata',
    delivery: overrides.delivery ?? 'critical',
    ...overrides,
  };
}

describe('sinks killers', () => {
  it('boundedString truncates exactly at 256', () => {
    const sink = new JsonLinesSink({ capacity: 5 });
    const at256 = 'a'.repeat(256);
    const at257 = 'a'.repeat(257);
    sink.write(ev({ phase: at256 }));
    expect(sink.lines[0]).toContain(at256);
    expect(sink.lines[0]).not.toContain('…');
    sink.clear();
    sink.write(ev({ phase: at257 }));
    expect(sink.lines[0]).toContain('…');
    expect(sink.lines[0]).not.toContain(at257);
  });

  it('pollution keys are filtered', () => {
    const sink = new JsonLinesSink({ capacity: 5 });
    const pollution = Object.create(null) as Record<string, unknown>;
    pollution.phase = 'ok';
    Object.defineProperty(pollution, '__proto__', { value: 'x', enumerable: true });
    Object.defineProperty(pollution, 'constructor', { value: 'y', enumerable: true });
    Object.defineProperty(pollution, 'prototype', { value: 'z', enumerable: true });
    sink.write(ev(pollution));
    const line = sink.lines[0] ?? '';
    expect(line).not.toContain('__proto__');
    expect(line).not.toContain('constructor');
    expect(line).not.toContain('prototype');
    expect(line).toContain('phase');
  });

  it('non-object data returns undefined project', () => {
    const sink = new JsonLinesSink({ capacity: 5 });
    sink.write(ev(null));
    expect(sink.lines[0]).toContain('"data":{}');
    sink.clear();
    sink.write(ev('string'));
    expect(sink.lines[0]).toContain('"data":{}');
    sink.clear();
    sink.write(ev(['a']));
    expect(sink.lines[0]).toContain('"data":{}');
    sink.clear();
    sink.write(ev(42));
    expect(sink.lines[0]).toContain('"data":{}');
  });

  it('empty project returns undefined', () => {
    const sink = new JsonLinesSink({ capacity: 5 });
    sink.write(ev({ prompt: 'leak' }));
    expect(sink.lines[0]).toContain('"data":{}');
  });

  it('JsonLinesSink respects capacity and clear', () => {
    const sink = new JsonLinesSink({ capacity: 2 });
    sink.write(ev({ phase: 'a' }));
    sink.write(ev({ phase: 'b' }));
    sink.write(ev({ phase: 'c' }));
    expect(sink.lines.length).toBe(2);
    sink.clear();
    expect(sink.lines.length).toBe(0);
  });

  it('JsonLinesSink throws on invalid capacity', () => {
    expect(() => new JsonLinesSink({ capacity: 0 })).toThrow('capacity must be positive integer');
    expect(() => new JsonLinesSink({ capacity: -1 })).toThrow(RangeError);
    expect(() => new JsonLinesSink({ capacity: 1.5 })).toThrow(RangeError);
    expect(() => new JsonLinesSink({ capacity: NaN })).toThrow(RangeError);
  });

  it('JsonLinesSink isolates write failures', () => {
    const sink = new JsonLinesSink({ capacity: 5 });
    const evil = {
      phase: 'ok',
      get toJSON() {
        throw new Error('boom');
      },
    };
    // projectData will call boundedString which may throw, but write should not throw
    expect(() => sink.write(ev(evil))).not.toThrow();
  });

  it('createConsoleSink isolates writer failures', () => {
    const writer = vi.fn(() => {
      throw new Error('writer boom');
    });
    const sink = createConsoleSink({ writer });
    expect(() => sink.write(ev({ phase: 'a' }))).not.toThrow();
    expect(writer).toHaveBeenCalled();
  });

  it('createConsoleSink defaults to console.log', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const sink = createConsoleSink();
    sink.write(ev({ phase: 'a' }));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('formatEvent handles missing data', () => {
    const e = ev(null);
    const line = formatEvent(e);
    expect(line).toContain('[0]');
    expect(line).toContain('source=s');
  });

  it('formatEvent filters non-finite numbers', () => {
    const e = ev({ durationMs: Infinity, timing: NaN });
    const line = formatEvent(e);
    expect(line).not.toContain('durationMs');
    expect(line).not.toContain('timing');
  });

  it('formatEvent handles all string fields', () => {
    const data = {
      phase: 'p',
      pluginId: 'pl',
      contributionId: 'c',
      status: 's',
      observerId: 'o',
      reason: 'r',
      fallback: 'f',
      kind: 'k',
      artifactKind: 'ak',
      digest: 'd',
    };
    const line = formatEvent(ev(data));
    expect(line).toContain('phase=p');
    expect(line).toContain('plugin=pl');
    expect(line).toContain('contrib=c');
    expect(line).toContain('status=s');
    expect(line).toContain('observer=o');
    expect(line).toContain('reason=r');
    expect(line).toContain('fallback=f');
    expect(line).toContain('kind=k');
    expect(line).toContain('artifactKind=ak');
    expect(line).toContain('digest=d');
    for (const v of Object.values(data)) expect(line).toContain(v);
    expect(line).toBe(
      '[0] t source=s phase=p plugin=pl contrib=c status=s observer=o reason=r fallback=f kind=k artifactKind=ak digest=d delivery=critical',
    );
    const sink = new JsonLinesSink({ capacity: 2 });
    sink.write(ev(data));
    for (const v of Object.values(data)) expect(sink.lines[0]).toContain(v);
  });

  it('sensitive classification redacts in JsonLinesSink', () => {
    const sink = new JsonLinesSink({ capacity: 5 });
    sink.write(ev({ phase: 'secret', status: 'ok' }, { classification: 'sensitive' }));
    expect(sink.lines[0]).toContain('"redacted":true');
    expect(sink.lines[0]).not.toContain('secret');
  });

  it('isPlainValue branches: boolean/number/string vs object', () => {
    const sink = new JsonLinesSink({ capacity: 10 });
    sink.write(ev({ phase: true }));
    expect(sink.lines[0]).toContain('"phase":true');
    sink.clear();
    sink.write(ev({ phase: false }));
    expect(sink.lines[0]).toContain('"phase":false');
    sink.clear();
    sink.write(ev({ phase: 0 }));
    expect(sink.lines[0]).toContain('"phase":0');
    sink.clear();
    sink.write(ev({ phase: null as unknown as string }));
    expect(sink.lines[0]).not.toContain('"phase"');
  });
});

describe('support-bundle killers', () => {
  it('redacts sensitive events', () => {
    const e = ev({ phase: 'leak', prompt: 'leak' }, { classification: 'sensitive' });
    const b = createSupportBundle({
      observerId: 'o',
      events: [e],
      debugRecords: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect((b.events[0]?.data as Record<string, unknown>).redacted).toBe(true);
    expect(JSON.stringify(b.events[0])).not.toContain('leak');
  });

  it('projects non-sensitive events', () => {
    const e = ev({ phase: 'ok', prompt: 'leak', durationMs: 5 });
    const b = createSupportBundle({
      observerId: 'o',
      events: [e],
      debugRecords: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect((b.events[0]?.data as Record<string, unknown>).phase).toBe('ok');
    expect(JSON.stringify(b.events[0])).not.toContain('prompt');
  });

  it('support-bundle keeps all allowlisted keys', () => {
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
      timings: 7,
      kind: 'j',
      artifactKind: 'k',
      mediaType: 'l',
      digest: 'm',
    };
    const e = ev(data);
    const b = createSupportBundle({
      observerId: 'o',
      events: [e],
      debugRecords: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const d = b.events[0]?.data as Record<string, unknown>;
    expect(d.phase).toBe('a');
    expect(d.status).toBe('b');
    expect(d.pluginId).toBe('c');
    expect(d.contributionId).toBe('d');
    expect(d.observerId).toBe('e');
    expect(d.reason).toBe('f');
    expect(d.fallback).toBe('g');
    expect(d.from).toBe('h');
    expect(d.to).toBe('i');
    expect(d.durationMs).toBe(42);
    expect(d.timing).toBe(5);
    expect(d.timings).toBe(7);
    expect(d.kind).toBe('j');
    expect(d.artifactKind).toBe('k');
    expect(d.mediaType).toBe('l');
    expect(d.digest).toBe('m');
    expect(d.from).toBe('h');
    expect(d.to).toBe('i');
  });

  it('stableStringify sorts keys deterministically', () => {
    const e1 = ev({ status: 'b', phase: 'a' });
    const e2 = ev({ phase: 'a', status: 'b' });
    const b1 = createSupportBundle({
      observerId: 'o',
      events: [e1],
      debugRecords: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const b2 = createSupportBundle({
      observerId: 'o',
      events: [e2],
      debugRecords: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const d1 = b1.events[0]?.data as Record<string, unknown>;
    const d2 = b2.events[0]?.data as Record<string, unknown>;
    expect(d1.phase).toBe('a');
    expect(d1.status).toBe('b');
    expect(d2.phase).toBe('a');
    expect(d2.status).toBe('b');
  });

  it('support projection rejects unsafe values and preserves deterministic field order', () => {
    const data = Object.create(null) as Record<string, unknown>;
    data.status = 'b';
    data.phase = 'a';
    data.fallback = true;
    data.durationMs = Infinity;
    data.timing = NaN;
    data.nested = { z: 'secret', a: 'secret' };
    const bundle = createSupportBundle({
      observerId: 'o',
      events: [ev(data)],
      debugRecords: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const line = JSON.stringify(bundle.events[0]);
    expect(line).toContain('"phase":"a"');
    expect(line.indexOf('"phase"')).toBeLessThan(line.indexOf('"status"'));
    const projected = bundle.events[0]?.data as Record<string, unknown>;
    expect(projected.fallback).toBe(true);
    expect(projected.durationMs).toBeUndefined();
    expect(projected.timing).toBeUndefined();
    expect(projected.nested).toBeUndefined();
    expect(projected.status).toBe('b');
  });

  it('enforceByteCap drops progress before slicing critical events', () => {
    const big = 'x'.repeat(900);
    const data = {
      phase: big,
      status: big,
      pluginId: big,
      digest: big,
      reason: big,
      fallback: big,
    };
    const progress = Array.from({ length: 260 }, (_, i) =>
      ev(data, { id: `p-${String(i)}`, sequence: i, delivery: 'progress' }),
    );
    const critical = Array.from({ length: 260 }, (_, i) =>
      ev(data, { id: `c-${String(i)}`, sequence: 1000 + i, delivery: 'critical' }),
    );
    const bundle = createSupportBundle({
      observerId: 'o',
      events: [...progress, ...critical],
      debugRecords: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(bundle.events.length).toBeLessThanOrEqual(MAX_BUNDLE_EVENTS);
    expect(bundle.events.some((e) => e.delivery === 'progress')).toBe(false);
    expect(new TextEncoder().encode(JSON.stringify(bundle)).length).toBeLessThanOrEqual(
      MAX_BUNDLE_BYTES,
    );
  });

  it('handles huge bundle by clearing events and debugRecords', () => {
    const hugeDebug: DebugRecord[] = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      runId: 'r',
      traceId: 't',
      operation: 'op'.repeat(1000),
      pluginId: 'p',
      exception: { type: 'E', message: 'm'.repeat(5000) },
    }));
    const hugeEvents = Array.from({ length: 50 }, (_, i) =>
      ev({ phase: 'x'.repeat(5000) }, { id: `e-${String(i)}`, sequence: i }),
    );
    const b = createSupportBundle({
      observerId: 'o',
      events: hugeEvents,
      debugRecords: hugeDebug,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const bytes = new TextEncoder().encode(JSON.stringify(b)).length;
    expect(bytes).toBeLessThanOrEqual(MAX_BUNDLE_BYTES);
    // when still over after dropping progress, it clears both
    if (b.events.length === 0) expect(b.debugRecords.length).toBe(0);
  });

  it('buildInitialBundle sorts manifestRefs and handles optional fields', () => {
    const b = createSupportBundle({
      observerId: 'o',
      events: [],
      debugRecords: [],
      manifestIds: ['z', 'a', 'm'],
      configTraceId: 'cfg',
      runId: 'run',
      traceId: 'trace',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(b.manifestRefs).toEqual(['a', 'm', 'z']);
    expect(b.manifestRefs).toHaveLength(3);
    expect(b.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(b.configTraceRef).toBe('cfg');
    expect(
      createSupportBundle({
        observerId: 'o',
        events: [],
        debugRecords: [],
        configTraceId: 'x'.repeat(512),
        manifestIds: Array.from({ length: 100 }, (_, i) => String(i)),
        createdAt: '2026-01-01T00:00:00.000Z',
      }).configTraceRef?.length,
    ).toBe(512);
    expect(
      createSupportBundle({
        observerId: 'o',
        events: [],
        debugRecords: [],
        configTraceId: 'x'.repeat(513),
        manifestIds: Array.from({ length: 100 }, (_, i) => String(i)),
        createdAt: '2026-01-01T00:00:00.000Z',
      }).configTraceRef?.length,
    ).toBe(513);
    expect(
      createSupportBundle({
        observerId: 'o',
        events: [],
        debugRecords: [],
        manifestIds: Array.from({ length: 100 }, (_, i) => String(i)),
        createdAt: '2026-01-01T00:00:00.000Z',
      }).manifestRefs,
    ).toHaveLength(64);
    expect(b.runId).toBe('run');
    expect(b.traceId).toBe('trace');
  });

  it('buildInitialBundle without optional fields', () => {
    const b = createSupportBundle({
      observerId: 'o',
      events: [],
      debugRecords: [],
    });
    expect(b.manifestRefs).toEqual([]);
    expect(b.runId).toBeUndefined();
    expect(b.configTraceRef).toBeUndefined();
    expect(b.createdAt).toBe('1970-01-01T00:00:00.000Z');
  });

  it('utf8 byte length handles multi-byte', () => {
    const emoji = '😀'.repeat(1000);
    const e = ev({ phase: emoji });
    const b = createSupportBundle({
      observerId: 'o',
      events: [e],
      debugRecords: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const bytes = new TextEncoder().encode(JSON.stringify(b)).length;
    expect(bytes).toBeLessThanOrEqual(MAX_BUNDLE_BYTES);
  });

  it('redactDebugRecord strips stack and redacts message', () => {
    const rec: DebugRecord = {
      id: '1',
      runId: 'r',
      traceId: 't',
      operation: 'op',
      pluginId: 'p',
      contributionId: 'c',
      exception: { type: 'E', message: 'secret', stack: 'stacktrace' },
    };
    const b = createSupportBundle({
      observerId: 'o',
      events: [],
      debugRecords: [rec],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(b.debugRecords[0]?.exception.message).toBe('[redacted]');
    expect((b.debugRecords[0] as unknown as Record<string, unknown>).stack).toBeUndefined();
    expect(b.debugRecords[0]?.contributionId).toBe('c');
  });

  it('slices events and debugRecords at max', () => {
    const events = Array.from({ length: MAX_BUNDLE_EVENTS + 10 }, (_, i) =>
      ev({}, { id: `e-${String(i)}`, sequence: i }),
    );
    const recs: DebugRecord[] = Array.from({ length: MAX_BUNDLE_DEBUG_RECORDS + 10 }, (_, i) => ({
      id: String(i),
      runId: 'r',
      traceId: 't',
      operation: 'op',
      exception: { type: 'E', message: 'm' },
    }));
    const b = createSupportBundle({
      observerId: 'o',
      events,
      debugRecords: recs,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(b.events.length).toBe(MAX_BUNDLE_EVENTS);
    expect(b.debugRecords.length).toBe(MAX_BUNDLE_DEBUG_RECORDS);
  });
});

describe('observer killers', () => {
  it('resolveObserverId throws on empty', () => {
    expect(() => createObserverDevtools({ observerId: '' })).toThrow(
      'observerId must be non-empty string',
    );
    expect(() => createObserverDevtools({ observerId: 123 as unknown as string })).toThrow();
  });

  it('resolveCapacity throws on invalid', () => {
    expect(() => createObserverDevtools({ capacity: 0 })).toThrow(
      'capacity must be positive integer',
    );
    expect(() => createObserverDevtools({ capacity: -1 })).toThrow(RangeError);
    expect(() => createObserverDevtools({ capacity: 1.5 })).toThrow(RangeError);
  });

  it('resolveMaxEvents throws on invalid', () => {
    expect(() => createObserverDevtools({ maxEvents: 0 })).toThrow(
      'maxEvents must be positive integer',
    );
    expect(() => createObserverDevtools({ maxEvents: -1 })).toThrow(RangeError);
    expect(() => createObserverDevtools({ maxEvents: NaN })).toThrow(RangeError);
  });

  it('createSinks respects false and custom', () => {
    const consoleSink = createConsoleSink({ writer: () => undefined });
    const dev1 = createObserverDevtools({ consoleSink: false });
    expect(dev1.observerId).toBe('promptiris/observer-devtools');
    const dev2 = createObserverDevtools({ consoleSink });
    expect(dev2.observerId).toBe('promptiris/observer-devtools');
    const jsonSink = new JsonLinesSink({ capacity: 10 });
    const dev3 = createObserverDevtools({ jsonSink });
    expect(dev3.jsonSink).toBe(jsonSink);
  });

  it('onEvent respects maxEvents and forward isolation', () => {
    const dev = createObserverDevtools({
      maxEvents: 2,
      consoleSink: {
        write: () => {
          throw new Error('boom');
        },
      },
    });
    const e1 = ev({ phase: 'a' }, { sequence: 0 });
    const e2 = ev({ phase: 'b' }, { sequence: 1 });
    const e3 = ev({ phase: 'c' }, { sequence: 2 });
    // need to trigger via internal state - use capture not, so use createBundle path via direct onEvent not exposed
    // instead test via attach handler: simulate dispatcher
    const dispatcher = {
      subscribe: () => ({
        [Symbol.asyncIterator]: async function* () {
          yield e1;
          yield e2;
          yield e3;
        },
        return: async () => undefined,
      }),
    } as unknown as import('@promptiris/core').EventDispatcher;
    const sub = dev.attach(dispatcher);
    // give async loop time
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(dev.getEvents().length).toBe(2);
        void sub.detach().then(() => resolve());
      }, 50);
    });
  });

  it('capture respects MAX_BUNDLE_DEBUG_RECORDS', () => {
    const dev = createObserverDevtools();
    for (let i = 0; i < 200; i++) {
      dev.capture({
        id: String(i),
        runId: 'r',
        traceId: 't',
        operation: 'op',
        exception: { type: 'E', message: 'm' },
      });
    }
    expect(dev.getDebugRecords().length).toBe(MAX_BUNDLE_DEBUG_RECORDS);
  });

  it('createBundle includes manifest and trace refs', () => {
    const dev = createObserverDevtools({ manifestIds: ['m1'], configTraceId: 'cfg' });
    const b = dev.createBundle({ createdAt: '2026-01-01T00:00:00.000Z' });
    expect(b.manifestRefs).toContain('m1');
    expect(b.configTraceRef).toBe('cfg');
  });

  it('detach isolates failures', async () => {
    const dev = createObserverDevtools();
    let returnCalled = 0;
    const dispatcher = {
      subscribe: () => ({
        [Symbol.asyncIterator]: async function* () {
          yield ev({ phase: 'x' });
        },
        return: async () => {
          returnCalled += 1;
          throw new Error('detach boom');
        },
      }),
    } as unknown as import('@promptiris/core').EventDispatcher;
    const h = dev.attach(dispatcher);
    await expect(h.detach()).resolves.toBeUndefined();
    expect(returnCalled).toBe(1);
  });

  it('attach stops after detach and closes subscription once', async () => {
    let returnCalled = 0;
    let detached = false;
    const handleRef: { current?: { detach(): Promise<void> } } = {};
    const dispatcher = {
      subscribe: () => ({
        index: 0,
        async next() {
          this.index += 1;
          if (this.index === 1)
            return {
              done: false,
              value: ev({ phase: 'first' }, { sequence: 1 }),
            };
          await new Promise((resolve) => setTimeout(resolve, 25));
          return {
            done: false,
            value: ev({ phase: 'second' }, { sequence: 2 }),
          };
        },
        async return() {
          returnCalled += 1;
          detached = true;
          return { done: true, value: undefined };
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      }),
    } as unknown as import('@promptiris/core').EventDispatcher;
    const consoleSink = createConsoleSink({
      writer: () => {
        if (!detached) void handleRef.current?.detach();
      },
    });
    const dev = createObserverDevtools({ consoleSink });
    const handle = dev.attach(dispatcher);
    handleRef.current = handle;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(returnCalled).toBeGreaterThanOrEqual(1);
    expect(dev.getEvents().length).toBe(1);
    expect(dev.getEvents()[0]?.data).toEqual({ phase: 'first' });
  });
});
