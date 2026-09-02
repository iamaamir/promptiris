import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Event } from '@promptiris/protocol';
import { createEventDispatcher } from './event-dispatcher.js';
import type { EventDispatcher, EventSubscription } from './event-dispatcher.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function criticalEvent(seq: number): Parameters<EventDispatcher['emit']>[0] {
  return {
    type: `test.event-${String(seq)}`,
    source: 'concurrency-test',
    dataSchema: 'test/event-v1',
    data: { seq },
    classification: 'metadata',
    delivery: 'critical',
  };
}

function progressEvent(seq: number): Parameters<EventDispatcher['emit']>[0] {
  return {
    type: `test.progress-${String(seq)}`,
    source: 'concurrency-test',
    dataSchema: 'test/event-v1',
    data: { seq },
    classification: 'metadata',
    delivery: 'progress',
  };
}

async function drainEvents(sub: EventSubscription): Promise<Event[]> {
  const events: Event[] = [];
  for (;;) {
    const result = await sub.next();
    if (result.done) break;
    events.push(result.value);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Model — mirrors the EventDispatcher dispatch pipeline
//
//   Critical overflow → detach + detached notification to survivors
//   Progress overflow + !dropReported → progress-dropped notification to survivors
//   Progress overflow + dropReported → silently accepted
//   Complete → #prepareTerminal detaches lagging, dispatches notifications
//   Terminal event delivered to all surviving observers
//   Consume → shifts one event from the observer's buffer
// ---------------------------------------------------------------------------

interface ObserverState {
  capacity: number;
  subscription: EventSubscription;
  closed: boolean;
  /** User-event sequences that entered the buffer (excludes control notifications). */
  delivered: number[];
  buffered: number;
  waiting: boolean;
  dropReported: boolean;
}

interface DispatcherModel {
  observers: Map<string, ObserverState>;
  completed: boolean;
  emittedCount: number;
}

class SubscribeCommand implements fc.Command<DispatcherModel, EventDispatcher> {
  constructor(
    private readonly id: string,
    private readonly capacity: number,
  ) {}

  check(model: Readonly<DispatcherModel>): boolean {
    return !model.completed && !model.observers.has(this.id);
  }

  run(model: DispatcherModel, real: EventDispatcher): void {
    const subscription = real.subscribe({ observerId: this.id, capacity: this.capacity });
    model.observers.set(this.id, {
      capacity: this.capacity,
      subscription,
      closed: false,
      delivered: [],
      buffered: 0,
      waiting: false,
      dropReported: false,
    });
  }

  toString(): string {
    return `subscribe(${this.id}, cap=${String(this.capacity)})`;
  }
}

class EmitCommand implements fc.Command<DispatcherModel, EventDispatcher> {
  constructor(
    private readonly seq: number,
    private readonly delivery: 'critical' | 'progress',
  ) {}

  check(model: Readonly<DispatcherModel>): boolean {
    return !model.completed;
  }

  run(model: DispatcherModel, real: EventDispatcher): void {
    const event = this.delivery === 'critical' ? criticalEvent(this.seq) : progressEvent(this.seq);
    real.emit(event);
    model.emittedCount += 1;

    const newlyDetached: string[] = [];

    for (const [id, obs] of model.observers) {
      if (obs.closed) continue;
      deliverToObserver(this.delivery, this.seq, id, obs, model.observers, newlyDetached);
    }

    notifySurvivors(model.observers, -2, undefined, newlyDetached);
  }

  toString(): string {
    return `emit(${String(this.seq)}, ${this.delivery})`;
  }
}

function deliverToObserver(
  delivery: 'critical' | 'progress',
  seq: number,
  id: string,
  obs: ObserverState,
  observers: Map<string, ObserverState>,
  newlyDetached: string[],
): void {
  if (obs.waiting) {
    obs.delivered.push(seq);
    obs.waiting = false;
    return;
  }
  if (obs.buffered < obs.capacity) {
    obs.delivered.push(seq);
    obs.buffered += 1;
    return;
  }
  // Buffer full — handle overflow
  if (delivery === 'progress') {
    if (!obs.dropReported) {
      obs.dropReported = true;
      notifySurvivors(observers, -1, id);
    }
    return;
  }
  // Critical overflow → detach
  obs.closed = true;
  obs.buffered = 0;
  obs.delivered = [];
  newlyDetached.push(id);
}

function notifySurvivors(
  observers: Map<string, ObserverState>,
  marker: number,
  excludedId?: string,
  newlyDetached?: string[],
): void {
  const targets =
    newlyDetached !== undefined && newlyDetached.length > 0
      ? newlyDetached
      : [undefined as string | undefined];
  for (const detId of targets) {
    const exclude = detId ?? excludedId;
    for (const [id, obs] of observers) {
      if (!obs.closed && id !== exclude) {
        obs.delivered.push(marker);
      }
    }
  }
}

function detachLagging(observers: Map<string, ObserverState>): string[] {
  const lagging: string[] = [];
  for (const [id, obs] of observers) {
    if (obs.closed) continue;
    if (!obs.waiting && obs.buffered >= obs.capacity) {
      obs.closed = true;
      obs.buffered = 0;
      obs.delivered = [];
      lagging.push(id);
    }
  }
  return lagging;
}

function notifyAll(
  observers: Map<string, ObserverState>,
  marker: number,
  excludeIds?: string[],
): void {
  for (const [id, obs] of observers) {
    if (!obs.closed && excludeIds?.includes(id) !== true) {
      obs.delivered.push(marker);
    }
  }
}

class CompleteCommand implements fc.Command<DispatcherModel, EventDispatcher> {
  check(model: Readonly<DispatcherModel>): boolean {
    return !model.completed;
  }

  run(model: DispatcherModel, real: EventDispatcher): void {
    model.completed = true;
    const lagging = detachLagging(model.observers);
    notifyAll(model.observers, -2, lagging);
    notifyAll(model.observers, -3);
    real.complete('success');
  }

  toString(): string {
    return 'complete(success)';
  }
}

class DisposeCommand implements fc.Command<DispatcherModel, EventDispatcher> {
  constructor(private readonly observerId: string) {}

  check(model: Readonly<DispatcherModel>): boolean {
    const obs = model.observers.get(this.observerId);
    return obs !== undefined && !obs.closed;
  }

  run(model: DispatcherModel, real: EventDispatcher): void {
    const obs = model.observers.get(this.observerId);
    if (obs === undefined) return;
    obs.closed = true;
    obs.buffered = 0;
    obs.delivered = [];

    void real;
    void obs.subscription.return();
  }

  toString(): string {
    return `dispose(${this.observerId})`;
  }
}

// ---------------------------------------------------------------------------
// Invariant helpers
// ---------------------------------------------------------------------------

function assertMonotonicUserSequences(events: Event[]): void {
  const userEvents = events.filter((ev) => ev.type.startsWith('test.'));
  for (let i = 1; i < userEvents.length; i++) {
    const prev = userEvents[i - 1];
    const curr = userEvents[i];
    expect(curr?.sequence).toBeGreaterThanOrEqual(prev?.sequence);
  }
}

function assertTerminalLast(events: Event[]): void {
  const termIdx = events.findIndex((ev) => ev.type === 'promptiris.run.completed');
  if (termIdx !== -1) {
    expect(termIdx).toBe(events.length - 1);
  }
}

async function verifyObserverInvariants(obs: ObserverState): Promise<void> {
  const received = await drainEvents(obs.subscription);
  assertMonotonicUserSequences(received);
  assertTerminalLast(received);
}

function verifyGlobalInvariants(sink: Event[], model: DispatcherModel): void {
  const terminalCount = sink.filter((ev) => ev.type === 'promptiris.run.completed').length;
  if (model.completed) {
    expect(terminalCount).toBe(1);
  } else {
    expect(terminalCount).toBe(0);
  }
  expect(sink.length).toBeGreaterThanOrEqual(model.emittedCount);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EventDispatcher concurrency', () => {
  it('maintains invariants across all generated command sequences', async () => {
    const ids = ['alpha', 'beta', 'gamma'];
    const caps = [1, 4, 8, 16, 64];
    const deliveries = ['critical', 'progress'] as const;

    await fc.assert(
      fc.asyncProperty(
        fc.commands(
          [
            fc
              .tuple(fc.constantFrom(...ids), fc.constantFrom(...caps))
              .map(([id, cap]) => new SubscribeCommand(id, cap)),
            fc
              .tuple(fc.integer({ min: 0, max: 20 }), fc.constantFrom(...deliveries))
              .map(([seq, delivery]) => new EmitCommand(seq, delivery)),
            fc.constant(new CompleteCommand()),
            fc.tuple(fc.constantFrom(...ids)).map(([id]) => new DisposeCommand(id)),
          ],
          { maxCommands: 40 },
        ),
        async (cmds) => {
          const sink: Event[] = [];
          const dispatcher = createEventDispatcher('run-model', (event) => sink.push(event));
          const model: DispatcherModel = {
            observers: new Map(),
            completed: false,
            emittedCount: 0,
          };

          fc.modelRun(() => ({ model, real: dispatcher }), cmds);

          verifyGlobalInvariants(sink, model);

          for (const [, obs] of model.observers) {
            if (!obs.closed && !model.completed) continue;
            await verifyObserverInvariants(obs);
          }
        },
      ),
      { numRuns: 200, seed: 0x9a3f_2026 },
    );
  });

  it('fc.scheduler controls Promise resolution across concurrent observers', async () => {
    // Schedule reads via fc.scheduler so it controls which observer's
    // next() call resolves first. Each read blocks until the scheduler
    // picks it. This verifies that the subscription API produces correct
    // results regardless of Promise resolution order.
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), async (scheduler) => {
        const sink: Event[] = [];
        const dispatcher = createEventDispatcher('run-scheduler', (event) => sink.push(event));

        const subA = dispatcher.subscribe({ observerId: 'A', capacity: 8 });
        const subB = dispatcher.subscribe({ observerId: 'B', capacity: 8 });

        // Emit 3 critical events synchronously — buffered by both observers
        dispatcher.emit(criticalEvent(0));
        dispatcher.emit(criticalEvent(1));
        dispatcher.emit(criticalEvent(2));
        dispatcher.complete('success');

        // Schedule reads — the scheduler picks the interleaving order.
        // Since the buffer is pre-filled, next() resolves via microtask;
        // the scheduler still controls which microtask fires first.
        const readA = scheduler.scheduleFunction(() => subA.next());
        const readB = scheduler.scheduleFunction(() => subB.next());

        const rA0 = readA();
        const rB0 = readB();
        const rA1 = readA();
        const rB1 = readB();
        const rA2 = readA();
        const rB2 = readB();
        const rATerm = readA();
        const rBTerm = readB();

        await scheduler.waitIdle();

        const resultsA = await Promise.all([rA0, rA1, rA2, rATerm]);
        const resultsB = await Promise.all([rB0, rB1, rB2, rBTerm]);

        // Each observer must see exactly 3 user events + terminal
        const eventsA = resultsA.filter((r) => !r.done).map((r) => r.value);
        const eventsB = resultsB.filter((r) => !r.done).map((r) => r.value);
        expect(eventsA.length).toBe(4);
        expect(eventsB.length).toBe(4);

        // User events must be in monotonic sequence order
        assertMonotonicUserSequences(eventsA);
        assertMonotonicUserSequences(eventsB);
        assertTerminalLast(eventsA);
        assertTerminalLast(eventsB);

        // Sink must have terminal event
        const terminalCount = sink.filter((ev) => ev.type === 'promptiris.run.completed').length;
        expect(terminalCount).toBe(1);
      }),
      { numRuns: 200, seed: 0x1b4e_2026 },
    );
  });

  it('lagging observer is detached while healthy observer sees all events including detach', async () => {
    // 1. lagging (cap=1) and healthy (cap=64)
    // 2. emit(progress-0): both buffer (lagging full at 1/1)
    // 3. emit(progress-1): lagging overflows → progress-dropped to healthy
    // 4. emit(progress-2): dropReported=true → silently accepted
    // 5. complete(): #prepareTerminal detaches lagging (full + no waiter)
    // 6. healthy: progress-0, progress-1, progress-dropped, progress-2, detached, terminal
    // 7. lagging: [] (queue cleared by detach)
    const sink: Event[] = [];
    const dispatcher = createEventDispatcher('run-detach', (event) => sink.push(event));

    const lagging = dispatcher.subscribe({ observerId: 'lagging', capacity: 1 });
    const healthy = dispatcher.subscribe({ observerId: 'healthy', capacity: 64 });

    dispatcher.emit(progressEvent(0));
    dispatcher.emit(progressEvent(1));
    dispatcher.emit(progressEvent(2));
    dispatcher.complete('success');

    const healthyEvents = await drainEvents(healthy);
    const laggingEvents = await drainEvents(lagging);

    assertMonotonicUserSequences(healthyEvents);
    assertTerminalLast(healthyEvents);

    const detachEvent = healthyEvents.find(
      (ev) =>
        ev.type === 'promptiris.observer.detached' &&
        (ev.data as { observerId: string }).observerId === 'lagging',
    );
    expect(detachEvent).toBeDefined();

    const hTermIdx = healthyEvents.findIndex((ev) => ev.type === 'promptiris.run.completed');
    expect(hTermIdx).toBe(healthyEvents.length - 1);

    expect(laggingEvents.length).toBe(0);
    expect(healthyEvents.length).toBeGreaterThan(laggingEvents.length);

    const sinkDetach = sink.find(
      (ev) =>
        ev.type === 'promptiris.observer.detached' &&
        (ev.data as { observerId: string }).observerId === 'lagging',
    );
    expect(sinkDetach).toBeDefined();
    expect(sink.at(-1)?.type).toBe('promptiris.run.completed');
  });
});
