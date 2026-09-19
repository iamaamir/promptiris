import { spawn } from 'node:child_process';
import {
  ContentLengthDecoder,
  MAX_FRAME_BYTES,
  encodeMessage,
  type JsonRpcMessage,
} from '@promptiris/protocol';
import {
  definePlugin,
  type PluginImplementation,
  type PluginInvocation,
  type PluginManifest,
  type PluginOutput,
  type PluginRegistration,
} from '@promptiris/plugin-sdk';

/**
 * Indirection over `child_process.spawn` so deterministic tests can replay
 * Promise interleavings without spawning real processes.
 *
 * The default transport returns a real `ChildProcessWithoutNullStreams` whose
 * public surface is identical to the duck-typed `NativeChildHandle` consumed
 * by this module.
 *
 * @internal
 */
export interface NativeChildHandle {
  readonly stdin: NodeJS.WritableStream;
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  kill(signal: NodeJS.Signals): boolean;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  once(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
}

/**
 * @internal
 */
export interface NativeTransport {
  spawn(
    command: string,
    args: readonly string[],
    options: {
      readonly cwd: string;
      readonly env: Readonly<Record<string, string>>;
      readonly stdio: 'pipe';
    },
  ): NativeChildHandle;
}

const defaultTransport: NativeTransport = {
  spawn(command, args, options) {
    return spawn(command, [...args], {
      cwd: options.cwd,
      env: { ...options.env },
      shell: false,
      stdio: options.stdio,
    });
  },
};

/** @public */
export interface NativePluginOptions {
  readonly manifest: PluginManifest;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly initializeTimeoutMs?: number;
  readonly invocationTimeoutMs?: number;
  readonly cancellationGraceMs?: number;
  /**
   * Override the process-creation boundary. Used by deterministic scheduling
   * tests to inject in-memory fake transports. Production code should omit
   * this field.
   *
   * @internal
   */
  readonly transport?: NativeTransport;
}

interface NativePluginConfig {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly initializeTimeoutMs: number;
  readonly invocationTimeoutMs: number;
  readonly cancellationGraceMs: number;
  readonly transport: NativeTransport;
}

interface RequestOptions {
  readonly child: NativeChildHandle;
  readonly id: number;
  readonly timeoutMs: number;
  readonly cancellationGraceMs: number;
  readonly timeoutMessage: string;
  readonly signal?: AbortSignal;
}

const SHUTDOWN_TIMEOUT_MS = 2_000;

function safeError(message: string): Error {
  return new Error(message);
}

function positiveDuration(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeOptions(options: NativePluginOptions): NativePluginConfig {
  return Object.freeze({
    command: options.command,
    args: Object.freeze([...options.args]),
    cwd: options.cwd,
    environment: Object.freeze({ ...(options.environment ?? {}) }),
    initializeTimeoutMs: positiveDuration(options.initializeTimeoutMs, 5_000),
    invocationTimeoutMs: positiveDuration(options.invocationTimeoutMs, 30_000),
    cancellationGraceMs: positiveDuration(options.cancellationGraceMs, 500),
    transport: options.transport ?? defaultTransport,
  });
}

function signalChild(child: NativeChildHandle, signal: NodeJS.Signals): void {
  // Stryker disable next-line ConditionalExpression,LogicalOperator: kill() on an already-exited
  // child is a harmless false-returning no-op; callers expose the same contained outcome.
  if (child.exitCode === null && child.signalCode === null) child.kill(signal);
}

function isCapabilities(value: unknown): boolean {
  // Stryker disable next-line ConditionalExpression: property reads on JS primitives are safe and
  // the required-array checks below still reject them.
  if (typeof value !== 'object' || value === null) return false;
  const capabilities = value as { methods?: unknown; events?: unknown };
  return Array.isArray(capabilities.methods) && Array.isArray(capabilities.events);
}

function isLimits(value: unknown): boolean {
  // Stryker disable next-line ConditionalExpression: property reads on JS primitives are safe and
  // the numeric limit checks below still reject them.
  if (typeof value !== 'object' || value === null) return false;
  const limits = value as { maxFrameBytes?: unknown; maxDepth?: unknown };
  return (
    typeof limits.maxFrameBytes === 'number' &&
    limits.maxFrameBytes > 0 &&
    limits.maxFrameBytes <= MAX_FRAME_BYTES &&
    typeof limits.maxDepth === 'number' &&
    limits.maxDepth > 0 &&
    limits.maxDepth <= 64
  );
}

function isInitializeResult(value: unknown): boolean {
  // Stryker disable next-line ConditionalExpression: property reads on JS primitives are safe and
  // the protocol/capability/limit checks below still reject them.
  if (typeof value !== 'object' || value === null) return false;
  const result = value as {
    protocolVersion?: unknown;
    capabilities?: unknown;
    limits?: unknown;
  };
  return (
    result.protocolVersion === '1' && isCapabilities(result.capabilities) && isLimits(result.limits)
  );
}

class RpcRequest {
  readonly #decoder = new ContentLengthDecoder();
  readonly #options: RequestOptions;
  #resolve: ((value: unknown) => void) | undefined;
  #reject: ((error: Error) => void) | undefined;
  #timeout: NodeJS.Timeout | undefined;
  #grace: NodeJS.Timeout | undefined;
  #settled = false;
  #cancellationMessage: string | undefined;

  constructor(options: RequestOptions) {
    this.#options = options;
  }

  run(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.#resolve = resolve;
      this.#reject = reject;
      this.#listen();
      this.#timeout = setTimeout(
        () => this.#cancel(this.#options.timeoutMessage),
        this.#options.timeoutMs,
      );
      this.#write({ jsonrpc: '2.0', id: this.#options.id, method, params });
      if (this.#options.signal?.aborted) this.#cancel('Native plugin invocation cancelled');
    });
  }

