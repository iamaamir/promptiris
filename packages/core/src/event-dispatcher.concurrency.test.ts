import fc from 'fast-check';
import type { Scheduler } from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Event } from '@promptiris/protocol';
import { createEventDispatcher } from './event-dispatcher.js';
import type { EventDispatcher, EventSubscription } from './event-dispatcher.js';

type Delivery = 'critical' | 'progress';
type CompletionStatus = 'success' | 'degraded' | 'blocked' | 'cancelled' | 'failed';

const userEvent = (delivery: Delivery, value: number) => ({
  type: `example.event-${String(value)}`,
  source: 'test',
  dataSchema: 'example/event-v1',
  data: { value },
  classification: 'metadata' as const,
  delivery,
});

const CONCURRENT_READ_ERROR = 'Concurrent Event subscription reads are not supported';
const DONE: { readonly kind: 'done' } = { kind: 'done' };

/** Externally observable projection of a stamped Event. */
interface ObservedEvent {
  readonly sequence: number;
  readonly type: string;
  readonly delivery: Delivery;
  readonly status?: CompletionStatus | undefined;
  readonly observer?: string | undefined;
}

function project(event: Event): ObservedEvent {
  const data = event.data as { status?: unknown; observerId?: unknown };
  const { status, observerId } = data;
  return {
    sequence: event.sequence,
    type: event.type,
    delivery: event.delivery,
    status:
      status === 'success' ||
      status === 'degraded' ||
      status === 'blocked' ||
      status === 'cancelled' ||
      status === 'failed'
        ? status
        : undefined,
    observer: typeof observerId === 'string' ? observerId : undefined,
  };
}

type ObservedOutcome =
  | { readonly kind: 'event'; readonly event: ObservedEvent }
  | { readonly kind: 'done' };

async function readOutcome(subscription: EventSubscription): Promise<ObservedOutcome> {
  const result = await subscription.next();
  if (result.done) return DONE;
  return { kind: 'event', event: project(result.value) };
}

// ---------------------------------------------------------------------------
// Faithful lockstep model
// ---------------------------------------------------------------------------
//
// ModelWorld mirrors StandardEventDispatcher at the externally observable
// level: global stamp order through one pending FIFO, per-observer queues,
// waiting readers, progress-drop coalescing, critical-overflow detachment,
// terminal preparation, and sink call order. RealWorld drives the real
// dispatcher through the same operations. Every interaction flows through
// DualWorld so the two sides can never drift apart unnoticed.

interface ModelObserver {
  readonly id: string;
  readonly capacity: number;
  readonly queue: ObservedEvent[];
  readonly received: ObservedOutcome[];
  waiting: boolean;
  closed: boolean;
  dropReported: boolean;
}

type EnqueueOutcome = 'accepted' | 'progress-dropped' | 'detached';

class ModelWorld {
  readonly sink: ObservedEvent[] = [];
  readonly observers = new Map<string, ModelObserver>();
  readonly live = new Set<string>();
  accepting = true;
  completed = false;
  private completionStatus: CompletionStatus | undefined;
  private sequence = 0;
  private readonly pending: {
    event: ObservedEvent;
    excluded: string | undefined;
    terminal: boolean;
  }[] = [];

  subscribe(id: string, capacity: number): void {
    const previous = this.observers.get(id);
    this.observers.set(id, {
      id,
      capacity,
      queue: [],
      received: previous === undefined ? [] : previous.received,
      waiting: false,
      closed: false,
      dropReported: false,
    });
    this.live.add(id);
  }

  emit(delivery: Delivery, value: number): void {
    this.pending.push({
      event: {
        sequence: this.sequence++,
        type: `example.event-${String(value)}`,
        delivery,
        status: undefined,
        observer: undefined,
      },
      excluded: undefined,
      terminal: false,
    });
    this.drain();
  }

  complete(status: CompletionStatus): void {
    if (!this.accepting) return;
    this.accepting = false;
    this.completed = true;
    this.completionStatus = status;
    this.drain();
  }

  dispose(id: string): void {
    const observer = this.require(id);
    this.live.delete(id);
    this.close(observer, true);
  }

