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

// ---------------------------------------------------------------------------
// Drain helper
// ---------------------------------------------------------------------------

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
// Model-based command tests
//
// The model mirrors the EventDispatcher's dispatch pipeline:
//   1. Critical overflow → detach observer, dispatch detached notification to survivors
//   2. Progress overflow + !dropReported → dispatch progress-dropped notification to survivors
//   3. Progress overflow + dropReported → silently accepted (no notification)
//   4. Complete → #prepareTerminal detaches lagging observers, dispatches detached notifications
//   5. Terminal event delivered to all surviving observers
// ---------------------------------------------------------------------------

interface ObserverState {
  capacity: number;
  subscription: EventSubscription;
  closed: boolean;
  /** User-event sequences actually delivered (excludes control notifications). */
  delivered: number[];
  buffered: number;
  waiting: boolean;
  /** Mirrors BufferedSubscription.#dropReported — prevents duplicate drop notifications per drain cycle. */
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
      if (obs.waiting) {
        obs.delivered.push(this.seq);
        obs.waiting = false;
      } else if (obs.buffered < obs.capacity) {
        obs.delivered.push(this.seq);
        obs.buffered += 1;
      } else {
        this.handleOverflow(id, obs, model, newlyDetached);
      }
    }

    notifySurvivors(newlyDetached.length, model.observers, -2);
  }

  private handleOverflow(
    id: string,
    obs: ObserverState,
    model: DispatcherModel,
    newlyDetached: string[],
  ): void {
    if (this.delivery === 'progress') {
      if (!obs.dropReported) {
        obs.dropReported = true;
        notifySurvivors(1, model.observers, -1, id);
      }
      return;
    }
    // Critical overflow → detach
    obs.closed = true;
    obs.buffered = 0;
    obs.delivered = [];
    newlyDetached.push(id);
  }

  toString(): string {
    return `emit(${String(this.seq)}, ${this.delivery})`;
  }
}

