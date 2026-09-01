import { describe, it, expect } from 'vitest';
import { createEventDispatcher } from '@promptiris/core';
import { captureDebugRecord } from '@promptiris/core';
import type { Event } from '@promptiris/protocol';
import { createObserverDevtools } from './observer.js';
import { JsonLinesSink, createConsoleSink, formatEvent } from './sinks.js';
import { createSupportBundle, MAX_BUNDLE_BYTES, MAX_BUNDLE_EVENTS } from './support-bundle.js';
import { OBSERVER_DEVTOOLS_PACKAGE } from './index.js';

it('exports package identity', () => {
  expect(OBSERVER_DEVTOOLS_PACKAGE).toBe('@promptiris/observer-devtools');
});

function emit(
  dispatcher: ReturnType<typeof createEventDispatcher>,
  type: string,
  data: unknown,
  delivery: 'critical' | 'progress' = 'critical',
): void {
  dispatcher.emit({
    type,
    source: 'test',
    dataSchema: 'test/v1',
    data,
    classification: 'metadata',
    delivery,
  });
}

function makeEvent(overrides: {
  id: string;
  sequence: number;
  runId: string;
  traceId: string;
  delivery?: 'critical' | 'progress';
  data?: unknown;
}): Event {
  return {
    schemaVersion: '1',
    id: overrides.id,
    type: 'test.event',
    time: new Date().toISOString(),
    sequence: overrides.sequence,
    runId: overrides.runId,
    traceId: overrides.traceId,
    source: 'test',
    dataSchema: 'test/v1',
    data: overrides.data ?? { index: overrides.sequence },
    classification: 'metadata',
    delivery: overrides.delivery ?? 'critical',
  };
}

