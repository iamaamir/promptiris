import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compilePluginGraph, createRunContext, executePluginPlan } from '@meta-prompt/core';
import { makeTextDocument } from '@meta-prompt/protocol';
import type { PluginManifest } from '@meta-prompt/plugin-sdk';
import { defineNativePlugin } from './native-plugin.js';

const fixture = fileURLToPath(new URL('../test/fixtures/native-plugin.mjs', import.meta.url));
const manifest: PluginManifest = {
  id: 'fixture/native',
  version: '1.0.0',
  type: 'pipeline',
  contributions: [{ id: 'native-transform', phase: 'transform' }],
};

function native(mode: string, options: Record<string, unknown> = {}) {
  return defineNativePlugin({
    manifest,
    command: process.execPath,
    args: [fixture, mode],
    cwd: dirname(fixture),
    ...options,
  });
}

function invocation(signal = new AbortController().signal) {
  return {
    contributionId: 'native-transform',
    input: makeTextDocument('input'),
    signal,
  };
}

async function capturedFailure(operation: Promise<unknown>): Promise<string> {
  try {
    await operation;
  } catch (error) {
    return String(error);
  }
  throw new Error('Expected native operation to fail');
}

describe('defineNativePlugin', () => {
  it('does not start a process until activation and invokes a framed plugin', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'meta-prompt-native-lazy-'));
    try {
      const marker = join(directory, 'processes');
      const registration = native('happy', { args: [fixture, 'happy', marker] });

      await expect(readFile(marker, 'utf8')).rejects.toThrow();
      const implementation = await registration.activate();
      await expect(readFile(marker, 'utf8')).resolves.toBe('started\n');
      await expect(implementation.invoke(invocation())).resolves.toMatchObject({
        content: [{ text: 'input' }, { text: 'native' }],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects malformed framed output without exposing raw output', async () => {
    const implementation = await native('malformed').activate();

    const failure = await capturedFailure(implementation.invoke(invocation()));

    expect(failure).toMatch(/native plugin protocol/i);
    expect(failure).not.toContain('{native fixture malformed');
  });

  it('rejects an invalid initialization response and terminates the process', async () => {
    const failure = await capturedFailure(Promise.resolve(native('wrong-initialize').activate()));

    expect(failure).toMatch(/native plugin protocol/i);
  });

  it('rejects wrong JSON-RPC versions during initialization and invocation', async () => {
    await expect(native('wrong-jsonrpc-initialize').activate()).rejects.toThrow(/protocol/i);
    const implementation = await native('wrong-jsonrpc-invoke').activate();

    await expect(implementation.invoke(invocation())).rejects.toThrow(/protocol/i);
  });

  it('rejects initialization responses with malformed capabilities or limits', async () => {
    const modes = [
      'null-initialize-result',
      'null-capabilities',
      'string-capabilities',
      'invalid-methods',
      'invalid-events',
      'null-limits',
      'string-limits',
      'zero-frame-limit',
      'zero-depth-limit',
      'oversized-frame-limit',
      'oversized-depth-limit',
    ];
    for (const mode of modes) {
      await expect(native(mode).activate()).rejects.toThrow('Native plugin protocol error');
    }
  });

  it('passes the configured environment to the native process', async () => {
    const implementation = await native('environment', {
      environment: { META_PROMPT_TEST_VALUE: 'configured' },
    }).activate();

    await expect(implementation.invoke(invocation())).resolves.toMatchObject({
      content: [{ text: 'input' }, { text: 'configured' }],
    });
  });

  it('rejects JSON-RPC errors and responses without results', async () => {
    for (const mode of ['rpc-error', 'missing-result']) {
      const implementation = await native(mode).activate();
      await expect(implementation.invoke(invocation())).rejects.toThrow(
        'Native plugin protocol error',
      );
    }
  });

  it('contains a missing executable error promptly', async () => {
    const started = Date.now();

    const failure = await capturedFailure(
      Promise.resolve(
        native('happy', {
          command: join(tmpdir(), 'meta-prompt-command-does-not-exist'),
        }).activate(),
      ),
    );

    expect(failure).toMatch(/native plugin process exited/i);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('contains crashes, redacts stderr, and does not retry', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'meta-prompt-native-crash-'));
    try {
      const marker = join(directory, 'processes');
      const implementation = await native('crash', {
        args: [fixture, 'crash', marker],
      }).activate();

      const failure = await capturedFailure(implementation.invoke(invocation()));

      expect(failure).toMatch(/native plugin process exited/i);
      expect(failure).not.toContain('secret fixture stderr');
      await expect(readFile(marker, 'utf8')).resolves.toBe('started\n');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('times out and terminates the child within a bounded interval', async () => {
    const implementation = await native('hang', {
      invocationTimeoutMs: 100,
      cancellationGraceMs: 50,
    }).activate();
    const started = Date.now();

    const failure = await capturedFailure(implementation.invoke(invocation()));

    expect(failure).toMatch(/native plugin invocation timed out/i);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('sends cancellation before terminating after the configured grace', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'meta-prompt-native-cancel-'));
    try {
      const marker = join(directory, 'processes');
      const implementation = await native('hang', {
        args: [fixture, 'hang', marker],
        invocationTimeoutMs: 2_000,
        cancellationGraceMs: 100,
      }).activate();
      const controller = new AbortController();
      const pending = implementation.invoke(invocation(controller.signal));

      controller.abort();

      expect(await capturedFailure(pending)).toMatch(/native plugin invocation cancelled/i);
      await expect(readFile(marker, 'utf8')).resolves.toContain('cancelled\n');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not accept a successful response after cancellation begins', async () => {
    const implementation = await native('late-success', {
      cancellationGraceMs: 100,
    }).activate();
    const controller = new AbortController();
    const pending = implementation.invoke(invocation(controller.signal));

    controller.abort();

    await expect(pending).rejects.toThrow(/cancelled/i);
  });

  it('rejects concurrent invocation without starting another process', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'meta-prompt-native-concurrent-'));
    try {
      const marker = join(directory, 'processes');
      const implementation = await native('hang', {
        args: [fixture, 'hang', marker],
        invocationTimeoutMs: 2_000,
        cancellationGraceMs: 50,
      }).activate();
      const controller = new AbortController();
      const first = implementation.invoke(invocation(controller.signal));

      await expect(implementation.invoke(invocation())).rejects.toThrow(/concurrent invocation/i);
      controller.abort();
      await expect(first).rejects.toThrow(/cancelled/i);
      await expect(readFile(marker, 'utf8')).resolves.toBe('started\ncancelled\n');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('starts a fresh initialized process for a second invocation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'meta-prompt-native-repeat-'));
    try {
      const marker = join(directory, 'processes');
      const implementation = await native('happy', {
        args: [fixture, 'happy', marker],
      }).activate();

      await expect(implementation.invoke(invocation())).resolves.toBeDefined();
      await expect(implementation.invoke(invocation())).resolves.toBeDefined();

      await expect(readFile(marker, 'utf8')).resolves.toBe('started\nstarted\n');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('force-contains a process that ignores shutdown and SIGTERM', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'meta-prompt-native-shutdown-'));
    try {
      const marker = join(directory, 'processes');
      const implementation = await native('ignore-shutdown', {
        args: [fixture, 'ignore-shutdown', marker],
        cancellationGraceMs: 50,
      }).activate();
      const started = Date.now();

      await expect(implementation.invoke(invocation())).rejects.toThrow(/shutdown timed out/i);

      expect(Date.now() - started).toBeLessThan(4_000);
      await expect(readFile(marker, 'utf8')).resolves.toContain('sigterm\n');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects a malformed shutdown handshake after a valid invocation', async () => {
    const implementation = await native('malformed-shutdown').activate();

    await expect(implementation.invoke(invocation())).rejects.toThrow(/protocol/i);
  });

  it('makes a native crash a degraded fail-open core result', async () => {
    const result = await executePluginPlan(
      makeTextDocument('input'),
      compilePluginGraph([manifest], [manifest.id]),
      [native('crash')],
      createRunContext('native-crash', () => undefined),
      { recipe: { id: 'recipe', version: '1.0.0' } },
    );

    expect(result).toMatchObject({
      status: 'degraded',
      primary: { value: 'input' },
      primaryOrigin: 'original',
      diagnostics: [{ code: 'meta-prompt.plugin.invocation-failed' }],
    });
  });
});
