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
  readonly generations: ObservedOutcome[][];
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
  /** Dispatcher-set iteration order: subscribe appends, detach/dispose remove. */
  private readonly order: string[] = [];
  private readonly pending: {
    event: ObservedEvent;
    excluded: string | undefined;
    terminal: boolean;
  }[] = [];

  subscribe(id: string, capacity: number): void {
    const previous = this.observers.get(id);
    // A resubscribed id starts a new generation: the dispatcher's set drops
    // detached/disposed members and re-appends them, so prior history is
    // archived rather than extended.
    const generations =
      previous === undefined ? [] : [...previous.generations, previous.received];
    this.observers.set(id, {
      id,
      capacity,
      queue: [],
      received: [],
      generations,
      waiting: false,
      closed: false,
      dropReported: false,
    });
    this.live.add(id);
    this.order.push(id);
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
    this.removeFromOrder(id);
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
   * Whether the dispatcher still addresses the observer: a member of the
   * deliverable set (subscribed, not disposed, detached, or terminal-swept).
   * Detached observers stay readable (done) but no longer receive events.
   */
  isAddressed(id: string): boolean {
    return this.order.includes(id);
  }

  private removeFromOrder(id: string): void {
    const index = this.order.indexOf(id);
    if (index !== -1) this.order.splice(index, 1);
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
    for (const id of [...this.order]) {
      if (id === excluded) continue;
      const observer = this.require(id);
      outcomes.push({ observer, outcome: this.enqueue(observer, event) });
    }
    for (const { observer, outcome } of outcomes) this.report(observer, outcome);
    if (terminal) {
      for (const id of [...this.order]) this.close(this.require(id), false);
      this.order.length = 0;
      this.live.clear();
    }
  }

  private report(observer: ModelObserver, outcome: EnqueueOutcome): void {
    if (outcome === 'accepted') return;
    if (outcome === 'detached') this.removeFromOrder(observer.id);
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
      this.removeFromOrder(detached.id);
      this.pending.push({
        event: this.control(detached.id, true),
        excluded: detached.id,
        terminal: false,
      });
      lagging = this.findLagging();
    }
  }

  private findLagging(): ModelObserver | undefined {
    return this.order
      .map((id) => this.require(id))
      .find((observer) => !this.canAcceptCritical(observer));
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
  readonly archived = new Map<string, ObservedOutcome[][]>();
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
    // Subscribe first: a duplicate id throws before any harness state moves.
    const subscription = this.dispatcher.subscribe({ observerId: id, capacity });
    if (this.subscriptions.has(id)) {
      const previous = this.observed.get(id) ?? [];
      const generations = this.archived.get(id);
      if (generations === undefined) this.archived.set(id, [previous]);
      else generations.push(previous);
      this.observed.set(id, []);
    }
    this.subscriptions.set(id, subscription);
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

  /**
   * Await floatings that already resolved so their records land before any
   * later in-task record. Never waits for future resolutions (the tick wins
   * for unresolved floatings), so this cannot deadlock scheduled tasks.
   */
  async drainSettled(id: string): Promise<void> {
    const pending = this.floating.get(id);
    if (pending === undefined) return;
    await Promise.all(
      pending.map((outcome) => Promise.race([outcome, Promise.resolve(DONE)])),
    );
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
  /** Traversed read/emission paths, for deterministic aggregate assertions. */
  readonly paths = new Set<string>();

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
      this.paths.add('emit-throws');
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
    await this.real.drainSettled(id);
    if (this.model.isAvailable(id)) {
      this.paths.add('read-available');
      await this.readAvailable(id);
    } else if (this.model.isWaiting(id)) {
      this.paths.add('read-rejects');
      await expect(this.real.require(id).next()).rejects.toThrow(CONCURRENT_READ_ERROR);
    } else {
      this.paths.add('read-parks');
      this.model.park(id);
      this.real.park(id);
    }
  }

  async settle(status: CompletionStatus): Promise<void> {
    if (!this.model.completed) this.complete(status);
    // Completion resolves every parked waiter, so floatings settle here.
    await settleSoon(this.real.flushAllFloating(), 'floating reads');
    for (const id of [...this.model.observers.keys()].sort()) {
      while (true) {
        const expected = this.model.readAvailable(id);
        const actual = await settleSoon(readOutcome(this.real.require(id)), `drain for ${id}`);
        this.real.record(id, actual);
        expect(actual).toEqual(expected);
        if (expected.kind === 'done') break;
      }
    }
    expect(this.real.live).toEqual(this.model.live);
    for (const [id, observer] of this.model.observers) {
      expect(this.real.observed.get(id)).toEqual(observer.received);
      expect(this.real.archived.get(id) ?? []).toEqual(observer.generations);
      for (const generation of [observer.received, ...observer.generations]) {
        assertObserverWellFormed(generation);
      }
    }
    expect(this.real.sink.map(project)).toEqual(this.model.sink);
    assertSinkContiguous(this.real.sink.map(project));
  }
}

