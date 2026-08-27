import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  ContentLengthDecoder,
  MAX_FRAME_BYTES,
  encodeMessage,
  type JsonRpcMessage,
} from '@meta-prompt/protocol';
import {
  definePlugin,
  type PluginImplementation,
  type PluginInvocation,
  type PluginManifest,
  type PluginRegistration,
} from '@meta-prompt/plugin-sdk';

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
}

interface NativePluginConfig {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly initializeTimeoutMs: number;
  readonly invocationTimeoutMs: number;
  readonly cancellationGraceMs: number;
}

interface RequestOptions {
  readonly child: ChildProcessWithoutNullStreams;
  readonly id: number;
  readonly timeoutMs: number;
  readonly cancellationGraceMs: number;
  readonly timeoutMessage: string;
  readonly signal?: AbortSignal;
}

const STDERR_TAIL_BYTES = 64 * 1024;
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
  });
}

function signalChild(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  if (child.exitCode === null && child.signalCode === null) child.kill(signal);
}

function isCapabilities(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const capabilities = value as { methods?: unknown; events?: unknown };
  return Array.isArray(capabilities.methods) && Array.isArray(capabilities.events);
}

function isLimits(value: unknown): boolean {
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
    child.once('error', this.#onProcessError);
    child.stdin.once('error', this.#onProcessError);
    signal?.addEventListener('abort', this.#onAbort, { once: true });
  }

  #cleanup(): void {
    const { child, signal } = this.#options;
    if (this.#timeout !== undefined) clearTimeout(this.#timeout);
    if (this.#grace !== undefined) clearTimeout(this.#grace);
    child.stdout.off('data', this.#onData);
    child.off('exit', this.#onExit);
    child.off('error', this.#onProcessError);
    child.stdin.off('error', this.#onProcessError);
    signal?.removeEventListener('abort', this.#onAbort);
  }

  #finishResult(value: unknown): void {
    if (this.#settled) return;
    this.#settled = true;
    this.#cleanup();
    this.#resolve?.(value);
  }

  #finishError(message: string): void {
    if (this.#settled) return;
    this.#settled = true;
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
    if (this.#settled || this.#cancellationMessage !== undefined) return;
    this.#cancellationMessage = 'Native plugin protocol error';
    if (this.#timeout !== undefined) clearTimeout(this.#timeout);
    void stopChild(this.#options.child, this.#options.cancellationGraceMs).finally(() => {
      this.#finishError('Native plugin protocol error');
    });
  }

  #cancel(message: string): void {
    if (this.#settled || this.#cancellationMessage !== undefined) return;
    this.#cancellationMessage = message;
    if (this.#timeout !== undefined) clearTimeout(this.#timeout);
    this.#write({
      jsonrpc: '2.0',
      method: 'plugin/cancel',
      params: { id: this.#options.id },
    });
    this.#grace = setTimeout(() => {
      void stopChild(this.#options.child, this.#options.cancellationGraceMs).finally(() => {
        this.#finishError(message);
      });
    }, this.#options.cancellationGraceMs);
  }

  #write(message: JsonRpcMessage): void {
    try {
      this.#options.child.stdin.write(encodeMessage(message), (error) => {
        if (error) this.#finishError('Native plugin process exited');
      });
    } catch {
      this.#finishError('Native plugin process exited');
    }
  }
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (exited: boolean): void => {
      clearTimeout(timeout);
      child.off('exit', onExit);
      resolve(exited);
    };
    const onExit = (): void => finish(true);
    const timeout = setTimeout(() => finish(false), timeoutMs);
    child.once('exit', onExit);
  });
}

async function stopChild(child: ChildProcessWithoutNullStreams, graceMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  signalChild(child, 'SIGTERM');
  if (await waitForExit(child, graceMs)) return;
  signalChild(child, 'SIGKILL');
  await waitForExit(child, graceMs);
}

class NativePluginSupervisor {
  readonly #config: NativePluginConfig;
  #child: ChildProcessWithoutNullStreams | undefined;
  #nextId = 0;
  #inFlight = false;
  #stderrTail = Buffer.alloc(0);

  constructor(config: NativePluginConfig) {
    this.#config = config;
  }

  async initialize(): Promise<void> {
    await this.#ensureChild();
  }

  async invoke(invocation: PluginInvocation): Promise<unknown> {
    if (this.#inFlight) throw safeError('Native plugin concurrent invocation denied');
    this.#inFlight = true;
    let child: ChildProcessWithoutNullStreams | undefined;
    try {
      child = await this.#ensureChild();
      const result = await this.#request(
        child,
        'plugin/invoke',
        { contributionId: invocation.contributionId, input: invocation.input },
        this.#config.invocationTimeoutMs,
        'Native plugin invocation timed out',
        invocation.signal,
      );
      await this.#shutdown(child);
      return result;
    } catch (error) {
      if (child !== undefined) {
        await stopChild(child, this.#config.cancellationGraceMs);
      }
      this.#child = undefined;
      throw error instanceof Error && error.message.startsWith('Native plugin')
        ? error
        : safeError('Native plugin process exited');
    } finally {
      this.#inFlight = false;
    }
  }

  async #ensureChild(): Promise<ChildProcessWithoutNullStreams> {
    if (
      this.#child !== undefined &&
      this.#child.exitCode === null &&
      this.#child.signalCode === null
    ) {
      return this.#child;
    }
    this.#child = await this.#spawnInitialized();
    return this.#child;
  }

  async #spawnInitialized(): Promise<ChildProcessWithoutNullStreams> {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.#config.command, [...this.#config.args], {
        cwd: this.#config.cwd,
        env: { ...this.#config.environment },
        shell: false,
        stdio: 'pipe',
      });
    } catch {
      throw safeError('Native plugin process exited');
    }
    child.stderr.on('data', this.#captureStderr);
    child.on('error', () => undefined);
    child.stdin.on('error', () => undefined);
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

  async #shutdown(child: ChildProcessWithoutNullStreams): Promise<void> {
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
      throw error instanceof Error && error.message.startsWith('Native plugin')
        ? error
        : safeError('Native plugin protocol error');
    } finally {
      if (this.#child === child) this.#child = undefined;
    }
  }

  #request(
    child: ChildProcessWithoutNullStreams,
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

  readonly #captureStderr = (chunk: Buffer): void => {
    const combined = Buffer.concat([this.#stderrTail, chunk]);
    this.#stderrTail =
      combined.byteLength <= STDERR_TAIL_BYTES
        ? combined
        : combined.subarray(combined.byteLength - STDERR_TAIL_BYTES);
  };
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
        invoke(invocation: PluginInvocation): Promise<unknown> {
          return supervisor.invoke(invocation);
        },
      });
    },
  });
}