function notifySurvivors(
  count: number,
  observers: Map<string, ObserverState>,
  marker: number,
  excludedId?: string,
): void {
  if (count === 0) return;
  for (const [id, obs] of observers) {
    if (!obs.closed && id !== excludedId) {
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

    // #prepareTerminal detaches observers where canAcceptCritical() = false
    const lagging: string[] = [];
    for (const [id, obs] of model.observers) {
      if (obs.closed) continue;
      if (!obs.waiting && obs.buffered >= obs.capacity) {
        obs.closed = true;
        obs.buffered = 0;
        obs.delivered = [];
        lagging.push(id);
      }
    }

    // Each lagging observer's detach notification goes to surviving observers
    notifySurvivors(lagging.length, model.observers, -2);

    // Terminal event goes to all surviving observers (no exclusion)
    let survivorCount = 0;
    for (const [, obs] of model.observers) {
      if (!obs.closed) survivorCount += 1;
    }
    notifySurvivors(survivorCount, model.observers, -3);

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
    if (prev !== undefined && curr !== undefined) {
      expect(curr.sequence).toBeGreaterThanOrEqual(prev.sequence);
    }
  }
}

function assertTerminalLast(events: Event[]): void {
  const termIdx = events.findIndex((ev) => ev.type === 'promptiris.run.completed');
  if (termIdx !== -1) {
    expect(termIdx).toBe(events.length - 1);
  }
}

async function verifyObserverInvariants(obs: ObserverState, completed: boolean): Promise<void> {
  const received = await drainEvents(obs.subscription);
  assertMonotonicUserSequences(received);
  assertTerminalLast(received);

  // For non-detached observers that saw completion, the user-event count
  // must match what the model predicts (control markers are not user events).
  if (!obs.closed && completed) {
    const userEvents = received.filter((ev) => ev.type.startsWith('test.'));
    const expectedUserCount = obs.delivered.filter((seq) => seq >= 0).length;
    expect(userEvents.length).toBe(expectedUserCount);
  }
}

function verifyGlobalInvariants(sink: Event[], model: DispatcherModel): void {
  // Terminal event appears exactly once if completed.
  // Note: terminal may NOT be the last sink event — if an observer's buffer is
  // full when the terminal is enqueued, it gets detached and a detached
  // notification is dispatched after the terminal.
  const terminalCount = sink.filter((ev) => ev.type === 'promptiris.run.completed').length;
  if (model.completed) {
    expect(terminalCount).toBe(1);
  } else {
    expect(terminalCount).toBe(0);
  }

  // Sink must contain at least the user events we emitted
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

          // Only drain observers that are closed (detached/disposed) or that saw completion.
          // Open subscriptions with no completion would block on next() forever.
          for (const [, obs] of model.observers) {
            if (!obs.closed && !model.completed) continue;
            await verifyObserverInvariants(obs, model.completed);
          }
        },
      ),
      { numRuns: 200, seed: 0x9a3f_2026 },
    );
  });

  it('Promise resolution order does not break observer invariants', async () => {
    // Verify that the dispatch loop and subscription draining produce correct
    // invariants regardless of microtask interleaving. We emit synchronously,
    // then drain — this exercises the synchronous dispatch + async drain path.
    const sink: Event[] = [];
    const dispatcher = createEventDispatcher('run-scheduler', (event) => sink.push(event));

    const subA = dispatcher.subscribe({ observerId: 'A', capacity: 8 });
    const subB = dispatcher.subscribe({ observerId: 'B', capacity: 8 });

    // Emit 3 critical events synchronously — all are buffered by both observers
    dispatcher.emit(criticalEvent(0));
    dispatcher.emit(criticalEvent(1));
    dispatcher.emit(criticalEvent(2));

    // Complete — dispatches terminal event
    dispatcher.complete('success');

    // Drain both observers concurrently via Promise.all — this is the actual
    // concurrency point: two async drains racing on different subscriptions
    const [eventsA, eventsB] = await Promise.all([drainEvents(subA), drainEvents(subB)]);

    // Both observers must see user events in monotonic sequence order
    assertMonotonicUserSequences(eventsA);
    assertMonotonicUserSequences(eventsB);
    assertTerminalLast(eventsA);
    assertTerminalLast(eventsB);

    // Sink must have terminal event
    const terminalCount = sink.filter((ev) => ev.type === 'promptiris.run.completed').length;
    expect(terminalCount).toBe(1);
  });

  it('lagging observer is detached while healthy observer sees all events including detach', async () => {
    // Deterministic scenario: verify the detach-on-overflow path.
    //
    // 1. lagging (cap=1) and healthy (cap=64) subscribe
    // 2. emit(progress-0): both buffer it (lagging full at 1/1)
    // 3. emit(progress-1): lagging overflows → progress-dropped notification to healthy
    // 4. emit(progress-2): lagging overflows but dropReported=true → silently accepted
    // 5. complete(): #prepareTerminal detaches lagging (full + no waiter) → #close(true) clears queue
    // 6. healthy sees: progress-0, progress-1, progress-dropped, progress-2, detached, terminal
    // 7. lagging sees: [] (queue cleared by detach)
    await fc.assert(
      fc.asyncProperty(fc.constant({}), async () => {
        const sink: Event[] = [];
        const dispatcher = createEventDispatcher('run-detach', (event) => sink.push(event));

        const lagging = dispatcher.subscribe({ observerId: 'lagging', capacity: 1 });
        const healthy = dispatcher.subscribe({ observerId: 'healthy', capacity: 64 });

        dispatcher.emit(progressEvent(0));
        dispatcher.emit(progressEvent(1));
        dispatcher.emit(progressEvent(2));
        dispatcher.complete('success');

        // Drain healthy
        const healthyEvents = await drainEvents(healthy);

        // Drain lagging
        const laggingEvents = await drainEvents(lagging);

        // Healthy sees user events in monotonic order, terminal last
        assertMonotonicUserSequences(healthyEvents);
        assertTerminalLast(healthyEvents);

        // Healthy observer must see the detach notification for lagging
        const detachEvent = healthyEvents.find(
          (ev) =>
            ev.type === 'promptiris.observer.detached' &&
            (ev.data as { observerId: string }).observerId === 'lagging',
        );
        expect(detachEvent).toBeDefined();

        // Terminal must be last for healthy
        const hTermIdx = healthyEvents.findIndex((ev) => ev.type === 'promptiris.run.completed');
        expect(hTermIdx).toBe(healthyEvents.length - 1);

        // Lagging was detached during #prepareTerminal — queue cleared by #close(true)
        expect(laggingEvents.length).toBe(0);

        // Healthy saw strictly more events than lagging
        expect(healthyEvents.length).toBeGreaterThan(laggingEvents.length);

        // Sink also contains the detach and terminal events
        const sinkDetach = sink.find(
          (ev) =>
            ev.type === 'promptiris.observer.detached' &&
            (ev.data as { observerId: string }).observerId === 'lagging',
        );
        expect(sinkDetach).toBeDefined();
        expect(sink.at(-1)?.type).toBe('promptiris.run.completed');
      }),
      { numRuns: 100, seed: 0x7c2d_2026 },
    );
  });
});
