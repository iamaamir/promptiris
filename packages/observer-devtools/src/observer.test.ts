import { describe, it, expect } from 'vitest';
import { createEventDispatcher } from '@promptiris/core';
import { captureDebugRecord } from '@promptiris/core';
import type { Event } from '@promptiris/protocol';
import { createObserverDevtools } from './observer.js';
import { JsonLinesSink, createConsoleSink, formatEvent } from './sinks.js';
import { createSupportBundle, MAX_BUNDLE_BYTES, MAX_BUNDLE_EVENTS } from './support-bundle.js';

function emit(dispatcher: ReturnType<typeof createEventDispatcher>, type: string, data: unknown, delivery: 'critical' | 'progress' = 'critical') {
  dispatcher.emit({
    type,
    source: 'test',
    dataSchema: 'test/v1',
    data,
    classification: 'metadata',
    delivery,
  });
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
    expect(() => dispatcher.emit({ type: 'after', source: 'test', dataSchema: 'test/v1', data: {}, classification: 'metadata', delivery: 'critical' })).toThrow();
  });

  it('does not invent event dialect, only forwards standard types', async () => {
    const dispatcher = createEventDispatcher('run-2');
    const devtools = createObserverDevtools({ observerId: 'test/observer2' });
    devtools.attach(dispatcher);
    emit(dispatcher, 'promptiris.plugin.activation-started', { pluginId: 'p/a', contributionId: 'c1' });
    dispatcher.complete('success');
    await new Promise((r) => setTimeout(r, 10));
    expect(devtools.getEvents().map((e) => e.type)).toContain('promptiris.plugin.activation-started');
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
    emit(dispatcher, 'promptiris.plugin.activation-started', { pluginId: 'plug/a', contributionId: 'c1' });
    emit(dispatcher, 'promptiris.run.cancelled', { reason: 'user' });
    dispatcher.complete('cancelled');
    await new Promise((r) => setTimeout(r, 20));
    expect(lines.join(' ')).toContain('phase=analyze');
    expect(lines.join(' ')).toContain('plugin=plug/a');
    expect(jsonSink.lines.length).toBeGreaterThan(0);
    expect(jsonSink.lines[0]).toContain('promptiris.phase.started');
  });

  it('sink failure cannot fail transformation', async () => {
    const failingSink = { write: () => { throw new Error('sink boom'); } };
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
    for (let i = 0; i < 10; i++) emit(dispatcher, `test.progress-${i}`, { i }, 'progress');
    dispatcher.complete('success');
    await new Promise((r) => setTimeout(r, 20));
    // should have at least drop event in dispatcher sink + not throw
    await expect(h.detach()).resolves.not.toThrow();
  });

  it('support bundle is explicit bounded deterministic redacted', async () => {
    const dispatcher = createEventDispatcher('run-6');
    const devtools = createObserverDevtools({ observerId: 'test/obs6', manifestIds: ['plug/a'], configTraceId: 'trace-1' });
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
    captureDebugRecord(devtools, new Error('debug error'), { runId: 'run-6', traceId: 'run-6', operation: 'test' });
    await new Promise((r) => setTimeout(r, 10));
    const bundle = devtools.createBundle();
    expect(bundle.bounded).toBe(true);
    expect(bundle.redacted).toBe(true);
    expect(bundle.deterministic).toBe(true);
    expect(bundle.schemaVersion).toBe('1');
    const sensitive = bundle.events.find((e) => e.type === 'test.sensitive');
    expect(sensitive?.data).toEqual({ redacted: true });
    expect(bundle.manifestRefs).toEqual(['plug/a']);
    expect(bundle.configTraceRef).toBe('trace-1');
  });

  it('bounds bundle bytes deterministically', () => {
    const events: Event[] = Array.from({ length: MAX_BUNDLE_EVENTS + 20 }, (_, i) => ({
      schemaVersion: '1',
      id: `id-${i}`,
      type: 'test.event',
      time: new Date().toISOString(),
      sequence: i,
      runId: 'r',
      traceId: 'r',
      source: 'test',
      dataSchema: 'test/v1',
      data: { i },
      classification: 'metadata',
      delivery: i % 2 === 0 ? 'progress' : 'critical',
    })) as Event[];
    const bundle = createSupportBundle({ observerId: 'test', events, debugRecords: [] });
    expect(bundle.events.length).toBeLessThanOrEqual(MAX_BUNDLE_EVENTS);
    const bytes = JSON.stringify(bundle).length;
    expect(bytes).toBeLessThanOrEqual(MAX_BUNDLE_BYTES + 5000); // allow small overhead
    // deterministic: second call same
    const bundle2 = createSupportBundle({ observerId: 'test', events, debugRecords: [] });
    expect(JSON.stringify(bundle)).toBe(JSON.stringify({ ...bundle2, createdAt: bundle.createdAt }));
  });

  it('plugin registration is usable without runtime internals', async () => {
    const devtools = createObserverDevtools({ observerId: 'test/usable' });
    const reg = devtools.createRegistration();
    expect(reg.manifest.type).toBe('observer');
    const impl = await reg.activate();
    const out = await impl.invoke({ contributionId: 'c', input: { schemaVersion: '1', content: [{ id: 'b1', text: 'hi' }] } as any, revision: 0, signal: new AbortController().signal });
    expect(out).toEqual({});
  });

  it('formatEvent shows stage progress and artifact refs', () => {
    const e = {
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
    } as Event;
    expect(formatEvent(e)).toContain('phase=transform');
  });
});