  /** Consume one immediately available outcome, mirroring next(). */
  readAvailable(id: string): ObservedOutcome {
    const observer = this.require(id);
    const event = observer.queue.shift();
    if (event !== undefined) {
      if (observer.queue.length < observer.capacity) observer.dropReported = false;
      const outcome: ObservedOutcome = { kind: 'event', event };
      observer.received.push(outcome);
      return outcome;
    }
    if (!observer.closed) throw new Error(`Model read would park for observer ${id}`);
    observer.received.push(DONE);
    return DONE;
  }

  isAvailable(id: string): boolean {
    const observer = this.observers.get(id);
    if (observer === undefined) return false;
    return observer.queue.length > 0 || observer.closed;
  }

  /**
   * Whether the dispatcher still addresses the observer: subscribed, not
   * disposed, not detached by the dispatcher, not swept by terminal delivery.
   * Detached observers stay readable (done) but no longer receive events.
   */
  isAddressed(id: string): boolean {
    const observer = this.observers.get(id);
    if (observer === undefined) return false;
    return this.live.has(id) && !observer.closed;
  }

  /** Mirror next() parking a waiter when no outcome is immediately available. */
  park(id: string): void {
    const observer = this.require(id);
    if (observer.queue.length > 0 || observer.closed) {
      throw new Error(`Model read would not park for observer ${id}`);
    }
    if (observer.waiting) throw new Error(CONCURRENT_READ_ERROR);
    observer.waiting = true;
  }

  isWaiting(id: string): boolean {
    return this.require(id).waiting;
  }

  private require(id: string): ModelObserver {
    const observer = this.observers.get(id);
    if (observer === undefined) throw new Error(`Unknown model observer ${id}`);
    return observer;
  }

  private control(observerId: string, detached: boolean): ObservedEvent {
    return {
      sequence: this.sequence++,
      type: detached ? 'promptiris.observer.detached' : 'promptiris.observer.progress-dropped',
      delivery: 'critical',
      status: undefined,
      observer: observerId,
    };
  }

  private enqueue(observer: ModelObserver, event: ObservedEvent): EnqueueOutcome {
    if (observer.closed) return 'detached';
    if (observer.waiting) {
      observer.waiting = false;
      observer.received.push({ kind: 'event', event });
      return 'accepted';
    }
    if (observer.queue.length < observer.capacity) {
      observer.queue.push(event);
      return 'accepted';
    }
    if (event.delivery === 'progress') {
      if (observer.dropReported) return 'accepted';
      observer.dropReported = true;
      return 'progress-dropped';
    }
    this.close(observer, true);
    return 'detached';
  }

  private close(observer: ModelObserver, discard: boolean): void {
    if (observer.closed) return;
    observer.closed = true;
    if (discard) observer.queue.length = 0;
    if (observer.waiting && observer.queue.length === 0) {
      observer.waiting = false;
      observer.received.push(DONE);
    }
  }

  private canAcceptCritical(observer: ModelObserver): boolean {
    return observer.waiting || observer.queue.length < observer.capacity;
  }

  private deliver(event: ObservedEvent, excluded: string | undefined, terminal: boolean): void {
    this.sink.push(event);
    const outcomes: { observer: ModelObserver; outcome: EnqueueOutcome }[] = [];
    for (const id of this.live) {
      if (id === excluded) continue;
      const observer = this.require(id);
      // Detached observers stay listed for later reads but leave the
      // deliverable set, exactly like the dispatcher's subscription set.
      if (observer.closed) continue;
      outcomes.push({ observer, outcome: this.enqueue(observer, event) });
    }
    for (const { observer, outcome } of outcomes) this.report(observer, outcome);
    if (terminal) {
      for (const id of [...this.live]) this.close(this.require(id), false);
      this.live.clear();
    }
  }

  private report(observer: ModelObserver, outcome: EnqueueOutcome): void {
    if (outcome === 'accepted') return;
    this.pending.push({
      event: this.control(observer.id, outcome === 'detached'),
      excluded: observer.id,
      terminal: false,
    });
  }

  private prepareTerminal(): void {
    let lagging = this.findLagging();
    while (lagging !== undefined) {
      const detached = lagging;
      this.close(detached, true);
      this.pending.push({
        event: this.control(detached.id, true),
        excluded: detached.id,
        terminal: false,
      });
      lagging = this.findLagging();
    }
  }

  private findLagging(): ModelObserver | undefined {
    return [...this.live]
      .map((id) => this.require(id))
      .find((observer) => !observer.closed && !this.canAcceptCritical(observer));
  }