/**
 * Fail fast with a deadlock diagnosis instead of hanging to the test timeout:
 * every awaited harness promise resolves within milliseconds unless a defect
 * (or mutant) broke waiter resolution.
 */
async function settleSoon<T>(promise: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Deadlock suspected while awaiting ${what}`));
        }, 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function assertSinkContiguous(sink: ObservedEvent[]): void {
  expect(sink.map((event) => event.sequence)).toEqual(sink.map((_, index) => index));
}

function assertObserverWellFormed(outcomes: ObservedOutcome[]): void {
  // Archived generations are prefixes that may end mid-stream; only the
  // trailing-done shape is invariant: no event may follow a done, sequences
  // increase, and the terminal event (when present) comes last.
  const sequences: number[] = [];
  let seenTerminal = false;
  let seenDone = false;
  for (const outcome of outcomes) {
    if (outcome.kind === 'done') {
      seenDone = true;
      continue;
    }
    expect(seenDone).toBe(false);
    expect(seenTerminal).toBe(false);
    sequences.push(outcome.event.sequence);
    if (outcome.event.type === 'promptiris.run.completed') seenTerminal = true;
  }
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
    // Live subscriptions dispose mid-run; completed runs also dispose swept
    // subscriptions, which must still drain their retained queues (close is a
    // no-op on them, so disposal must not discard).
    return model.observers.has(this.id) && (model.live.has(this.id) || model.completed);
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
  ops: readonly ScheduledOp[],
): Promise<DualWorld> {
  const world = new DualWorld(runId);
  for (const { id, capacity } of observers) world.subscribe(id, capacity);
  // One single-item sequence per operation: unlike scheduleFunction (which
  // invokes eagerly in call order), sequence builders run at trigger time, so
  // the scheduler genuinely permutes execution order across runs.
  for (const op of ops) scheduler.scheduleSequence([() => applyScheduledOp(world, op)]);
  await scheduler.waitIdle();
  expect(scheduler.count()).toBe(0);
  return world;
}

/** Scheduler-permuted lockstep run with deterministic completion teardown. */
async function runScheduled(
  runId: string,
  observers: readonly { id: string; capacity: number }[],
  opsArb: fc.Arbitrary<readonly ScheduledOp[]>,
  numRuns: number,
): Promise<void> {
  await fc.assert(
    fc.asyncProperty(fc.scheduler(), opsArb, async (scheduler, ops) => {
      const world = await executeSchedule(scheduler, runId, observers, ops);
      await world.settle('success');
    }),
    { numRuns },
  );
}

/** Exhaustive explicit-permutation lockstep run (deterministic, no roulette). */
async function runPermutations(
  runIdPrefix: string,
  observers: readonly { id: string; capacity: number }[],
  prePark: readonly string[],
  permutations: readonly (readonly ScheduledOp[])[],
  settleStatus: CompletionStatus,
): Promise<DualWorld[]> {
  const worlds: DualWorld[] = [];
  let index = 0;
  for (const ops of permutations) {
    const world = new DualWorld(`${runIdPrefix}-${String(index++)}`);
    for (const { id, capacity } of observers) world.subscribe(id, capacity);
    for (const id of prePark) {
      world.model.park(id);
      world.real.park(id);
    }
    for (const op of ops) await applyScheduledOp(world, op);
    await world.settle(settleStatus);
    worlds.push(world);
  }
  return worlds;
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

/** Establish an indexed outcome as defined (Stryker-checker safe access). */
function at(outcomes: ObservedOutcome[], index: number): ObservedOutcome {
  const outcome = outcomes[index];
  if (outcome === undefined) throw new Error(`Missing outcome at index ${String(index)}`);
  return outcome;
}

function permutationsOf<T>(items: readonly T[]): T[][] {
  if (items.length === 0) return [[]];
  const [head, ...tail] = items;
  if (head === undefined) return [[]];
  const result: T[][] = [];
  for (const tailPermutation of permutationsOf(tail)) {
    for (let index = 0; index <= tailPermutation.length; index++) {
      result.push([
        ...tailPermutation.slice(0, index),
        head,
        ...tailPermutation.slice(index),
      ]);
    }
  }
  return result;
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
    expect(at(healthyOutcomes, 2)).toMatchObject({
      kind: 'event',
      event: { observer: 'lagging', delivery: 'critical' },
    });
    expect(at(healthyOutcomes, 4)).toMatchObject({
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

  it('rejects the read that loses every race order', async () => {
    const read: ScheduledOp = { kind: 'read', id: 'racer' };
    const emit: ScheduledOp = { kind: 'emit', delivery: 'critical', value: 1 };
    // The two reads are behaviorally identical, so deduplicate orders.
    const orders = [...new Map(permutationsOf([read, read, emit]).map((ops) => [JSON.stringify(ops), ops])).values()];
    expect(orders).toHaveLength(3);
    const worlds = await runPermutations(
      'run-read-race',
      [{ id: 'racer', capacity: 1 }],
      [],
      orders,
      'success',
    );
    // Exactly the order that parks the first read before the second runs
    // traverses the concurrent-read rejection; every order settles exactly.
    const rejecting = worlds.filter((world) => world.paths.has('read-rejects'));
    expect(rejecting).toHaveLength(1);
    for (const world of worlds) expect(world.paths.has('read-parks')).toBe(true);
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
    expect(at(outcomes, 3)).toMatchObject({
      kind: 'event',
      event: { status: 'degraded', delivery: 'critical' },
    });
  });

  it('resolves a parked read on either side of a complete-versus-emit race', async () => {
    const emit: ScheduledOp = { kind: 'emit', delivery: 'critical', value: 1 };
    const complete: ScheduledOp = { kind: 'complete', status: 'cancelled' };
    const worlds = await runPermutations(
      'run-parked-race',
      [{ id: 'parked', capacity: 2 }],
      ['parked'],
      permutationsOf([emit, complete]),
      'cancelled',
    );
    expect(worlds).toHaveLength(2);
    // Emission first: the waiter observes the event, then the terminal event.
    // Completion first: the waiter observes the terminal event and the
    // emission is rejected as post-terminal.
    const [emitFirst, completeFirst] = worlds;
    if (emitFirst === undefined || completeFirst === undefined) {
      throw new Error('Expected both race orders to run');
    }
    expect(outcomeTypes(emitFirst.real.observed.get('parked'))).toEqual([
      'example.event-1',
      'promptiris.run.completed',
      'done',
    ]);
    expect(emitFirst.paths.has('emit-throws')).toBe(false);
    expect(outcomeTypes(completeFirst.real.observed.get('parked'))).toEqual([
      'promptiris.run.completed',
      'done',
    ]);
    expect(completeFirst.paths.has('emit-throws')).toBe(true);
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
      expect(at(outcomes, 2)).toMatchObject({
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
