import { describe, expect, it } from 'vitest';
import { createEventDispatcher } from '@promptiris/core';
import type { Event } from '@promptiris/protocol';
import {
  attachObserver,
  createConsoleSink,
  createDebugCapture,
  createEventCapture,
  createSupportBundle,
  JsonLinesSink,
  MAX_BUNDLE_BYTES,
} from './index.js';
const event = (classification: Event['classification'] = 'metadata', sequence = 0): Event => ({
  schemaVersion: '1',
  id: `e-${String(sequence)}`,
  type: 'promptiris.phase.started',
  time: '2026-01-01T00:00:00.000Z',
  sequence,
  runId: 'run',
  traceId: 'run',
  source: 'core',
  dataSchema: 'promptiris/event/phase-started-v1',
  data: {
    phase: 'transform',
    status: true,
    durationMs: 1,
    nested: { status: 'ok' },
    timings: { values: [1, 'x', null] },
    secret: 'do-not-show',
  },
  classification,
  delivery: 'critical',
});
describe('sinks', () => {
  it('formats console and isolates writer failure', () => {
    const lines: string[] = [];
    createConsoleSink({ writer: (line) => lines.push(line) }).write(event());
    expect(lines[0]).toContain('phase=transform');
    const sink = createConsoleSink({
      writer: () => {
        throw new Error('x');
      },
    });
    expect(() => sink.write(event())).not.toThrow();
    const original = console.log;
    const logged: string[] = [];
    console.log = (line?: unknown) => logged.push(String(line));
    try {
      createConsoleSink().write({ ...event(), data: null });
    } finally {
      console.log = original;
    }
    expect(logged[0]).toContain('promptiris.phase.started');
  });
  it('validates capacity and clears lines', () => {
    expect(() => new JsonLinesSink({ capacity: 0 })).toThrow(RangeError);
    const sink = new JsonLinesSink();
    sink.write(event());
    expect(sink.lines).toHaveLength(1);
    sink.clear();
    expect(sink.lines).toHaveLength(0);
  });
  it('writes bounded redacted JSONL', () => {
    const sink = new JsonLinesSink({ capacity: 1 });
    sink.write(event());
    sink.write(event('sensitive', 1));
    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0]).toContain('transform');
    const content = new JsonLinesSink();
    content.write({ ...event('content'), data: ['hidden'] });
    expect(content.lines[0]).toContain('redacted');
  });
});
describe('captures and observer', () => {
  it('bounds captures', () => {
    expect(() => createDebugCapture(0)).toThrow(RangeError);
    expect(() => createEventCapture(0)).toThrow(RangeError);
    const c = createEventCapture(1);
    c.write(event());
    c.write(event('metadata', 1));
    expect(c.events[0]?.sequence).toBe(1);
    expect(c.dropped).toBe(1);
    const d = createDebugCapture(1);
    d.capture({
      id: '1',
      runId: 'r',
      traceId: 't',
      operation: 'x',
      exception: { type: 'Error', message: 'secret' },
    });
    d.capture({
      id: '2',
      runId: 'r',
      traceId: 't',
      operation: 'x',
      exception: { type: 'TypeError', message: 'secret' },
    });
    expect(d.records).toHaveLength(1);
    expect(d.dropped).toBe(1);
  });
  it('consumes dispatcher events and disposes safely', async () => {
    const dispatcher = createEventDispatcher('run');
    const capture = createEventCapture();
    const observer = attachObserver(dispatcher, capture, { observerId: 'test', capacity: 2 });
    dispatcher.emit({
      type: event().type,
      source: 'core',
      dataSchema: event().dataSchema,
      data: event().data,
      classification: 'metadata',
      delivery: 'critical',
    });
    dispatcher.complete('success');
    await observer.done;
    expect(capture.events).toHaveLength(2);
    await observer.detach();
    await observer[Symbol.asyncDispose]();
  });
});
describe('support bundle', () => {
  it('redacts content, is deterministic, and stays bounded', () => {
    const input = {
      observerId: 'obs',
      events: [event(), event('content', 1)],
      runId: 'r',
      traceId: 't',
      debugRecords: [
        {
          id: 'd',
          runId: 'r',
          traceId: 'r',
          operation: 'x',
          exception: { type: 'Error', message: 'secret', stack: 'secret' },
        },
      ],
    };
    const left = createSupportBundle(input);
    const right = createSupportBundle(input);
    expect(JSON.stringify(left)).toBe(JSON.stringify(right));
    expect(JSON.stringify(left)).not.toContain('do-not-show');
    expect(JSON.stringify(left)).not.toContain('secret');
    expect(new TextEncoder().encode(JSON.stringify(left)).length).toBeLessThanOrEqual(
      MAX_BUNDLE_BYTES,
    );
  });
  it('projects nested and non-object metadata safely', () => {
    const sink = new JsonLinesSink();
    sink.write({
      ...event(),
      data: {
        phase: { nested: { nested: { nested: { nested: { nested: 'x' } } } } },
        timings: Array.from({ length: 20 }, () => 'x'),
        status: Number.NaN,
      },
    });
    expect(sink.lines[0]).toContain('truncated');
  });
  it('handles missing debug identities', () => {
    const bundle = createSupportBundle({
      observerId: 'o',
      events: [event('sensitive')],
      debugRecords: [
        {
          id: 'd',
          runId: 'r',
          traceId: 'r',
          operation: 'x',
          exception: { type: 'Error', message: 'x' },
        },
      ],
    });
    expect(bundle.events[0]).toMatchObject({ data: { redacted: true } });
  });
  it('bounds oversized bundles to minimal form', () => {
    const huge = 'é'.repeat(256);
    const events = Array.from({ length: 256 }, (_, sequence) => ({
      ...event(),
      id: `huge-${String(sequence)}`,
      sequence,
      data: {
        phase: huge,
        status: huge,
        pluginId: huge,
        contributionId: huge,
        observerId: huge,
        reason: huge,
        fallback: huge,
        from: huge,
        to: huge,
        durationMs: sequence,
        timing: sequence,
        timings: huge,
        kind: huge,
        artifactKind: huge,
        mediaType: huge,
        digest: huge,
      },
    }));
    const bundle = createSupportBundle({
      observerId: 'o',
      events,
      debugRecords: [],
      runId: 'r',
      traceId: 't',
      configTraceId: 'c',
    });
    expect(new TextEncoder().encode(JSON.stringify(bundle)).length).toBeLessThanOrEqual(
      MAX_BUNDLE_BYTES,
    );
    expect(bundle.events.length).toBe(0);
  });
  it('bounds references and accepts explicit references', () => {
    const bundle = createSupportBundle({
      observerId: 'o',
      events: [
        { ...event(), id: 'same', sequence: 1 },
        { ...event(), id: 'same', sequence: 1 },
      ],
      debugRecords: [],
      manifestIds: ['b', 'a', 'a'],
      configTraceId: 'config',
      createdAt: 'fixed',
    });
    expect(bundle.manifestRefs).toEqual(['a', 'b']);
    expect(bundle.configTraceRef).toBe('config');
    expect(bundle.createdAt).toBe('fixed');
  });
});
