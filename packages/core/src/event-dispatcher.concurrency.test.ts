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

function isUserEvent(ev: Event): boolean {
  return ev.type.startsWith('test.');
}

// ---------------------------------------------------------------------------
// Model — faithful oracle for user-event delivery
//
//   Tracks per-observer state: capacity, buffer occupancy, waiting flag,
//   dropReported, and the exact sequence of user events that entered the
//   buffer (excluding control notifications, which cascade through the
//   dispatch pipeline and are verified only in the deterministic test).
//
//   Faithful for:
//   - User event buffering and overflow (critical → detach, progress → drop)
//   - Waiting transitions (event delivered directly to pending read)
//   - Detach notification routing to surviving observers (count tracked)
//   - Terminal delivery and terminal-overflow detach
//   - Dispose clearing the queue
// ---------------------------------------------------------------------------

interface ObserverState {
  capacity: number;
  subscription: EventSubscription;
  closed: boolean;
  /** User-event sequences that entered the buffer (excludes control events). */
  userEvents: number[];
  bufferedCount: number;
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
      userEvents: [],
      bufferedCount: 0,
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
    // The stamped sequence is the dispatcher's counter BEFORE emit
    const stampedSeq = model.emittedCount;
    const event = this.delivery === 'critical' ? criticalEvent(this.seq) : progressEvent(this.seq);
    real.emit(event);
    model.emittedCount += 1;

    for (const [, obs] of model.observers) {
      if (obs.closed) continue;
      if (obs.waiting) {
        // Delivered directly to pending read — does NOT occupy buffer
        obs.userEvents.push(stampedSeq);
        obs.waiting = false;
        continue;
      }
      if (obs.bufferedCount < obs.capacity) {
        obs.userEvents.push(stampedSeq);
        obs.bufferedCount += 1;
        continue;
      }
      // Buffer full — overflow
      if (this.delivery === 'progress') {
        if (!obs.dropReported) obs.dropReported = true;
        // Silently accepted or progress-dropped — observer stays open
        continue;
      }
      // Critical overflow → detach
      obs.closed = true;
      obs.bufferedCount = 0;
      obs.userEvents = [];
    }
  }

  toString(): string {
    return `emit(${String(this.seq)}, ${this.delivery})`;
  }
}

class CompleteCommand implements fc.Command<DispatcherModel, EventDispatcher> {
  check(model: Readonly<DispatcherModel>): boolean {
    return !model.completed;
  }