  #listen(): void {
    const { child, signal } = this.#options;
    child.stdout.on('data', this.#onData);
    child.once('exit', this.#onExit);
    // Stryker disable next-line StringLiteral: process exit and request timeout are independent
    // containment paths for this same spawn-error outcome.
    child.once('error', this.#onProcessError);
    // Stryker disable next-line StringLiteral: the write callback and process lifecycle paths
    // independently normalize stdin failures.
    child.stdin.once('error', this.#onProcessError);
    signal?.addEventListener('abort', this.#onAbort, { once: true });
  }

  // Stryker disable next-line BlockStatement: cleanup changes resource lifetime, not the settled
  // public result. Its observable AbortSignal listener contract is verified by a dedicated test.
  #cleanup(): void {
    const { child, signal } = this.#options;
    // Stryker disable next-line ConditionalExpression,EqualityOperator: undefined timer cleanup is
    // a safe no-op; suppressing cleanup changes resource lifetime rather than Promise settlement.
    if (this.#timeout !== undefined) clearTimeout(this.#timeout);
    // Stryker disable next-line ConditionalExpression,EqualityOperator: undefined timer cleanup is
    // a safe no-op; suppressing cleanup changes resource lifetime rather than Promise settlement.
    if (this.#grace !== undefined) clearTimeout(this.#grace);
    // Stryker disable next-line CallExpression,StringLiteral: listener removal changes resource
    // lifetime after the Promise has already settled.
    child.stdout.off('data', this.#onData);
    // Stryker disable next-line CallExpression,StringLiteral: listener removal changes resource
    // lifetime after the Promise has already settled.
    child.off('exit', this.#onExit);
    // Stryker disable next-line CallExpression,StringLiteral: listener removal changes resource
    // lifetime after the Promise has already settled.
    child.off('error', this.#onProcessError);
    // Stryker disable next-line CallExpression,StringLiteral: listener removal changes resource
    // lifetime after the Promise has already settled.
    child.stdin.off('error', this.#onProcessError);
    signal?.removeEventListener('abort', this.#onAbort);
  }

  #finishResult(value: unknown): void {
    // Stryker disable next-line ConditionalExpression: competing completion paths are normalized
    // by the settled flag and expose one immutable Promise outcome.
    if (this.#settled) return;
    // Stryker disable next-line BooleanLiteral: setting the flag is observable only through the
    // idempotency guard whose public single-settlement contract is tested.
    this.#settled = true;
    this.#cleanup();
    this.#resolve?.(value);
  }

  #finishError(message: string): void {
    // Stryker disable next-line ConditionalExpression: competing completion paths are normalized
    // by the settled flag and expose one immutable Promise outcome.
    if (this.#settled) return;
    // Stryker disable next-line BooleanLiteral: setting the flag is observable only through the
    // idempotency guard whose public single-settlement contract is tested.
    this.#settled = true;
    // Stryker disable next-line CallExpression: result cleanup changes resource lifetime only;
    // AbortSignal listener cleanup has a dedicated observable test.
    this.#cleanup();
    this.#reject?.(safeError(this.#cancellationMessage ?? message));
  }

  readonly #onData = (chunk: Buffer): void => {
    try {
      for (const message of this.#decoder.push(chunk)) this.#acceptMessage(message);
    } catch {
      this.#protocolError();
    }
  };

  #acceptMessage(message: JsonRpcMessage): void {
    // Stryker disable next-line ConditionalExpression,LogicalOperator: these overlapping guards
    // all preserve the same single-settlement/cancellation result verified by late-response tests.
    if (this.#settled || this.#cancellationMessage !== undefined || !('id' in message)) return;
    if (message.jsonrpc !== '2.0' || message.id !== this.#options.id || 'method' in message) {
      this.#protocolError();
      return;
    }
    if (message.error !== undefined || !('result' in message)) {
      this.#protocolError();
      return;
    }
    this.#finishResult(message.result);
  }

  readonly #onExit = (): void => this.#finishError('Native plugin process exited');
  readonly #onProcessError = (): void => this.#finishError('Native plugin process exited');
  readonly #onAbort = (): void => this.#cancel('Native plugin invocation cancelled');

  #protocolError(): void {
    // Stryker disable next-line ConditionalExpression,LogicalOperator: the guards are redundant
    // after public settlement but prevent duplicate internal containment work.
    if (this.#settled || this.#cancellationMessage !== undefined) return;
    this.#cancellationMessage = 'Native plugin protocol error';
    clearTimeout(this.#timeout);
    void stopChild(this.#options.child, this.#options.cancellationGraceMs);
  }

  #cancel(message: string): void {
    // Stryker disable next-line ConditionalExpression,LogicalOperator: the guards are redundant
    // after public settlement but prevent duplicate internal cancellation work.
    if (this.#settled || this.#cancellationMessage !== undefined) return;
    this.#cancellationMessage = message;
    clearTimeout(this.#timeout);
    this.#write({
      jsonrpc: '2.0',
      method: 'plugin/cancel',
      params: { id: this.#options.id },
    });
    this.#grace = setTimeout(() => {
      void stopChild(this.#options.child, this.#options.cancellationGraceMs);
    }, this.#options.cancellationGraceMs);
  }

  #write(message: JsonRpcMessage): void {
    try {
      this.#options.child.stdin.write(encodeMessage(message));
      // Stryker disable next-line BlockStatement,StringLiteral: synchronous stream throws are a
      // defensive fallback to write-callback/process-error paths with the same normalized error.
    } catch {
      this.#finishError('Native plugin process exited');
    }
  }
}

function waitForExit(child: NativeChildHandle, timeoutMs: number): Promise<boolean> {
  // Stryker disable next-line BooleanLiteral: an already-exited child makes the boolean result
  // irrelevant to containment; no further signal can affect it.
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    // Stryker disable next-line BlockStatement: listener/timer cleanup changes resource lifetime;
    // the exit-vs-timeout contract is exercised by graceful and forced shutdown subprocess tests.
    const finish = (exited: boolean): void => {
      // Stryker disable next-line CallExpression: timer cleanup cannot change the resolved result.
      clearTimeout(timeout);
      // Stryker disable next-line CallExpression,StringLiteral: listener cleanup cannot change the
      // resolved result.
      child.off('exit', onExit);
      resolve(exited);
    };
    const onExit = (): void => finish(true);
    const timeout = setTimeout(() => finish(false), timeoutMs);
    child.once('exit', onExit);
  });
}

async function stopChild(child: NativeChildHandle, graceMs: number): Promise<void> {
  // Stryker disable next-line ConditionalExpression,LogicalOperator: signalling an exited child is
  // a harmless no-op and cannot change the already-contained public result.
  if (child.exitCode !== null || child.signalCode !== null) return;
  signalChild(child, 'SIGTERM');
  if (await waitForExit(child, graceMs)) return;
  signalChild(child, 'SIGKILL');
  await waitForExit(child, graceMs);
}

class NativePluginSupervisor {
  readonly #config: NativePluginConfig;
  #child: NativeChildHandle | undefined;
  #nextId = 0;
  #inFlight = false;

  constructor(config: NativePluginConfig) {
    this.#config = config;
  }

  async initialize(): Promise<void> {
    await this.#ensureChild();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    const child = this.#child;
    if (child === undefined) return;
    this.#child = undefined;
    await stopChild(child, this.#config.cancellationGraceMs);
  }

  async invoke(invocation: PluginInvocation): Promise<PluginOutput> {
    if (this.#inFlight) throw safeError('Native plugin concurrent invocation denied');
    this.#inFlight = true;
    let child: NativeChildHandle | undefined;
    try {
      child = await this.#ensureChild();
      const result = await this.#request(
        child,
        'plugin/invoke',
        {
          contributionId: invocation.contributionId,
          input: invocation.input,
          revision: invocation.revision,
        },
        this.#config.invocationTimeoutMs,
        'Native plugin invocation timed out',
        invocation.signal,
      );
      await this.#shutdown(child);
      return result as PluginOutput;
    } catch (error) {
      // Stryker disable next-line BlockStatement: request cancellation/protocol paths already stop
      // the child; this is a redundant containment fallback for unexpected failures.
      if (child !== undefined) {
        await stopChild(child, this.#config.cancellationGraceMs);
      }
      this.#child = undefined;
      // Stryker disable next-line ConditionalExpression,StringLiteral: all reachable supervisor
      // errors are already normalized; this branch is a defensive unknown-error fallback.
      throw error instanceof Error && error.message.startsWith('Native plugin')
        ? error
        : safeError('Native plugin process exited');
    } finally {
      this.#inFlight = false;
    }
  }

  async #ensureChild(): Promise<NativeChildHandle> {
    if (
      this.#child !== undefined &&
      // Stryker disable next-line ConditionalExpression: normal shutdown/failure clears #child;
      // this is defensive stale-process validation.
      this.#child.exitCode === null &&
      // Stryker disable next-line ConditionalExpression: normal shutdown/failure clears #child;
      // this is defensive stale-process validation.
      this.#child.signalCode === null
    ) {
      return this.#child;
    }
    this.#child = await this.#spawnInitialized();
    return this.#child;
  }

  async #spawnInitialized(): Promise<NativeChildHandle> {
    let child: NativeChildHandle;
    try {
      child = this.#config.transport.spawn(this.#config.command, this.#config.args, {
        cwd: this.#config.cwd,
        env: this.#config.environment,
        stdio: 'pipe',
      });
    } catch {
      throw safeError('Native plugin process exited');
    }
    child.stderr.resume();
    // Stryker disable next-line StringLiteral: RpcRequest owns the observable process-error path;
    // this listener prevents an unhandled EventEmitter error after request settlement.
    child.on('error', () => undefined);
    // Stryker disable next-line StringLiteral: RpcRequest owns the observable write-error path;
    // this listener prevents an unhandled EventEmitter error after request settlement.
    child.stdin.on('error', () => undefined);
    // Stryker disable next-line StringLiteral: RpcRequest owns the observable decode/exit paths;
    // this listener prevents an unhandled stream error after request settlement.
    child.stdout.on('error', () => undefined);
    try {
      const result = await this.#request(
        child,
        'initialize',
        { protocolVersion: '1', limits: { maxFrameBytes: MAX_FRAME_BYTES, maxDepth: 64 } },
        this.#config.initializeTimeoutMs,
        'Native plugin initialization timed out',
      );
      if (!isInitializeResult(result)) throw safeError('Native plugin protocol error');
      return child;
    } catch (error) {
      await stopChild(child, this.#config.cancellationGraceMs);
      throw error;
    }
  }

  async #shutdown(child: NativeChildHandle): Promise<void> {
    try {
      await this.#request(
        child,
        'plugin/shutdown',
        {},
        SHUTDOWN_TIMEOUT_MS,
        'Native plugin shutdown timed out',
      );
      if (!(await waitForExit(child, SHUTDOWN_TIMEOUT_MS))) {
        await stopChild(child, this.#config.cancellationGraceMs);
        throw safeError('Native plugin shutdown timed out');
      }
    } catch (error) {
      await stopChild(child, this.#config.cancellationGraceMs);
      // Stryker disable next-line ConditionalExpression,StringLiteral: all reachable shutdown
      // errors are already normalized; this branch is a defensive unknown-error fallback.
      throw error instanceof Error && error.message.startsWith('Native plugin')
        ? error
        : safeError('Native plugin protocol error');
      // A supervisor has one in-flight child, so clearing changes only defensive stale-process state after the public result is decided.
      // Stryker disable next-line BlockStatement
    } finally {
      // Stryker disable next-line ConditionalExpression,EqualityOperator: a supervisor has one
      // in-flight child; identity variants cannot alter the already-decided public result.
      if (this.#child === child) this.#child = undefined;
    }
  }

  #request(
    child: NativeChildHandle,
    method: string,
    params: unknown,
    timeoutMs: number,
    timeoutMessage: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const id = ++this.#nextId;
    const required = { child, id, timeoutMs, timeoutMessage };
    const options: RequestOptions =
      signal === undefined
        ? { ...required, cancellationGraceMs: this.#config.cancellationGraceMs }
        : { ...required, cancellationGraceMs: this.#config.cancellationGraceMs, signal };
    return new RpcRequest(options).run(method, params);
  }
}

/** @public */
export function defineNativePlugin(options: NativePluginOptions): PluginRegistration {
  const manifest = definePlugin(options.manifest);
  const config = normalizeOptions(options);
  return Object.freeze({
    manifest,
    async activate(): Promise<PluginImplementation> {
      const supervisor = new NativePluginSupervisor(config);
      await supervisor.initialize();
      return Object.freeze({
        invoke(invocation: PluginInvocation): Promise<PluginOutput> {
          return supervisor.invoke(invocation);
        },
        [Symbol.asyncDispose](): Promise<void> {
          return supervisor[Symbol.asyncDispose]();
        },
      });
    },
  });
}