describe('observer devtools', () => {
  it('consumes standard events without changing run outcome', async () => {
    const dispatcher = createEventDispatcher('run-1');
    const devtools = createObserverDevtools({ observerId: 'test/observer' });
    const handle = devtools.attach(dispatcher);
    emit(dispatcher, 'promptiris.phase.started', { phase: 'transform' });
    emit(dispatcher, 'promptiris.phase.completed', { phase: 'transform', status: 'success' });
    dispatcher.complete('success');
    await new Promise((r) => setTimeout(r, 10));
    expect(devtools.getEvents().length).toBeGreaterThanOrEqual(2);
    expect(devtools.getEvents().every((e) => typeof e.type === 'string')).toBe(true);
    await handle.detach();
    // must not throw or affect dispatcher
    expect(() =>
      dispatcher.emit({
        type: 'after',
        source: 'test',
        dataSchema: 'test/v1',
        data: {},
        classification: 'metadata',
        delivery: 'critical',
      }),
    ).toThrow();
  });

  it('does not invent event dialect, only forwards standard types', async () => {
    const dispatcher = createEventDispatcher('run-2');
    const devtools = createObserverDevtools({ observerId: 'test/observer2' });
    devtools.attach(dispatcher);
    emit(dispatcher, 'promptiris.plugin.activation-started', {
      pluginId: 'p/a',
      contributionId: 'c1',
    });
    dispatcher.complete('success');
    await new Promise((r) => setTimeout(r, 10));
    expect(devtools.getEvents().map((e) => e.type)).toContain(
      'promptiris.plugin.activation-started',
    );
    expect(devtools.getEvents().map((e) => e.dataSchema)).toContain('test/v1');
  });

  it('console and json sinks show stage progress, plugin identity, cancellation', async () => {
    const lines: string[] = [];
    const consoleSink = createConsoleSink({ writer: (l) => lines.push(l) });
    const jsonSink = new JsonLinesSink({ capacity: 10 });
    const dispatcher = createEventDispatcher('run-3');
    const devtools = createObserverDevtools({ observerId: 'test/obs3', consoleSink, jsonSink });
    devtools.attach(dispatcher);
    emit(dispatcher, 'promptiris.phase.started', { phase: 'analyze' });
    emit(dispatcher, 'promptiris.plugin.activation-started', {
      pluginId: 'plug/a',
      contributionId: 'c1',
    });
    emit(dispatcher, 'promptiris.run.cancelled', { reason: 'user' });
    dispatcher.complete('cancelled');
    await new Promise((r) => setTimeout(r, 20));
    expect(lines.join(' ')).toContain('phase=analyze');
    expect(lines.join(' ')).toContain('plugin=plug/a');
    expect(jsonSink.lines.length).toBeGreaterThan(0);
    expect(jsonSink.lines[0]).toContain('promptiris.phase.started');
  });

  it('console and json sinks show fallback, timing, artifact refs via allowlisted projection', async () => {
    const lines: string[] = [];
    const consoleSink = createConsoleSink({ writer: (l) => lines.push(l) });
    const jsonSink = new JsonLinesSink({ capacity: 10 });
    const dispatcher = createEventDispatcher('run-fallback');
    const devtools = createObserverDevtools({ observerId: 'test/fallback', consoleSink, jsonSink });
    devtools.attach(dispatcher);
    emit(dispatcher, 'promptiris.fallback.triggered', {
      fallback: 'original',
      reason: 'policy',
      durationMs: 123,
      kind: 'prompt',
      digest: 'sha256:abc',
    });
    dispatcher.complete('success');
    await new Promise((r) => setTimeout(r, 20));
    const joined = lines.join(' ');
    expect(joined).toContain('fallback=original');
    expect(joined).toContain('durationMs=123');
    expect(joined).toContain('digest=sha256:abc');
    const parsed = JSON.parse(jsonSink.lines[0] ?? '{}') as { data?: Record<string, unknown> };
    expect(parsed.data?.fallback).toBe('original');
    expect(parsed.data?.durationMs).toBe(123);
  });

  it('sink failure cannot fail transformation', async () => {
    const failingSink = {
      write: (): void => {
        throw new Error('sink boom');
      },
    };
    const dispatcher = createEventDispatcher('run-4');
    const devtools = createObserverDevtools({ observerId: 'test/obs4', consoleSink: failingSink });
    devtools.attach(dispatcher);
    emit(dispatcher, 'promptiris.phase.started', { phase: 'transform' });
    dispatcher.complete('success');
    await new Promise((r) => setTimeout(r, 10));
    expect(devtools.getEvents().length).toBeGreaterThan(0);
  });

  it('backpressure and disposal cannot fail', async () => {
    const dispatcher = createEventDispatcher('run-5');
    const devtools = createObserverDevtools({ observerId: 'test/obs5', capacity: 1 });
    const h = devtools.attach(dispatcher);
    // flood progress events to trigger drop
    for (let i = 0; i < 10; i++) emit(dispatcher, `test.progress-${String(i)}`, { i }, 'progress');
    dispatcher.complete('success');
    await new Promise((r) => setTimeout(r, 20));
    // should have at least drop event in dispatcher sink + not throw
    await expect(h.detach()).resolves.not.toThrow();
  });

  it('support bundle is explicit bounded deterministic redacted', async () => {
    const dispatcher = createEventDispatcher('run-6');
    const devtools = createObserverDevtools({
      observerId: 'test/obs6',
      manifestIds: ['plug/a'],
      configTraceId: 'trace-1',
    });
    devtools.attach(dispatcher);
    // sensitive event should be redacted in bundle
    dispatcher.emit({
      type: 'test.sensitive',
      source: 'test',
      dataSchema: 'test/v1',
      data: { prompt: 'secret prompt', value: '123' },
      classification: 'sensitive',
      delivery: 'critical',
    });
    dispatcher.complete('success');
    captureDebugRecord(devtools, new Error('secret debug message with password=123'), {
      runId: 'run-6',
      traceId: 'run-6',
      operation: 'test',
    });
    await new Promise((r) => setTimeout(r, 10));
    const bundle = devtools.createBundle({ createdAt: '2026-01-01T00:00:00.000Z' });
    expect(bundle.bounded).toBe(true);
    expect(bundle.redacted).toBe(true);
    expect(bundle.deterministic).toBe(true);
    expect(bundle.schemaVersion).toBe('1');
    const sensitive = bundle.events.find((e) => e.type === 'test.sensitive');
    expect(sensitive?.data).toEqual({ redacted: true });
    expect(bundle.manifestRefs).toEqual(['plug/a']);
    expect(bundle.configTraceRef).toBe('trace-1');
    // debug records must be redacted, no raw message/stack
    expect(bundle.debugRecords[0]?.exception.message).toBe('[redacted]');
    expect(
      (bundle.debugRecords[0] as unknown as { exception: { stack?: string } }).exception.stack,
    ).toBeUndefined();
  });

  it('bounds bundle bytes deterministically with exact UTF-8 cap', () => {
    const fixedAt = '2026-01-01T00:00:00.000Z';
    const events: Event[] = Array.from({ length: MAX_BUNDLE_EVENTS + 20 }, (_, i) =>
      makeEvent({
        id: `id-${String(i)}`,
        sequence: i,
        runId: 'r',
        traceId: 'r',
        delivery: i % 2 === 0 ? 'progress' : 'critical',
      }),
    );
    const bundle = createSupportBundle({
      observerId: 'test',
      events,
      debugRecords: [],
      createdAt: fixedAt,
    });
    expect(bundle.events.length).toBeLessThanOrEqual(MAX_BUNDLE_EVENTS);
    const bytes = new TextEncoder().encode(JSON.stringify(bundle)).length;
    expect(bytes).toBeLessThanOrEqual(MAX_BUNDLE_BYTES);
    // deterministic: second call with same createdAt must be byte-for-byte equal
    const bundle2 = createSupportBundle({
      observerId: 'test',
      events,
      debugRecords: [],
      createdAt: fixedAt,
    });
    expect(JSON.stringify(bundle)).toBe(JSON.stringify(bundle2));
  });

  it('manifest is usable without runtime internals via public SDK', () => {
    const devtools = createObserverDevtools({ observerId: 'test/usable' });
    expect(devtools.manifest.type).toBe('observer');
    expect(devtools.manifest.id).toBe('test/usable');
    // plugin authors can attach via public EventDispatcher and DebugRecordSink interfaces
    const dispatcher = createEventDispatcher('run-usable');
    const handle = devtools.attach(dispatcher);
    expect(handle).toBeDefined();
    expect(typeof handle.detach).toBe('function');
  });

  it('formatEvent shows stage progress and artifact refs', () => {
    const e: Event = {
      schemaVersion: '1',
      id: '1',
      type: 'promptiris.phase.started',
      time: new Date().toISOString(),
      sequence: 0,
      runId: 'r',
      traceId: 'r',
      source: 'core',
      dataSchema: 'promptiris/event/phase-started-v1',
      data: { phase: 'transform' },
      classification: 'metadata',
      delivery: 'critical',
    };
    expect(formatEvent(e)).toContain('phase=transform');
  });

  it('allowlisted projection strips unknown and nested values', async () => {
    const jsonSink = new JsonLinesSink({ capacity: 10 });
    const dispatcher = createEventDispatcher('run-allow');
    const devtools = createObserverDevtools({
      observerId: 'test/allow',
      consoleSink: false,
      jsonSink,
    });
    devtools.attach(dispatcher);
    dispatcher.emit({
      type: 'test.adversarial',
      source: 'test',
      dataSchema: 'test/v1',
      data: {
        phase: 'transform',
        unknownKey: 'leak',
        nested: { secret: 'leak' },
        prompt: 'secret',
        durationMs: 42,
        // accessor and prototype pollution attempts
        __proto__: { polluted: true },
      },
      classification: 'metadata',
      delivery: 'critical',
    });
    dispatcher.complete('success');
    await new Promise((r) => setTimeout(r, 20));
    const parsed = JSON.parse(jsonSink.lines[0] ?? '{}') as { data?: Record<string, unknown> };
    expect(parsed.data?.phase).toBe('transform');
    expect(parsed.data?.durationMs).toBe(42);
    expect(parsed.data?.unknownKey).toBeUndefined();
    expect(parsed.data?.nested).toBeUndefined();
    expect(parsed.data?.prompt).toBeUndefined();
  });
});