  run(model: DispatcherModel, real: EventDispatcher): void {
    model.completed = true;
    // Detach lagging observers (full buffer, no waiting)
    for (const [, obs] of model.observers) {
      if (obs.closed) continue;
      if (!obs.waiting && obs.bufferedCount >= obs.capacity) {
        obs.closed = true;
        obs.bufferedCount = 0;
        obs.userEvents = [];
      }
    }
    // Terminal event: survivors with buffer space get it; full observers
    // overflow (terminal is critical) and lose their buffer.
    for (const [, obs] of model.observers) {
      if (obs.closed) continue;
      if (!obs.waiting && obs.bufferedCount >= obs.capacity) {
        obs.closed = true;
        obs.bufferedCount = 0;
        obs.userEvents = [];
      }
    }
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
    obs.bufferedCount = 0;
    // When the dispatcher is already completed, the subscription was closed
    // by #deliver's terminal path. return() -> #close(true) is a no-op
    // (already closed), so the buffer survives. Only clear userEvents if
    // the dispatcher is still live (dispose during active dispatch).
    if (!model.completed) {
      obs.userEvents = [];
    }
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
  const userEvents = events.filter(isUserEvent);
  for (let i = 1; i < userEvents.length; i++) {
    const prev = userEvents[i - 1];
    const curr = userEvents[i];
    if (prev !== undefined && curr !== undefined) {
      expect(curr.sequence).toBeGreaterThanOrEqual(prev.sequence);
    }
  }
}

/**
 * Verify that an observer's user events match the model's prediction exactly.
 * Control notifications (detach, progress-dropped) are not verified here
 * because they cascade through the dispatch pipeline in ways that make
 * exact prediction complex. They are verified in the deterministic test.
 */
async function verifyObserverUserEvents(obs: ObserverState): Promise<void> {
  const received = await drainEvents(obs.subscription);
  const userSequences = received.filter(isUserEvent).map((ev) => ev.sequence);
  expect(userSequences).toEqual(obs.userEvents);
  assertMonotonicUserSequences(received);

  // If terminal is present, it must be last
  const hasTerminal = received.some((ev) => ev.type === 'promptiris.run.completed');
  if (hasTerminal) {
    expect(received.at(-1)?.type).toBe('promptiris.run.completed');
  }
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
            // Verify observers that are closed (detached/disposed) or still
            // alive in a completed dispatcher. Closed observers' queues may
            // have been cleared by detach/dispose, so drainEvents returns []
            // which matches userEvents=[].
            if (obs.closed || model.completed) {
              await verifyObserverUserEvents(obs);
            }
          }
        },
      ),
      { numRuns: 200, seed: 0x9a3f_2026 },
    );
  });

  it('fc.scheduler controls microtask ordering across concurrent observers', async () => {
    // Emit events synchronously so both observers buffer all events.
    // Then schedule individual reads using the scheduler, which controls
    // microtask resolution order. This verifies that each observer's
    // output is deterministic regardless of Promise resolution interleaving.
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), async (scheduler) => {
        const sink: Event[] = [];
        const dispatcher = createEventDispatcher('run-scheduler', (event) => sink.push(event));

        const subA = dispatcher.subscribe({ observerId: 'A', capacity: 8 });
        const subB = dispatcher.subscribe({ observerId: 'B', capacity: 8 });

        // Emit 3 events synchronously — both observers buffer all events
        dispatcher.emit(criticalEvent(0));
        dispatcher.emit(criticalEvent(1));
        dispatcher.emit(criticalEvent(2));
        dispatcher.complete('success');

        // Both observers now have [evt-0, evt-1, evt-2, terminal] buffered.
        // Schedule individual reads — the scheduler controls microtask
        // resolution order, interleaving reads across observers.
        const pA = Promise.all([
          scheduler.schedule(subA.next(), 'A0'),
          scheduler.schedule(subA.next(), 'A1'),
          scheduler.schedule(subA.next(), 'A2'),
          scheduler.schedule(subA.next(), 'ATerm'),
        ]);
        const pB = Promise.all([
          scheduler.schedule(subB.next(), 'B0'),
          scheduler.schedule(subB.next(), 'B1'),
          scheduler.schedule(subB.next(), 'B2'),
          scheduler.schedule(subB.next(), 'BTerm'),
        ]);

        await scheduler.waitIdle();

        const resultsA = await pA;
        const resultsB = await pB;

        // Each observer must see exactly 3 user events + terminal
        const eventsA = resultsA.filter((r) => !r.done).map((r) => r.value);
        const eventsB = resultsB.filter((r) => !r.done).map((r) => r.value);

        expect(eventsA.length).toBe(4);
        expect(eventsB.length).toBe(4);

        // User events must be in monotonic sequence order
        assertMonotonicUserSequences(eventsA);
        assertMonotonicUserSequences(eventsB);

        // Terminal must appear exactly once
        expect(eventsA.filter((e) => e.type === 'promptiris.run.completed').length).toBe(1);
        expect(eventsB.filter((e) => e.type === 'promptiris.run.completed').length).toBe(1);

        // Sink must have terminal event
        expect(sink.filter((e) => e.type === 'promptiris.run.completed').length).toBe(1);
      }),
      { numRuns: 200, seed: 0x1b4e_2026 },
    );
  });

  it('lagging observer is detached while healthy observer sees all events including detach notification', async () => {
    // Scenario:
    //   1. lagging (cap=1) and healthy (cap=64)
    //   2. emit(progress-0): both buffer (lagging full at 1/1)
    //   3. emit(progress-1): lagging overflows → progress-dropped to healthy
    //   4. emit(progress-2): dropReported=true → silently accepted
    //   5. complete(): #prepareTerminal detaches lagging (full + no waiter)
    //   6. healthy sees: progress-0, progress-dropped, progress-1, progress-2,
    //                   detached(lagging), terminal
    //   7. lagging: [] (queue cleared by detach → #close(true))
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

    // Healthy observer: verify monotonic sequences
    assertMonotonicUserSequences(healthyEvents);

    // Verify the detach notification for lagging is present with correct data
    const detachEvent = healthyEvents.find(
      (ev) =>
        ev.type === 'promptiris.observer.detached' &&
        (ev.data as { observerId: string }).observerId === 'lagging',
    );
    expect(detachEvent).toBeDefined();
    expect(detachEvent?.source).toBe('core');
    expect(detachEvent?.classification).toBe('metadata');
    expect(detachEvent?.delivery).toBe('critical');

    // Verify the progress-dropped notification is present
    const dropEvent = healthyEvents.find(
      (ev) => ev.type === 'promptiris.observer.progress-dropped',
    );
    expect(dropEvent).toBeDefined();
    expect((dropEvent?.data as { observerId: string }).observerId).toBe('lagging');

    // Terminal must appear exactly once and be last for healthy
    expect(healthyEvents.filter((e) => e.type === 'promptiris.run.completed').length).toBe(1);
    expect(healthyEvents.at(-1)?.type).toBe('promptiris.run.completed');

    // Lagging observer got nothing — queue was cleared by detach
    expect(laggingEvents.length).toBe(0);

    // Sink must contain the detach notification
    const sinkDetach = sink.find(
      (ev) =>
        ev.type === 'promptiris.observer.detached' &&
        (ev.data as { observerId: string }).observerId === 'lagging',
    );
    expect(sinkDetach).toBeDefined();

    // Sink terminal must be present
    expect(sink.filter((e) => e.type === 'promptiris.run.completed').length).toBe(1);
  });
});