  private drain(): void {
    while (true) {
      const next = this.pending.shift();
      if (next !== undefined) {
        this.deliver(next.event, next.excluded, next.terminal);
        continue;
      }
      const status = this.completionStatus;
      if (status === undefined) return;
      this.completionStatus = undefined;
      this.prepareTerminal();
      this.pending.push({
        event: {
          sequence: this.sequence++,
          type: 'promptiris.run.completed',
          delivery: 'critical',
          status,
          observer: undefined,
        },
        excluded: undefined,
        terminal: true,
      });
    }
  }
}

class RealWorld {
  readonly sink: Event[] = [];
  readonly subscriptions = new Map<string, EventSubscription>();
  readonly live = new Set<string>();
  readonly observed = new Map<string, ObservedOutcome[]>();
  readonly dispatcher: EventDispatcher;
  private readonly floating = new Map<string, Promise<ObservedOutcome>[]>();

  constructor(runId: string) {
    const sink: Event[] = [];
    this.sink = sink;
    this.dispatcher = createEventDispatcher(runId, (event) => {
      sink.push(event);
    });
  }

  record(id: string, outcome: ObservedOutcome): void {
    const list = this.observed.get(id);
    if (list === undefined) this.observed.set(id, [outcome]);
    else list.push(outcome);
  }

  subscribe(id: string, capacity: number): void {
    this.subscriptions.set(id, this.dispatcher.subscribe({ observerId: id, capacity }));
    this.live.add(id);
  }

  emit(delivery: Delivery, value: number): void {
    this.dispatcher.emit(userEvent(delivery, value));
  }

  complete(status: CompletionStatus): void {
    this.dispatcher.complete(status);
    // Terminal delivery completes and clears every subscription.
    this.live.clear();
  }

  async dispose(id: string): Promise<void> {
    // Dispose through the async-disposable protocol, the same path consumers
    // take with `await using`: Symbol.asyncDispose delegates to return().
    await this.require(id)[Symbol.asyncDispose]();
    // A parked waiter resolved by disposal is recorded through the floating
    // path; the disposal itself carries no further observable outcome — the
    // done is observed by a later read, exactly like the model.
    await this.flushFloating(id);
    this.live.delete(id);
  }

  async flushFloating(id: string): Promise<void> {
    const pending = this.floating.get(id);
    this.floating.delete(id);
    if (pending !== undefined) await Promise.all(pending);
  }

  async flushAllFloating(): Promise<void> {
    for (const id of [...this.floating.keys()]) await this.flushFloating(id);
  }

  park(id: string): void {
    const pending = readOutcome(this.require(id)).then((outcome) => {
      this.record(id, outcome);
      return outcome;
    });
    const list = this.floating.get(id);
    if (list === undefined) this.floating.set(id, [pending]);
    else list.push(pending);
  }

  require(id: string): EventSubscription {
    const subscription = this.subscriptions.get(id);
    if (subscription === undefined) throw new Error(`Unknown real observer ${id}`);
    return subscription;
  }
}

/** Drives model and real sides in lockstep; every assertion compares the two. */
class DualWorld {
  readonly model = new ModelWorld();
  readonly real: RealWorld;

  constructor(runId: string) {
    this.real = new RealWorld(runId);
  }

  subscribe(id: string, capacity: number): void {
    this.real.subscribe(id, capacity);
    this.model.subscribe(id, capacity);
    expect(this.real.live).toEqual(this.model.live);
  }

  duplicateSubscribe(id: string, capacity: number): void {
    expect(() => this.real.subscribe(id, capacity)).toThrow(/duplicate/i);
    expect(this.real.live).toEqual(this.model.live);
    expect(this.real.sink).toHaveLength(this.model.sink.length);
  }

  emit(delivery: Delivery, value: number): void {
    if (this.model.completed) {
      expect(() => this.real.emit(delivery, value)).toThrow(/complete/i);
      expect(this.real.sink).toHaveLength(this.model.sink.length);
      return;
    }
    this.real.emit(delivery, value);
    this.model.emit(delivery, value);
    expect(this.real.sink).toHaveLength(this.model.sink.length);
  }

  complete(status: CompletionStatus): void {
    this.real.complete(status);
    this.model.complete(status);
    expect(this.real.sink).toHaveLength(this.model.sink.length);
  }

  async dispose(id: string): Promise<void> {
    await this.real.dispose(id);
    this.model.dispose(id);
    expect(this.real.live).toEqual(this.model.live);
  }

