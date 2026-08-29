/** @public */
export type RunTermination = 'active' | 'cancelled' | 'timed-out';

/** @public */
export interface RunLifetimeOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

/** @public */
export interface RunLifetime extends Disposable {
  readonly signal: AbortSignal;
  readonly termination: RunTermination;
}

class OwnedRunLifetime implements RunLifetime {
  readonly #controller = new AbortController();
  readonly #parent: AbortSignal | undefined;
  readonly #timeout: ReturnType<typeof setTimeout> | undefined;
  #termination: RunTermination = 'active';
  #disposed = false;

  constructor(options: RunLifetimeOptions) {
    this.#parent = options.signal;
    const timeoutMs = options.timeoutMs;
    if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
      throw new RangeError('Run timeout must be a positive finite duration');
    }
    if (this.#parent?.aborted) this.#terminate('cancelled');
    else this.#parent?.addEventListener('abort', this.#onParentAbort, { once: true });
    this.#timeout =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => this.#terminate('timed-out'), timeoutMs);
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  get termination(): RunTermination {
    return this.#termination;
  }

  [Symbol.dispose](): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#parent?.removeEventListener('abort', this.#onParentAbort);
    if (this.#timeout !== undefined) clearTimeout(this.#timeout);
  }

  readonly #onParentAbort = (): void => this.#terminate('cancelled');

  #terminate(termination: Exclude<RunTermination, 'active'>): void {
    if (this.#termination !== 'active') return;
    this.#termination = termination;
    this.#controller.abort();
  }
}

/** @public */
export function createRunLifetime(options: RunLifetimeOptions = {}): RunLifetime {
  return new OwnedRunLifetime(options);
}
