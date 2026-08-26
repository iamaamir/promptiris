import { afterEach, describe, expect, it, vi } from 'vitest';
import { identityRecipe, createRunContext } from './index.js';
import { makeTextDocument } from '@meta-prompt/protocol';
describe('identity recipe', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns original input and lifecycle events', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValueOnce(110);
    const events: unknown[] = [];
    const result = await identityRecipe.run(
      makeTextDocument('hello'),
      createRunContext('run-1', (event) => events.push(event)),
    );
    expect(identityRecipe).toMatchObject({ id: 'meta-prompt/identity', version: '1.0.0' });
    expect(result).toMatchObject({
      schemaVersion: '1',
      runId: 'run-1',
      recipe: { id: 'meta-prompt/identity', version: '1.0.0' },
      status: 'success',
      primary: { value: 'hello' },
      primaryOrigin: 'original',
      alternatives: [],
      exposed: {},
      assumptions: [],
      clarifications: [],
      diagnostics: [],
      summary: {
        traceId: 'run-1',
        durationMs: 10,
        completedPhases: ['transform'],
        failedPhases: [],
      },
    });
    expect(events).toEqual([
      expect.objectContaining({
        type: 'meta-prompt.phase.started',
        source: 'core',
        dataSchema: 'meta-prompt/event/phase-started-v1',
        data: { phase: 'transform' },
        classification: 'metadata',
        delivery: 'critical',
        sequence: 0,
        runId: 'run-1',
        traceId: 'run-1',
      }),
      expect.objectContaining({
        type: 'meta-prompt.phase.completed',
        source: 'core',
        dataSchema: 'meta-prompt/event/phase-completed-v1',
        data: { phase: 'transform', status: 'success' },
        classification: 'metadata',
        delivery: 'critical',
        sequence: 1,
        runId: 'run-1',
        traceId: 'run-1',
      }),
    ]);
  });
});
