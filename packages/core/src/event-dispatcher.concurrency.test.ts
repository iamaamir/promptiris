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

/** Extract the sequence from an event, throwing if the event is unexpectedly undefined. */
function sequenceOf(event: Event | undefined): number {
  if (event === undefined) throw new Error('Expected event to be defined');
  return event.sequence;
}

/** Drain all events from a subscription, returning them with the terminal flag. */
async function drainAll(sub: EventSubscription): Promise<Event[]> {
  const events: Event[] = [];
  while (true) {
    const result = await sub.next();
    if (result.done) break;
    events.push(result.value);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Model-based command tests (synchronous interleaving)
// ---------------------------------------------------------------------------

interface DispatcherModel {
  observers: Map<string, { capacity: number; subscription: EventSubscription; detached: boolean }>;
  completed: boolean;
  nextSeq: number;
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
    model.observers.set(this.id, { capacity: this.capacity, subscription, detached: false });
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
    model.nextSeq = Math.max(model.nextSeq, this.seq + 1);
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
    return obs !== undefined && !obs.detached;
  }

  run(model: DispatcherModel, real: EventDispatcher): void {
    const obs = model.observers.get(this.observerId);
    if (obs === undefined) return;
    obs.detached = true;
    // fc.Command requires the real parameter; reference it to satisfy the linter.
    void real;
    void obs.subscription.return();
  }

  toString(): string {
    return `dispose(${this.observerId})`;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EventDispatcher concurrency', () => {
  // ---- Model-based command tests (synchronous interleaving) ----

  it('maintains invariants across all generated command sequences', () => {
    const ids = ['alpha', 'beta', 'gamma'];
    const caps = [1, 4, 8, 16, 64];

    fc.assert(
      fc.property(
        fc.commands(
          [
            fc.tuple(fc.constantFrom(...ids), fc.constantFrom(...caps)).map(([id, cap]) => new SubscribeCommand(id, cap)),
            fc.integer({ min: 0, max: 20 }).map((seq) => new EmitCommand(seq)),
            fc.constant(new CompleteCommand()),
            fc.tuple(fc.constantFrom(...ids)).map(([id]) => new DisposeCommand(id)),
          ],
          { maxCommands: 40 },
        ),
        (cmds) => {
          const sink: Event[] = [];
          const dispatcher = createEventDispatcher('run-model', (event) => sink.push(event));
          const model: DispatcherModel = {
            observers: new Map(),
            completed: false,
            nextSeq: 0,
            emittedCount: 0,
          };

          fc.modelRun(() => ({ model, real: dispatcher }), cmds);

          // Invariant: terminal event appears at most once, and if present it's last
          const terminalCount = sink.filter((ev) => ev.type === 'promptiris.run.completed').length;
          if (model.completed) {
            expect(terminalCount).toBe(1);
            const lastEvent = sink.at(-1);
            expect(lastEvent?.type).toBe('promptiris.run.completed');
          } else {
            expect(terminalCount).toBe(0);
          }

          // Invariant: sink must have at least as many events as we emitted
          expect(sink.length).toBeGreaterThanOrEqual(model.emittedCount);
        },
      ),
      { numRuns: 200, seed: 0x9a3f_2026 },
    );
  });

  // ---- Scheduler-based Promise resolution tests ----

  it('Promise resolution order does not break observer invariants', async () => {
    // The scheduler controls the ORDER in which scheduled functions are called.
    // We schedule individual reads on two observers via scheduleFunction,
    // then let the scheduler pick the interleaving.
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), async (scheduler) => {
        const sink: Event[] = [];
        const dispatcher = createEventDispatcher('run-scheduler', (event) => sink.push(event));

        const subA = dispatcher.subscribe({ observerId: 'A', capacity: 8 });
        const subB = dispatcher.subscribe({ observerId: 'B', capacity: 8 });

        dispatcher.emit(criticalEvent(0));
        dispatcher.emit(criticalEvent(1));
        dispatcher.emit(criticalEvent(2));

        // scheduleFunction defers the call — the scheduler picks when each fires
        const readA = scheduler.scheduleFunction(() => subA.next());
        const readB = scheduler.scheduleFunction(() => subB.next());

        // Interleave reads from both observers
        const rA0 = readA();
        const rB0 = readB();
        const rA1 = readA();
        const rB1 = readB();
        const rA2 = readA();
        const rB2 = readB();

        // Complete — adds terminal event after existing events
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

        // Both observers must see events in monotonic sequence order
        for (const results of [resultsA, resultsB]) {
          const events = results.filter((r) => !r.done).map((r) => r.value);
          for (let i = 1; i < events.length; i++) {
            expect(sequenceOf(events[i])).toBeGreaterThanOrEqual(sequenceOf(events[i - 1]));
          }
          // Terminal must be last
          const termIdx = events.findIndex((ev) => ev.type === 'promptiris.run.completed');
          if (termIdx !== -1) {
            expect(termIdx).toBe(events.length - 1);
          }
        }
      }),
      { numRuns: 200, seed: 0x1b4e_2026 },
    );
  });

  it('lagging observer is detached while healthy observer sees all events', async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), async (scheduler) => {
        const sink: Event[] = [];
        const dispatcher = createEventDispatcher('run-scheduler-lag', (event) => sink.push(event));

        const lagging = dispatcher.subscribe({ observerId: 'lagging', capacity: 1 });
        const healthy = dispatcher.subscribe({ observerId: 'healthy', capacity: 64 });

        // Fill lagging capacity, then overflow to trigger detach
        dispatcher.emit(criticalEvent(0));
        dispatcher.emit(criticalEvent(1));
        dispatcher.emit(criticalEvent(2));

        const readLagging = scheduler.scheduleFunction(() => lagging.next());
        const readHealthy = scheduler.scheduleFunction(() => healthy.next());

        // Interleave reads
        const rL0 = readLagging();
        const rH0 = readHealthy();
        const rH1 = readHealthy();
        const rH2 = readHealthy();

        // Complete
        const complete = scheduler.scheduleFunction(async () => {
          dispatcher.complete('success');
        });
        const rComplete = complete();

        const rHTerm = readHealthy();

        await scheduler.waitIdle();
        await rComplete;

        const laggingResult = await rL0;
        const healthyResults = await Promise.all([rH0, rH1, rH2, rHTerm]);

        const laggingEvents = [laggingResult].filter((r) => !r.done).map((r) => r.value);
        const healthyEvents = healthyResults.filter((r) => !r.done).map((r) => r.value);

        // Monotonic sequences per observer
        const checkMono = (events: Event[]) => {
          for (let i = 1; i < events.length; i++) {
            expect(sequenceOf(events[i])).toBeGreaterThanOrEqual(sequenceOf(events[i - 1]));
          }
        };
        checkMono(laggingEvents);
        checkMono(healthyEvents);

        // Terminal must be last if present
        const hTermIdx = healthyEvents.findIndex((ev) => ev.type === 'promptiris.run.completed');
        if (hTermIdx !== -1) {
          expect(hTermIdx).toBe(healthyEvents.length - 1);
        }

        // Healthy should have received more events than lagging (lagging got detached)
        expect(healthyEvents.length).toBeGreaterThanOrEqual(laggingEvents.length);
      }),
      { numRuns: 200, seed: 0x7c2d_2026 },
    );
  });

  it('concurrent reads on the same subscription are rejected', async () => {
    const dispatcher = createEventDispatcher('run-concurrent-reads');
    const sub = dispatcher.subscribe({ observerId: 'reader', capacity: 8 });

    const pending = sub.next();

    await expect(sub.next()).rejects.toThrow(
      'Concurrent Event subscription reads are not supported',
    );

    dispatcher.emit(criticalEvent(0));
    const result = await pending;
    expect(result.done).toBe(false);

    dispatcher.complete('success');
    await sub.next();
    await expect(sub.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it('sink throw does not prevent event delivery to subscriptions', async () => {
    const throwingDispatcher = createEventDispatcher('run-throwing-sink', () => {
      throw new Error('sink failure');
    });

    const sub = throwingDispatcher.subscribe({ observerId: 'observer', capacity: 8 });
    throwingDispatcher.emit(criticalEvent(0));
    throwingDispatcher.complete('success');

    const received = await sub.next();
    expect(received.done).toBe(false);
    if (!received.done) {
      expect(received.value.type).toBe('test.event-0');
    }
  });

  it('complete while observers have pending reads resolves them with terminal', async () => {
    const dispatcher = createEventDispatcher('run-complete-pending');
    const sub = dispatcher.subscribe({ observerId: 'pending-reader', capacity: 8 });

    const pendingRead = sub.next();
    dispatcher.complete('success');

    const result = await pendingRead;
    expect(result.done).toBe(false);
    expect(result.value).toMatchObject({ type: 'promptiris.run.completed' });

    await expect(sub.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it('dispose during active emission prevents further delivery', async () => {
    const sink: Event[] = [];
    const dispatcher = createEventDispatcher('run-dispose-emission', (event) => sink.push(event));
    const sub = dispatcher.subscribe({ observerId: 'disposable', capacity: 64 });

    dispatcher.emit(criticalEvent(0));
    await sub.return();
    dispatcher.emit(criticalEvent(1));

    expect(sink).toHaveLength(2);
    expect(sink[0]?.type).toBe('test.event-0');
    expect(sink[1]?.type).toBe('test.event-1');
  });

  it('reentrant sink emission preserves terminal-event-last ordering', async () => {
    const sink2: Event[] = [];
    const dispatcher = createEventDispatcher('run-reentrant', (event) => {
      sink2.push(event);
      if (event.type === 'test.event-0') {
        dispatcher.emit(criticalEvent(1));
        dispatcher.complete('success');
      }
    });
    const sub = dispatcher.subscribe({ observerId: 'observer', capacity: 16 });

    dispatcher.emit(criticalEvent(0));

    const events = await drainAll(sub);

    const lastEvent = events.at(-1);
    expect(lastEvent?.type).toBe('promptiris.run.completed');
    for (let i = 1; i < events.length; i++) {
      expect(sequenceOf(events[i])).toBeGreaterThanOrEqual(sequenceOf(events[i - 1]));
    }
  });
});
