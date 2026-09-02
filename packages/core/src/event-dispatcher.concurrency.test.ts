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
// Model-based command tests (synchronous interleaving)
// ---------------------------------------------------------------------------

interface ObserverState {
  capacity: number;
  subscription: EventSubscription;
  /** Whether the observer has been detached or disposed. */
  closed: boolean;
  /** Predicted user-event sequences actually delivered. */
  delivered: number[];
  /** Number of events buffered (not yet consumed by next()). */
  buffered: number;
  /** Whether a next() call is pending. */
  waiting: boolean;
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
    });
  }

  toString(): string {
    return `subscribe(${this.id}, cap=${String(this.capacity)})`;
  }
}

class EmitCommand implements fc.Command<DispatcherModel, EventDispatcher> {
  constructor(private readonly seq: number) {}

  check(model: Readonly<DispatcherModel>): boolean {
    return !model.completed;
  }

  run(model: DispatcherModel, real: EventDispatcher): void {
    real.emit(criticalEvent(this.seq));
    model.emittedCount += 1;

    // Mirror the dispatcher's per-observer delivery logic
    for (const [, obs] of model.observers) {
      if (obs.closed) continue;
      if (obs.waiting) {
        // Immediate delivery via pending next()
        obs.delivered.push(this.seq);
        obs.waiting = false;
      } else if (obs.buffered < obs.capacity) {
        // Buffered for later drain — still counts as delivered
        obs.delivered.push(this.seq);
        obs.buffered += 1;
      } else {
        // Buffer full, no waiter → critical event triggers detach
        obs.closed = true;
        obs.buffered = 0;
        obs.delivered = []; // queue cleared by #close(true) on detach
      }
    }
  }

  toString(): string {
    return `emit(${String(this.seq)})`;
  }
}

class CompleteCommand implements fc.Command<DispatcherModel, EventDispatcher> {
  check(model: Readonly<DispatcherModel>): boolean {
    return !model.completed;
  }

  run(model: DispatcherModel, real: EventDispatcher): void {
    model.completed = true;
    // #prepareTerminal detaches observers where canAcceptCritical() = false
    for (const [, obs] of model.observers) {
      if (obs.closed) continue;
      if (!obs.waiting && obs.buffered >= obs.capacity) {
        obs.closed = true;
        obs.buffered = 0;
        obs.delivered = []; // queue cleared by #close(true) on detach
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
    obs.buffered = 0;
    obs.delivered = []; // queue cleared by #close(true) on dispose
    void real;
    void obs.subscription.return();
  }

  toString(): string {
    return `dispose(${this.observerId})`;
  }
}

// ---------------------------------------------------------------------------
// Helpers for model-based invariant checks
// ---------------------------------------------------------------------------

async function drainSubscription(sub: EventSubscription): Promise<Event[]> {
  const received: Event[] = [];
  for (;;) {
    const result = await sub.next();
    if (result.done) break;
    received.push(result.value);
  }
  return received;
}

function assertMonotonicSequences(events: Event[]): void {
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1];
    const curr = events[i];
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
  const received = await drainSubscription(obs.subscription);
  assertMonotonicSequences(received);
  assertTerminalLast(received);

  if (!obs.closed && completed) {
    const userEvents = received.filter((ev) => ev.type.startsWith('test.event-'));
    const observedSeqs = userEvents.map((ev) => (ev.data as { seq: number }).seq);
    expect(observedSeqs).toEqual(obs.delivered);
  }
}

function verifyGlobalInvariants(sink: Event[], model: DispatcherModel): void {
  const terminalCount = sink.filter((ev) => ev.type === 'promptiris.run.completed').length;
  if (model.completed) {
    expect(terminalCount).toBe(1);
    expect(sink.at(-1)?.type).toBe('promptiris.run.completed');
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

    await fc.assert(
      fc.asyncProperty(
        fc.commands(
          [
            fc
              .tuple(fc.constantFrom(...ids), fc.constantFrom(...caps))
              .map(([id, cap]) => new SubscribeCommand(id, cap)),
            fc.integer({ min: 0, max: 20 }).map((seq) => new EmitCommand(seq)),
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
            await verifyObserverInvariants(obs, model.completed);
          }
        },
      ),
      { numRuns: 200, seed: 0x9a3f_2026 },
    );
  });

