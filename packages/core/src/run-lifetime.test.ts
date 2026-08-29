import { describe, expect, it, vi } from 'vitest';
import { createRunLifetime } from './run-lifetime.js';

describe('Run lifetime', () => {
  it('propagates caller cancellation once', () => {
    const parent = new AbortController();
    using lifetime = createRunLifetime({ signal: parent.signal });
    let aborts = 0;
    lifetime.signal.addEventListener('abort', () => (aborts += 1));

    parent.abort();
    parent.abort();

    expect(lifetime.termination).toBe('cancelled');
    expect(lifetime.signal.aborted).toBe(true);
    expect(aborts).toBe(1);
  });

  it('classifies an owned deadline independently from caller cancellation', () => {
    vi.useFakeTimers();
    try {
      using lifetime = createRunLifetime({ timeoutMs: 25 });
      vi.advanceTimersByTime(25);
      expect(lifetime.termination).toBe('timed-out');
      expect(lifetime.signal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves parent cancellation when it wins the parent/deadline race', () => {
    vi.useFakeTimers();
    try {
      const parent = new AbortController();
      using lifetime = createRunLifetime({ signal: parent.signal, timeoutMs: 25 });
      parent.abort();
      vi.advanceTimersByTime(25);
      expect(lifetime.termination).toBe('cancelled');
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves timeout when it wins the deadline/parent race', () => {
    vi.useFakeTimers();
    try {
      const parent = new AbortController();
      using lifetime = createRunLifetime({ signal: parent.signal, timeoutMs: 25 });
      vi.advanceTimersByTime(25);
      parent.abort();
      expect(lifetime.termination).toBe('timed-out');
    } finally {
      vi.useRealTimers();
    }
  });

  it('detaches parent cancellation and clears its deadline on disposal', () => {
    vi.useFakeTimers();
    try {
      const parent = new AbortController();
      const lifetime = createRunLifetime({ signal: parent.signal, timeoutMs: 25 });

      lifetime[Symbol.dispose]();
      lifetime[Symbol.dispose]();
      parent.abort();
      vi.advanceTimersByTime(25);

      expect(lifetime.termination).toBe('active');
      expect(lifetime.signal.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not create a deadline when none is requested', () => {
    vi.useFakeTimers();
    try {
      using lifetime = createRunLifetime();
      vi.runAllTimers();
      expect(lifetime.termination).toBe('active');
      expect(lifetime.signal.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('releases each owned listener and timer exactly once', () => {
    vi.useFakeTimers();
    try {
      const parent = new AbortController();
      const remove = vi.spyOn(parent.signal, 'removeEventListener');
      const clear = vi.spyOn(globalThis, 'clearTimeout');
      const lifetime = createRunLifetime({ signal: parent.signal, timeoutMs: 25 });

      lifetime[Symbol.dispose]();
      lifetime[Symbol.dispose]();

      expect(remove).toHaveBeenCalledTimes(1);
      expect(clear).toHaveBeenCalledTimes(1);
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid timeout %s as immediate API misuse',
    (timeoutMs) => {
      expect(() => createRunLifetime({ timeoutMs })).toThrow(
        new RangeError('Run timeout must be a positive finite duration'),
      );
    },
  );
});
