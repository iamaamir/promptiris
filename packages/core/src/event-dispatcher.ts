import { randomUUID } from 'node:crypto';
import type { Event, RunResult } from '@promptiris/protocol';
import type { RunContext } from '@promptiris/plugin-sdk';

/** @public */
export interface EventSubscriptionOptions {
  readonly observerId: string;
  readonly capacity?: number;
}

/** @public */
export interface EventSubscription extends AsyncIterableIterator<Event>, AsyncDisposable {
  readonly observerId: string;
  return(): Promise<IteratorResult<Event>>;
}

/** @public */
export interface EventDispatcher extends RunContext {
  subscribe(options: EventSubscriptionOptions): EventSubscription;
  complete(status: RunResult['status']): void;
}

interface SubscriptionOwner {
  remove(subscription: BufferedSubscription): void;
}

type EnqueueOutcome = 'accepted' | 'progress-dropped' | 'detached';

interface PendingEvent {
  readonly event: Event;
  readonly excludedObserverId: string | undefined;
  readonly terminal: boolean;
}

interface SubscriptionOutcome {
  readonly observerId: string;
  readonly outcome: EnqueueOutcome;
  readonly subscription: BufferedSubscription;
}

class BufferedSubscription implements EventSubscription {
  readonly observerId: string;
  readonly #capacity: number;
  readonly #owner: SubscriptionOwner;
  readonly #queue: Event[] = [];
  #waiting: ((result: IteratorResult<Event>) => void) | undefined;
  #closed = false;
  #dropReported = false;