  it('Promise resolution order does not break observer invariants', async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), async (scheduler) => {
        const sink: Event[] = [];
        const dispatcher = createEventDispatcher('run-scheduler', (event) => sink.push(event));

        const subA = dispatcher.subscribe({ observerId: 'A', capacity: 8 });
        const subB = dispatcher.subscribe({ observerId: 'B', capacity: 8 });

        dispatcher.emit(criticalEvent(0));
        dispatcher.emit(criticalEvent(1));
        dispatcher.emit(criticalEvent(2));

        const readA = scheduler.scheduleFunction(() => subA.next());
        const readB = scheduler.scheduleFunction(() => subB.next());

        const rA0 = readA();
        const rB0 = readB();
        const rA1 = readA();
        const rB1 = readB();
        const rA2 = readA();
        const rB2 = readB();

        const complete = scheduler.scheduleFunction(async () => {
          dispatcher.complete('success');
        });
        const rComplete = complete();

        const rATerm = readA();
        const rBTerm = readB();

        await scheduler.waitIdle();
        await rComplete;

        const resultsA = await Promise.all([rA0, rA1, rA2, rATerm]);
        const resultsB = await Promise.all([rB0, rB1, rB2, rBTerm]);

        for (const results of [resultsA, resultsB]) {
          const events = results.filter((r) => !r.done).map((r) => r.value);
          for (let i = 1; i < events.length; i++) {
            const prev = events[i - 1];
            const curr = events[i];
            if (prev !== undefined && curr !== undefined) {
              expect(curr.sequence).toBeGreaterThanOrEqual(prev.sequence);
            }
          }
          const termIdx = events.findIndex((ev) => ev.type === 'promptiris.run.completed');
          if (termIdx !== -1) {
            expect(termIdx).toBe(events.length - 1);
          }
        }
      }),
      { numRuns: 200, seed: 0x1b4e_2026 },
    );
  });

  it('lagging observer is detached while healthy observer sees all events including detach', async () => {
    // This test uses a deterministic setup to verify the detach-on-overflow path.
    //
    // When an observer's buffer is full and a non-progress (critical) event arrives,
    // the observer is detached and its queue is cleared.
    //
    // Scenario:
    //   1. Subscribe lagging (cap=1) and healthy (cap=64)
    //   2. Emit progress-0 → both buffer it (lagging full at 1/1)
    //   3. Emit progress-1 → lagging overflows → progress-dropped notification
    //      (dispatched to healthy, excluded from lagging)
    //   4. Emit progress-2 → lagging overflows but dropReported=true → silently accepted
    //   5. Complete → #prepareTerminal checks canAcceptCritical():
    //      lagging has buffer full + no waiter → detach() → #close(true) clears queue
    //   6. healthy ends up with: [progress-0, progress-dropped, progress-1, progress-2,
    //      detached, terminal]
    //   7. lagging ends up with: [] (queue cleared on detach)
    await fc.assert(
      fc.asyncProperty(fc.constant({}), async () => {
        const sink: Event[] = [];
        const dispatcher = createEventDispatcher('run-detach', (event) => sink.push(event));

        const lagging = dispatcher.subscribe({ observerId: 'lagging', capacity: 1 });
        const healthy = dispatcher.subscribe({ observerId: 'healthy', capacity: 64 });

        // Emit 3 progress events synchronously.
        dispatcher.emit(progressEvent(0));
        dispatcher.emit(progressEvent(1));
        dispatcher.emit(progressEvent(2));

        // Complete → #prepareTerminal detaches lagging (buffer full, no waiter)
        // detach() calls #close(true) which clears lagging's queue
        dispatcher.complete('success');

        // --- Drain healthy ---
        const healthyEvents: Event[] = [];
        for (;;) {
          const result = await healthy.next();
          if (result.done) break;
          healthyEvents.push(result.value);
        }

        // --- Drain lagging ---
        const laggingEvents: Event[] = [];
        for (;;) {
          const result = await lagging.next();
          if (result.done) break;
          laggingEvents.push(result.value);
        }

        // Healthy sees: progress-0, progress-dropped, progress-1, progress-2,
        //               detached, terminal
        // At minimum: 3 progress events + terminal
        expect(healthyEvents.length).toBeGreaterThanOrEqual(4);

        // Healthy observer must see the detach notification for lagging
        const detachEvent = healthyEvents.find(
          (ev) =>
            ev.type === 'promptiris.observer.detached' &&
            (ev.data as { observerId: string }).observerId === 'lagging',
        );
        expect(detachEvent).toBeDefined();

        // Terminal must be last for healthy observer
        const hTermIdx = healthyEvents.findIndex((ev) => ev.type === 'promptiris.run.completed');
        expect(hTermIdx).toBe(healthyEvents.length - 1);

        // Monotonic sequences for healthy
        for (let i = 1; i < healthyEvents.length; i++) {
          const prev = healthyEvents[i - 1];
          const curr = healthyEvents[i];
          if (prev !== undefined && curr !== undefined) {
            expect(curr.sequence).toBeGreaterThanOrEqual(prev.sequence);
          }
        }

        // Lagging was detached during #prepareTerminal — its queue was cleared
        // by detach() → #close(true), so it receives 0 events
        expect(laggingEvents.length).toBe(0);

        // Healthy saw more events than lagging (detach + terminal at minimum)
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
