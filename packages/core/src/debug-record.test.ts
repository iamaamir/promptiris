import { describe, expect, it } from 'vitest';
import { captureDebugRecord, type DebugRecord } from './debug-record.js';

const location = {
  runId: 'run-debug',
  traceId: 'trace-debug',
  operation: 'plugin.invoke',
  pluginId: 'example/plugin',
  contributionId: 'transform',
};

describe('Debug Records', () => {
  it('preserves bounded Error causes and aggregate failures for an opt-in sink', () => {
    const records: DebugRecord[] = [];
    const aggregate = new AggregateError(
      [new Error('provider failed', { cause: new TypeError('socket closed') }), 'non-error'],
      'all providers failed',
    );

    captureDebugRecord({ capture: (record) => records.push(record) }, aggregate, location);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      runId: 'run-debug',
      operation: 'plugin.invoke',
      exception: {
        type: 'AggregateError',
        message: 'all providers failed',
        causes: [
          {
            type: 'Error',
            message: 'provider failed',
            causes: [{ type: 'TypeError', message: 'socket closed' }],
          },
          { type: 'string', message: 'non-error' },
        ],
      },
    });
  });

  it('isolates sink failure and circular causes', () => {
    const circular = new Error('circular') as Error & { cause?: unknown };
    circular.cause = circular;
    const records: DebugRecord[] = [];
    captureDebugRecord({ capture: (record) => records.push(record) }, circular, location);

    expect(records[0]?.exception.causes?.[0]?.message).toBe('[circular cause]');
    expect(records[0]?.exception.stack).toContain('circular');
    expect(() =>
      captureDebugRecord(
        {
          capture() {
            throw new Error('observer failed');
          },
        },
        circular,
        location,
      ),
    ).not.toThrow();
  });

  it('retains both explicit-disposal failures from SuppressedError', () => {
    const records: DebugRecord[] = [];
    captureDebugRecord(
      { capture: (record) => records.push(record) },
      new SuppressedError(new Error('later cleanup'), new Error('earlier cleanup')),
      location,
    );

    expect(records[0]?.exception.causes?.map(({ message }) => message)).toEqual([
      'later cleanup',
      'earlier cleanup',
    ]);
  });

  it('does nothing when debug capture is disabled', () => {
    expect(() => captureDebugRecord(undefined, new Error('secret'), location)).not.toThrow();
  });

  it('bounds text and aggregate width at the contract limits', () => {
    const records: DebugRecord[] = [];
    const errors = Array.from({ length: 10 }, (_, index) => new Error(`failure-${String(index)}`));
    const aggregate = new AggregateError(errors, 'x'.repeat(4_097));

    captureDebugRecord({ capture: (record) => records.push(record) }, aggregate, location);

    const exception = records[0]?.exception;
    expect(exception?.message).toHaveLength(4_097);
    expect(exception?.message.endsWith('…')).toBe(true);
    expect(exception?.causes).toHaveLength(8);
    expect(exception?.causes?.map(({ message }) => message)).toEqual(
      errors.slice(0, 8).map(({ message }) => message),
    );
  });

  it('bounds cause depth at the contract limit', () => {
    const records: DebugRecord[] = [];
    let nested: Error = new Error('leaf');
    for (let index = 0; index < 10; index += 1) {
      nested = new Error(`level-${String(index)}`, { cause: nested });
    }

    captureDebugRecord({ capture: (record) => records.push(record) }, nested, location);
    let cursor = records[0]?.exception;
    let depth = 0;
    while (cursor?.causes?.[0] !== undefined) {
      depth += 1;
      cursor = cursor.causes[0];
    }
    expect(depth).toBe(8);
  });

  it('preserves an exact boundary, stack presence, and a scalar failure shape', () => {
    const records: DebugRecord[] = [];
    const boundary = new Error('x'.repeat(4_096));
    delete boundary.stack;

    captureDebugRecord({ capture: (record) => records.push(record) }, boundary, location);
    captureDebugRecord({ capture: (record) => records.push(record) }, 42, location);

    expect(records[0]?.exception).toStrictEqual({
      type: 'Error',
      message: 'x'.repeat(4_096),
    });
    expect(records[1]?.exception).toStrictEqual({ type: 'number', message: '42' });
  });
});