  async readAvailable(id: string): Promise<void> {
    expect(this.model.isAvailable(id)).toBe(true);
    const expected = this.model.readAvailable(id);
    const actual = await readOutcome(this.real.require(id));
    this.real.record(id, actual);
    expect(actual).toEqual(expected);
  }

  /** Scheduler-path read: availability, concurrent rejection, or a parked waiter. */
  async tryRead(id: string): Promise<void> {
    await this.real.flushFloating(id);
    if (this.model.isAvailable(id)) {
      await this.readAvailable(id);
    } else if (this.model.isWaiting(id)) {
      await expect(this.real.require(id).next()).rejects.toThrow(CONCURRENT_READ_ERROR);
    } else {
      this.model.park(id);
      this.real.park(id);
    }
  }

  async settle(status: CompletionStatus): Promise<void> {
    if (!this.model.completed) this.complete(status);
    // Completion resolves every parked waiter, so floatings settle here.
    await this.real.flushAllFloating();
    for (const id of [...this.model.observers.keys()].sort()) {
      while (true) {
        const expected = this.model.readAvailable(id);
        const actual = await readOutcome(this.real.require(id));
        this.real.record(id, actual);
        expect(actual).toEqual(expected);
        if (expected.kind === 'done') break;
      }
    }
    expect(this.real.live).toEqual(this.model.live);
    for (const [id, observer] of this.model.observers) {
      expect(this.real.observed.get(id)).toEqual(observer.received);
    }
    expect(this.real.sink.map(project)).toEqual(this.model.sink);
    assertSinkContiguous(this.real.sink.map(project));
    for (const outcomes of this.real.observed.values()) assertObserverWellFormed(outcomes);
  }
}

function assertSinkContiguous(sink: ObservedEvent[]): void {
  expect(sink.map((event) => event.sequence)).toEqual(sink.map((_, index) => index));
}

function assertObserverWellFormed(outcomes: ObservedOutcome[]): void {
  const sequences: number[] = [];
  let seenTerminal = false;
  let seenDone = false;
  for (const outcome of outcomes) {
    if (outcome.kind === 'done') {
      seenDone = true;
      continue;
    }
    // Reads after termination always resolve done; only the trailing run is kept.
    expect(seenDone).toBe(false);
    expect(seenTerminal).toBe(false);
    sequences.push(outcome.event.sequence);
    if (outcome.event.type === 'promptiris.run.completed') seenTerminal = true;
  }
  expect(seenDone).toBe(true);
  expect([...sequences].sort((a, b) => a - b)).toEqual(sequences);
}

// ---------------------------------------------------------------------------
// Model-based command sequences
// ---------------------------------------------------------------------------

const OBSERVER_IDS = ['observer-a', 'observer-b', 'observer-c'] as const;

interface WorldCommand {
  check(model: ModelWorld): boolean;
  run(world: DualWorld): Promise<void>;
}

class SubscribeCommand implements WorldCommand {
  constructor(
    private readonly id: string,
    private readonly capacity: number,
  ) {}

  check(model: ModelWorld): boolean {
    return !model.completed && !model.isAddressed(this.id);
  }

  async run(world: DualWorld): Promise<void> {
    world.subscribe(this.id, this.capacity);
  }

  toString(): string {
    return `subscribe(${this.id}, capacity=${String(this.capacity)})`;
  }
}

class EmitCommand implements WorldCommand {
  constructor(
    private readonly delivery: Delivery,
    private readonly value: number,
  ) {}

  check(model: ModelWorld): boolean {
    return !model.completed;
  }

  async run(world: DualWorld): Promise<void> {
    world.emit(this.delivery, this.value);
  }

  toString(): string {
    return `emit(${this.delivery}, ${String(this.value)})`;
  }
}

class CompleteCommand implements WorldCommand {
  constructor(private readonly status: CompletionStatus) {}

  check(): boolean {
    return true;
  }

  async run(world: DualWorld): Promise<void> {
    world.complete(this.status);
  }

  toString(): string {
    return `complete(${this.status})`;
  }
}

class DisposeCommand implements WorldCommand {
  constructor(private readonly id: string) {}

  check(model: ModelWorld): boolean {
    return model.live.has(this.id);
  }

  async run(world: DualWorld): Promise<void> {
    await world.dispose(this.id);
  }

  toString(): string {
    return `dispose(${this.id})`;
  }
}