  constructor(options: EventSubscriptionOptions, owner: SubscriptionOwner) {
    this.observerId = options.observerId;
    this.#capacity = options.capacity ?? 64;
    this.#owner = owner;
    if (!Number.isSafeInteger(this.#capacity) || this.#capacity <= 0) {
      throw new RangeError('Event subscription capacity must be a positive safe integer');
    }
  }

  [Symbol.asyncIterator](): EventSubscription {
    return this;
  }

  next(): Promise<IteratorResult<Event>> {
    const event = this.#queue.shift();
    if (event !== undefined) {
      if (this.#queue.length < this.#capacity) this.#dropReported = false;
      return Promise.resolve({ done: false, value: event });
    }
    if (this.#closed) return Promise.resolve({ done: true, value: undefined });
    if (this.#waiting !== undefined) {
      return Promise.reject(new Error('Concurrent Event subscription reads are not supported'));
    }
    return new Promise((resolve) => {
      this.#waiting = resolve;
    });
  }

  return(): Promise<IteratorResult<Event>> {
    this.#close(true);
    this.#owner.remove(this);
    return Promise.resolve({ done: true, value: undefined });
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.return();
  }

  enqueue(event: Event): EnqueueOutcome {
    if (this.#closed) return 'detached';
    if (this.#waiting !== undefined) {
      const resolve = this.#waiting;
      this.#waiting = undefined;
      resolve({ done: false, value: event });
      return 'accepted';
    }
    if (this.#queue.length < this.#capacity) {
      this.#queue.push(event);
      return 'accepted';
    }
    if (event.delivery === 'progress') {
      if (this.#dropReported) return 'accepted';
      this.#dropReported = true;
      return 'progress-dropped';
    }
    this.#close(true);
    return 'detached';
  }

  complete(): void {
    this.#close(false);
  }

  canAcceptCritical(): boolean {
    return this.#waiting !== undefined || this.#queue.length < this.#capacity;
  }

  detach(): void {
    this.#close(true);
  }

  #close(discard: boolean): void {
    if (this.#closed) return;
    this.#closed = true;
    if (discard) this.#queue.length = 0;
    const resolve = this.#waiting;
    this.#waiting = undefined;
    if (this.#queue.length === 0) resolve?.({ done: true, value: undefined });
  }
}

class StandardEventDispatcher implements EventDispatcher, SubscriptionOwner {
  readonly runId: string;
  readonly #sink: (event: Event) => void;
  readonly #subscriptions = new Set<BufferedSubscription>();
  readonly #pending: PendingEvent[] = [];
  #sequence = 0;
  #accepting = true;
  #publishing = false;
  #completionStatus: RunResult['status'] | undefined;

  constructor(runId: string, sink: (event: Event) => void) {
    this.runId = runId;
    this.#sink = sink;
  }

  emit(event: Parameters<RunContext['emit']>[0]): void {
    if (!this.#accepting) throw new Error('Event dispatcher is complete');
    this.#dispatch(this.#stamp(event));
  }

  subscribe(options: EventSubscriptionOptions): EventSubscription {
    if (!this.#accepting) throw new Error('Event dispatcher is complete');
    if ([...this.#subscriptions].some(({ observerId }) => observerId === options.observerId)) {
      throw new Error(`Duplicate Event observer id: ${options.observerId}`);
    }
    const subscription = new BufferedSubscription(options, this);
    this.#subscriptions.add(subscription);
    return subscription;
  }

  complete(status: RunResult['status']): void {
    if (!this.#accepting) return;
    this.#accepting = false;
    this.#completionStatus = status;
    this.#drain();
  }

  remove(subscription: BufferedSubscription): void {
    this.#subscriptions.delete(subscription);
  }

  #prepareTerminal(): void {
    let lagging = [...this.#subscriptions].find(
      (subscription) => !subscription.canAcceptCritical(),
    );
    while (lagging !== undefined) {
      lagging.detach();
      this.#subscriptions.delete(lagging);
      this.#dispatch(
        this.#stamp({
          type: 'promptiris.observer.detached',
          source: 'core',
          dataSchema: 'promptiris/event/observer-detached-v1',
          data: { observerId: lagging.observerId },
          classification: 'metadata',
          delivery: 'critical',
        }),
        lagging.observerId,
      );
      lagging = [...this.#subscriptions].find((subscription) => !subscription.canAcceptCritical());
    }
  }

  #stamp(event: Parameters<RunContext['emit']>[0]): Event {
    return Object.freeze({
      ...event,
      schemaVersion: '1',
      id: randomUUID(),
      time: new Date().toISOString(),
      sequence: this.#sequence++,
      runId: this.runId,
      traceId: this.runId,
    });
  }

  #dispatch(event: Event, excludedObserverId?: string): void {
    this.#pending.push({ event, excludedObserverId, terminal: false });
    this.#drain();
  }

  #drain(): void {
    if (this.#publishing) return;
    this.#publishing = true;
    try {
      while (true) {
        const pending = this.#pending.shift();
        if (pending !== undefined) {
          this.#deliver(pending);
          continue;
        }
        const status = this.#completionStatus;
        if (status === undefined) break;
        this.#completionStatus = undefined;
        this.#prepareTerminal();
        this.#pending.push({
          event: this.#terminalEvent(status),
          excludedObserverId: undefined,
          terminal: true,
        });
      }
    } finally {
      this.#publishing = false;
    }
  }

  #deliver({ event, excludedObserverId, terminal }: PendingEvent): void {
    try {
      this.#sink(event);
    } catch {
      // External observers cannot alter Run control flow.
    }
    const outcomes: SubscriptionOutcome[] = [];
    for (const subscription of this.#subscriptions) {
      if (subscription.observerId === excludedObserverId) continue;
      outcomes.push({
        observerId: subscription.observerId,
        outcome: subscription.enqueue(event),
        subscription,
      });
    }
    for (const outcome of outcomes) this.#report(outcome);
    if (terminal) {
      for (const subscription of this.#subscriptions) subscription.complete();
      this.#subscriptions.clear();
    }
  }

  #report({ observerId, outcome, subscription }: SubscriptionOutcome): void {
    if (outcome === 'accepted') return;
    if (outcome === 'detached') this.#subscriptions.delete(subscription);
    const type =
      outcome === 'progress-dropped'
        ? 'promptiris.observer.progress-dropped'
        : 'promptiris.observer.detached';
    this.#dispatch(
      this.#stamp({
        type,
        source: 'core',
        dataSchema: `promptiris/event/${type.replace('promptiris.', '').replaceAll('.', '-')}-v1`,
        data: { observerId },
        classification: 'metadata',
        delivery: 'critical',
      }),
      observerId,
    );
  }

  #terminalEvent(status: RunResult['status']): Event {
    return this.#stamp({
      type: 'promptiris.run.completed',
      source: 'core',
      dataSchema: 'promptiris/event/run-completed-v1',
      data: { status },
      classification: 'metadata',
      delivery: 'critical',
    });
  }
}

/** @public */
export function createEventDispatcher(
  runId: string,
  sink: (event: Event) => void = () => undefined,
): EventDispatcher {
  return new StandardEventDispatcher(runId, sink);
}
