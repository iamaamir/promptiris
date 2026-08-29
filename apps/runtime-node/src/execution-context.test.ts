import { describe, expect, it } from 'vitest';
import { currentExecutionContext, runWithExecutionContext } from './execution-context.js';

describe('operational execution context', () => {
  it('flows immutable correlation through asynchronous work without retaining content', async () => {
    const supplied = {
      runId: 'run-1',
      traceId: 'trace-1',
      pluginId: 'example/plugin',
      input: 'must not be retained',
    };

    const observed = await runWithExecutionContext(supplied, async () => {
      await Promise.resolve();
      return currentExecutionContext();
    });

    expect(observed).toEqual({
      runId: 'run-1',
      traceId: 'trace-1',
      pluginId: 'example/plugin',
    });
    expect(Object.isFrozen(observed)).toBe(true);
    expect(currentExecutionContext()).toBeUndefined();
  });

  it('restores the parent context after a nested operation', () => {
    runWithExecutionContext({ runId: 'outer', traceId: 'outer' }, () => {
      runWithExecutionContext({ runId: 'inner', traceId: 'inner' }, () => {
        expect(currentExecutionContext()?.runId).toBe('inner');
      });
      expect(currentExecutionContext()?.runId).toBe('outer');
    });
  });

  it('preserves each optional operational identifier independently', () => {
    const requiredOnly = runWithExecutionContext({ runId: 'run', traceId: 'trace' }, () =>
      currentExecutionContext(),
    );
    const contributionOnly = runWithExecutionContext(
      { runId: 'run', traceId: 'trace', contributionId: 'transform' },
      () => currentExecutionContext(),
    );

    expect(requiredOnly).toStrictEqual({ runId: 'run', traceId: 'trace' });
    expect(contributionOnly).toStrictEqual({
      runId: 'run',
      traceId: 'trace',
      contributionId: 'transform',
    });
  });
});