class ReadCommand implements WorldCommand {
  constructor(private readonly id: string) {}

  check(model: ModelWorld): boolean {
    return model.observers.has(this.id) && model.isAvailable(this.id);
  }

  async run(world: DualWorld): Promise<void> {
    await world.readAvailable(this.id);
  }

  toString(): string {
    return `read(${this.id})`;
  }
}

class DuplicateSubscribeCommand implements WorldCommand {
  constructor(
    private readonly id: string,
    private readonly capacity: number,
  ) {}

  check(model: ModelWorld): boolean {
    return !model.completed && model.isAddressed(this.id);
  }

  async run(world: DualWorld): Promise<void> {
    world.duplicateSubscribe(this.id, this.capacity);
  }

  toString(): string {
    return `duplicateSubscribe(${this.id})`;
  }
}

const completionStatusArb = fc.constantFrom<CompletionStatus>(
  'success',
  'degraded',
  'blocked',
  'cancelled',
  'failed',
);

const idArb = fc.constantFrom<string>(...OBSERVER_IDS);

const commandArb: fc.Arbitrary<WorldCommand> = fc.oneof(
  {
    weight: 2,
    arbitrary: fc
      .record({ id: idArb, capacity: fc.integer({ min: 1, max: 4 }) })
      .map(({ id, capacity }) => new SubscribeCommand(id, capacity)),
  },
  {
    weight: 5,
    arbitrary: fc
      .record({
        delivery: fc.constantFrom<Delivery>('critical', 'progress'),
        value: fc.integer({ min: 0, max: 9 }),
      })
      .map(({ delivery, value }) => new EmitCommand(delivery, value)),
  },
  { weight: 1, arbitrary: completionStatusArb.map((status) => new CompleteCommand(status)) },
  { weight: 1, arbitrary: idArb.map((id) => new DisposeCommand(id)) },
  { weight: 3, arbitrary: idArb.map((id) => new ReadCommand(id)) },
  {
    weight: 1,
    arbitrary: fc
      .record({ id: idArb, capacity: fc.integer({ min: 1, max: 4 }) })
      .map(({ id, capacity }) => new DuplicateSubscribeCommand(id, capacity)),
  },
);

// ---------------------------------------------------------------------------
// Scheduler-driven lockstep interleavings
// ---------------------------------------------------------------------------

type ScheduledOp =
  | { readonly kind: 'emit'; readonly delivery: Delivery; readonly value: number }
  | { readonly kind: 'read'; readonly id: string }
  | { readonly kind: 'complete'; readonly status: CompletionStatus };

function applyScheduledOp(world: DualWorld, op: ScheduledOp): Promise<void> {
  switch (op.kind) {
    case 'emit':
      world.emit(op.delivery, op.value);
      return Promise.resolve();
    case 'read':
      return world.tryRead(op.id);
    case 'complete':
      world.complete(op.status);
      return Promise.resolve();
  }
}

async function executeSchedule(
  scheduler: Scheduler,
  runId: string,
  observers: readonly { id: string; capacity: number }[],
  prePark: readonly string[],
  ops: readonly ScheduledOp[],
): Promise<void> {
  const world = new DualWorld(runId);
  for (const { id, capacity } of observers) world.subscribe(id, capacity);
  for (const id of prePark) {
    world.model.park(id);
    world.real.park(id);
  }
  const tasks = ops.map((op) => scheduler.scheduleFunction(() => applyScheduledOp(world, op))());
  const finish = scheduler.scheduleFunction(() => {
    world.complete('success');
    return Promise.resolve();
  })();
  await scheduler.waitIdle();
  await Promise.all([...tasks, finish]);
  expect(scheduler.count()).toBe(0);
  await world.settle('success');
}

async function runScheduled(
  runId: string,
  observers: readonly { id: string; capacity: number }[],
  opsArb: fc.Arbitrary<readonly ScheduledOp[]>,
  numRuns: number,
  prePark: readonly string[] = [],
): Promise<void> {
  await fc.assert(
    fc.asyncProperty(fc.scheduler(), opsArb, (scheduler, ops) =>
      executeSchedule(scheduler, runId, observers, prePark, ops),
    ),
    { numRuns },
  );
}

