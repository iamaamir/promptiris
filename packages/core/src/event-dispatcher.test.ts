import { describe, expect, it } from 'vitest';
import type { Event } from '@promptiris/protocol';
import { createEventDispatcher } from './event-dispatcher.js';
import type { EventSubscription } from './event-dispatcher.js';

const event = (delivery: 'critical' | 'progress', value: number) => ({
  type: `example.event-${String(value)}`,
  source: 'test',
  dataSchema: 'example/event-v1',
  data: { value },
  classification: 'metadata' as const,
  delivery,
});

async function nextEvent(subscription: EventSubscription): Promise<Event> {
  const result = await subscription.next();
  if (result.done) throw new Error('Expected an Event before stream completion');
  return result.value;
}

describe('Event dispatcher', () => {
  it('stamps one ordered envelope for the sink and every subscriber', async () => {
    const sink: Event[] = [];
    const dispatcher = createEventDispatcher('run-events', (value) => sink.push(value));
    await using subscriber = dispatcher.subscribe({ observerId: 'observer-a' });

    dispatcher.emit(event('critical', 1));
    const received = await nextEvent(subscriber);

    expect(received).toEqual(sink[0]);
    expect(sink[0]).toMatchObject({ runId: 'run-events', traceId: 'run-events', sequence: 0 });
  });

  it('settles a pending iterator read directly from publication', async () => {
    const dispatcher = createEventDispatcher('run-pending');
    await using subscription = dispatcher.subscribe({ observerId: 'observer-a' });
    const pending = subscription.next();

    dispatcher.emit(event('critical', 1));

    await expect(pending).resolves.toMatchObject({
      done: false,
      value: { type: 'example.event-1', sequence: 0 },
    });
  });

  it('isolates a throwing sink through terminal completion', async () => {
    const dispatcher = createEventDispatcher('run-throwing-sink', () => {
      throw new Error('observer failure');
    });
    const subscription = dispatcher.subscribe({ observerId: 'observer-a' });

    dispatcher.emit(event('critical', 1));
    dispatcher.complete('success');

    expect((await nextEvent(subscription)).type).toBe('example.event-1');
    expect((await nextEvent(subscription)).type).toBe('promptiris.run.completed');
    expect(await subscription.next()).toEqual({ done: true, value: undefined });
    expect(() => dispatcher.emit(event('critical', 2))).toThrow(/complete/i);
  });

  it('queues reentrant publication and keeps the terminal Event final', async () => {
    const sink: Event[] = [];
    const dispatcher = createEventDispatcher('run-reentrant', (value) => {
      sink.push(value);
      if (value.type === 'example.event-1') {
        dispatcher.emit(event('critical', 2));
        dispatcher.complete('success');
      }
    });
    const subscription = dispatcher.subscribe({ observerId: 'observer-a', capacity: 4 });

    dispatcher.emit(event('critical', 1));

    expect((await nextEvent(subscription)).type).toBe('example.event-1');
    expect((await nextEvent(subscription)).type).toBe('example.event-2');
    expect((await nextEvent(subscription)).type).toBe('promptiris.run.completed');
    expect(await subscription.next()).toEqual({ done: true, value: undefined });
    expect(sink.map(({ type }) => type)).toEqual([
      'example.event-1',
      'example.event-2',
      'promptiris.run.completed',
    ]);
  });

  it('drops progress once for a lagging observer without blocking healthy observers', async () => {
    const sink: Event[] = [];
    const dispatcher = createEventDispatcher('run-drop', (value) => sink.push(value));
    await using lagging = dispatcher.subscribe({ observerId: 'lagging', capacity: 1 });
    await using healthy = dispatcher.subscribe({ observerId: 'healthy', capacity: 8 });

    dispatcher.emit(event('progress', 1));
    dispatcher.emit(event('progress', 2));
    dispatcher.emit(event('progress', 3));

    const healthyEvents = [
      await nextEvent(healthy),
      await nextEvent(healthy),
      await nextEvent(healthy),
    ];
    expect(healthyEvents.map(({ type }) => type)).toEqual([
      'example.event-1',
      'example.event-2',
      'promptiris.observer.progress-dropped',
    ]);
    expect(sink.filter(({ type }) => type === 'promptiris.observer.progress-dropped')).toHaveLength(
      1,
    );
    expect(sink.find(({ type }) => type === 'promptiris.observer.progress-dropped')).toMatchObject({
      source: 'core',
      dataSchema: 'promptiris/event/observer-progress-dropped-v1',
      data: { observerId: 'lagging' },
      classification: 'metadata',
      delivery: 'critical',
    });
    expect((await nextEvent(lagging)).type).toBe('example.event-1');
  });

  it('reports a new progress-drop period after the lagging queue drains', async () => {
    const sink: Event[] = [];
    const dispatcher = createEventDispatcher('run-drop-periods', (value) => sink.push(value));
    await using lagging = dispatcher.subscribe({ observerId: 'lagging', capacity: 1 });

    dispatcher.emit(event('progress', 1));
    dispatcher.emit(event('progress', 2));
    expect((await nextEvent(lagging)).type).toBe('example.event-1');
    dispatcher.emit(event('progress', 3));
    dispatcher.emit(event('progress', 4));

    expect(sink.filter(({ type }) => type === 'promptiris.observer.progress-dropped')).toHaveLength(
      2,
    );
  });

  it('detaches a lagging observer when a critical event cannot be queued', async () => {
    const dispatcher = createEventDispatcher('run-detach');
    const lagging = dispatcher.subscribe({ observerId: 'lagging', capacity: 1 });
    await using healthy = dispatcher.subscribe({ observerId: 'healthy', capacity: 8 });

    dispatcher.emit(event('progress', 1));
    dispatcher.emit(event('critical', 2));

    expect((await nextEvent(healthy)).type).toBe('example.event-1');
    expect((await nextEvent(healthy)).type).toBe('example.event-2');
    expect(await nextEvent(healthy)).toMatchObject({
      type: 'promptiris.observer.detached',
      source: 'core',
      dataSchema: 'promptiris/event/observer-detached-v1',
      data: { observerId: 'lagging' },
      classification: 'metadata',
      delivery: 'critical',
    });
    expect(await lagging.next()).toEqual({ done: true, value: undefined });
  });

  it('completes pending readers and rejects invalid subscription ownership', async () => {
    const dispatcher = createEventDispatcher('run-complete');
    const subscription = dispatcher.subscribe({ observerId: 'observer-a' });
    expect(() => dispatcher.subscribe({ observerId: 'observer-a' })).toThrow(/duplicate/i);
    const pending = subscription.next();

    dispatcher.complete('success');
    dispatcher.complete('failed');

    const terminal = await pending;
    expect(terminal.done).toBe(false);
    if (terminal.done) throw new Error('Expected the terminal Run Event');
    expect(terminal.value.type).toBe('promptiris.run.completed');
    expect(terminal.value).toMatchObject({
      source: 'core',
      dataSchema: 'promptiris/event/run-completed-v1',
      data: { status: 'success' },
      classification: 'metadata',
      delivery: 'critical',
    });
    await expect(subscription.next()).resolves.toEqual({ done: true, value: undefined });
    expect(() => dispatcher.emit(event('critical', 1))).toThrow(/complete/i);
    expect(() => dispatcher.subscribe({ observerId: 'late' })).toThrow(/complete/i);
  });

  it('drains already accepted events before a completed stream terminates', async () => {
    const dispatcher = createEventDispatcher('run-drain');
    const subscription = dispatcher.subscribe({ observerId: 'observer-a' });
    dispatcher.emit(event('critical', 1));

    dispatcher.complete('success');

    expect((await nextEvent(subscription)).type).toBe('example.event-1');
    expect((await nextEvent(subscription)).type).toBe('promptiris.run.completed');
    expect(await subscription.next()).toEqual({ done: true, value: undefined });
  });

  it('detaches lagging observers before publishing the final terminal Event', async () => {
    const sink: Event[] = [];
    const dispatcher = createEventDispatcher('run-terminal', (value) => sink.push(value));
    const lagging = dispatcher.subscribe({ observerId: 'lagging', capacity: 1 });
    dispatcher.emit(event('progress', 1));

    dispatcher.complete('cancelled');

    expect(sink.slice(-2).map(({ type }) => type)).toEqual([
      'promptiris.observer.detached',
      'promptiris.run.completed',
    ]);
    expect(await lagging.next()).toEqual({ done: true, value: undefined });
  });

  it('detaches every lagging observer before one final terminal Event', () => {
    const sink: Event[] = [];
    const dispatcher = createEventDispatcher('run-many-lagging', (value) => sink.push(value));
    dispatcher.subscribe({ observerId: 'lagging-a', capacity: 1 });
    dispatcher.subscribe({ observerId: 'lagging-b', capacity: 1 });
    dispatcher.emit(event('progress', 1));

    dispatcher.complete('failed');

    expect(sink.slice(-3)).toMatchObject([
      {
        type: 'promptiris.observer.detached',
        source: 'core',
        dataSchema: 'promptiris/event/observer-detached-v1',
        data: { observerId: 'lagging-a' },
      },
      {
        type: 'promptiris.observer.detached',
        source: 'core',
        dataSchema: 'promptiris/event/observer-detached-v1',
        data: { observerId: 'lagging-b' },
      },
      {
        type: 'promptiris.run.completed',
        data: { status: 'failed' },
      },
    ]);
  });

  it('removes an early-returning subscriber and rejects concurrent reads', async () => {
    const dispatcher = createEventDispatcher('run-return');
    const subscription = dispatcher.subscribe({ observerId: 'observer-a' });
    const pending = subscription.next();

    await expect(subscription.next()).rejects.toThrow(
      'Concurrent Event subscription reads are not supported',
    );
    await expect(subscription.return()).resolves.toEqual({ done: true, value: undefined });
    await expect(pending).resolves.toEqual({ done: true, value: undefined });
    dispatcher.emit(event('critical', 1));
  });

  it('uses async disposal to remove the observer without a later detach notice', async () => {
    const sink: Event[] = [];
    const dispatcher = createEventDispatcher('run-dispose', (value) => sink.push(value));
    const subscription = dispatcher.subscribe({ observerId: 'observer-a' });

    await subscription[Symbol.asyncDispose]();
    dispatcher.emit(event('critical', 1));

    expect(sink.map(({ type }) => type)).toEqual(['example.event-1']);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid capacity %s', (capacity) => {
    const dispatcher = createEventDispatcher('run-capacity');
    expect(() => dispatcher.subscribe({ observerId: 'observer', capacity })).toThrow(
      new RangeError('Event subscription capacity must be a positive safe integer'),
    );
  });
});