const scheduledOpArb = (ids: readonly string[]): fc.Arbitrary<ScheduledOp> =>
  fc.oneof(
    {
      weight: 4,
      arbitrary: fc
        .record({
          delivery: fc.constantFrom<Delivery>('critical', 'progress'),
          value: fc.integer({ min: 0, max: 5 }),
        })
        .map(({ delivery, value }) => ({ kind: 'emit', delivery, value }) as const),
    },
    { weight: 4, arbitrary: fc.constantFrom(...ids).map((id) => ({ kind: 'read', id }) as const) },
    { weight: 1, arbitrary: completionStatusArb.map((status) => ({ kind: 'complete', status }) as const) },
  );

const SCHEDULED_IDS = ['sched-left', 'sched-right'] as const;

function outcomeTypes(outcomes: ObservedOutcome[] | undefined): string[] {
  if (outcomes === undefined) throw new Error('Expected recorded observer outcomes');
  return outcomes.map((outcome) => (outcome.kind === 'done' ? 'done' : outcome.event.type));
}

describe('EventDispatcher concurrency', () => {
  it('matches the observer model across generated command sequences', { timeout: 120_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(commandArb, { maxLength: 40 }), async (commands) => {
        const world = new DualWorld('run-model');
        for (const command of commands) {
          if (command.check(world.model)) await command.run(world);
        }
        await world.settle('success');
      }),
      { numRuns: 200 },
    );
  });

  it('preserves per-observer order under scheduled interleavings', { timeout: 120_000 }, async () => {
    await runScheduled(
      'run-scheduled',
      [
        { id: 'sched-left', capacity: 1 },
        { id: 'sched-right', capacity: 2 },
      ],
      fc.array(scheduledOpArb(SCHEDULED_IDS), { minLength: 2, maxLength: 12 }),
      100,
    );
  });

  it('detaches a lagging observer while the healthy observer drains exactly', async () => {
    const sink: Event[] = [];
    const dispatcher = createEventDispatcher('run-detach-exact', (event) => {
      sink.push(event);
    });
    const lagging = dispatcher.subscribe({ observerId: 'lagging', capacity: 1 });
    const healthy = dispatcher.subscribe({ observerId: 'healthy', capacity: 8 });

    dispatcher.emit(userEvent('progress', 1));
    dispatcher.emit(userEvent('progress', 2));
    dispatcher.emit(userEvent('critical', 4));
    dispatcher.emit(userEvent('progress', 5));
    dispatcher.complete('success');

    const laggingOutcomes: ObservedOutcome[] = [];
    while (true) {
      const outcome = await readOutcome(lagging);
      laggingOutcomes.push(outcome);
      if (outcome.kind === 'done') break;
    }
    const healthyOutcomes: ObservedOutcome[] = [];
    while (true) {
      const outcome = await readOutcome(healthy);
      healthyOutcomes.push(outcome);
      if (outcome.kind === 'done') break;
    }

    expect(outcomeTypes(laggingOutcomes)).toEqual(['done']);
    expect(outcomeTypes(healthyOutcomes)).toEqual([
      'example.event-1',
      'example.event-2',
      'promptiris.observer.progress-dropped',
      'example.event-4',
      'promptiris.observer.detached',
      'example.event-5',
      'promptiris.run.completed',
      'done',
    ]);
    expect(healthyOutcomes[2]).toMatchObject({
      kind: 'event',
      event: { observer: 'lagging', delivery: 'critical' },
    });
    expect(healthyOutcomes[4]).toMatchObject({
      kind: 'event',
      event: { observer: 'lagging', delivery: 'critical' },
    });
    expect(sink.map(project)).toEqual(
      healthyOutcomes
        .filter(
          (outcome): outcome is Extract<ObservedOutcome, { kind: 'event' }> =>
            outcome.kind === 'event',
        )
        .map((outcome) => outcome.event),
    );
    assertSinkContiguous(sink.map(project));
  });

  it('rejects the read that loses a scheduled race', { timeout: 60_000 }, async () => {
    const read = (id: string): ScheduledOp => ({ kind: 'read', id });
    await runScheduled(
      'run-read-race',
      [{ id: 'racer', capacity: 1 }],
      fc.constant<readonly ScheduledOp[]>([
        read('racer'),
        read('racer'),
        { kind: 'emit', delivery: 'critical', value: 1 },
        { kind: 'complete', status: 'success' },
      ]),
      100,
    );
  });

  it('isolates a selective sink failure mid-delivery', async () => {
    const attempts: string[] = [];
    const dispatcher = createEventDispatcher('run-selective-throw', (event) => {
      attempts.push(event.type);
      if (event.type === 'example.event-2') throw new Error('selective observer failure');
    });
    const subscription = dispatcher.subscribe({ observerId: 'observer-a' });

    dispatcher.emit(userEvent('critical', 1));
    dispatcher.emit(userEvent('critical', 2));
    dispatcher.emit(userEvent('progress', 3));
    dispatcher.complete('degraded');

    const outcomes: ObservedOutcome[] = [];
    while (true) {
      const outcome = await readOutcome(subscription);
      outcomes.push(outcome);
      if (outcome.kind === 'done') break;
    }

    expect(attempts).toEqual([
      'example.event-1',
      'example.event-2',
      'example.event-3',
      'promptiris.run.completed',
    ]);
    expect(outcomeTypes(outcomes)).toEqual([
      'example.event-1',
      'example.event-2',
      'example.event-3',
      'promptiris.run.completed',
      'done',
    ]);
    expect(outcomes[3]).toMatchObject({
      kind: 'event',
      event: { status: 'degraded', delivery: 'critical' },
    });
  });

  it('orders a parked read against a scheduled complete-versus-emit race', { timeout: 60_000 }, async () => {
    await runScheduled(
      'run-parked-race',
      [{ id: 'parked', capacity: 2 }],
      fc.constant<readonly ScheduledOp[]>([
        { kind: 'emit', delivery: 'critical', value: 1 },
        { kind: 'complete', status: 'cancelled' },
      ]),
      100,
      ['parked'],
    );
  });

  it('removes an observer disposed mid-delivery', async () => {
    const sink: Event[] = [];
    let disposed: Promise<IteratorResult<Event>> | undefined;
    const dispatcher = createEventDispatcher('run-mid-dispose', (event) => {
      sink.push(event);
      if (event.type === 'example.event-1') disposed = second.return();
    });
    const first = dispatcher.subscribe({ observerId: 'first', capacity: 4 });
    const second = dispatcher.subscribe({ observerId: 'second', capacity: 4 });

    dispatcher.emit(userEvent('critical', 1));
    dispatcher.emit(userEvent('critical', 2));
    dispatcher.complete('success');

    if (disposed === undefined) throw new Error('Expected the sink to dispose the observer');
    await expect(disposed).resolves.toEqual({ done: true, value: undefined });

    const firstOutcomes: ObservedOutcome[] = [];
    while (true) {
      const outcome = await readOutcome(first);
      firstOutcomes.push(outcome);
      if (outcome.kind === 'done') break;
    }
    expect(outcomeTypes(firstOutcomes)).toEqual([
      'example.event-1',
      'example.event-2',
      'promptiris.run.completed',
      'done',
    ]);
    await expect(readOutcome(second)).resolves.toEqual(DONE);
    expect(sink.map(({ type }) => type)).toEqual([
      'example.event-1',
      'example.event-2',
      'promptiris.run.completed',
    ]);
  });

  it('fans reentrant publication out to every observer exactly once', async () => {
    const sink: Event[] = [];
    const dispatcher = createEventDispatcher('run-reentrant-fanout', (event) => {
      sink.push(event);
      if (event.type === 'example.event-1') {
        dispatcher.emit(userEvent('progress', 2));
        dispatcher.complete('success');
      }
    });
    const first = dispatcher.subscribe({ observerId: 'first', capacity: 8 });
    const second = dispatcher.subscribe({ observerId: 'second', capacity: 4 });

    dispatcher.emit(userEvent('critical', 1));
    dispatcher.complete('failed');

    for (const subscription of [first, second]) {
      const outcomes: ObservedOutcome[] = [];
      while (true) {
        const outcome = await readOutcome(subscription);
        outcomes.push(outcome);
        if (outcome.kind === 'done') break;
      }
      expect(outcomeTypes(outcomes)).toEqual([
        'example.event-1',
        'example.event-2',
        'promptiris.run.completed',
        'done',
      ]);
      expect(outcomes[2]).toMatchObject({
        kind: 'event',
        event: { status: 'success', delivery: 'critical' },
      });
    }
    expect(sink.map(({ type }) => type)).toEqual([
      'example.event-1',
      'example.event-2',
      'promptiris.run.completed',
    ]);
    expect(() => dispatcher.emit(userEvent('critical', 3))).toThrow(/complete/i);
  });
});
