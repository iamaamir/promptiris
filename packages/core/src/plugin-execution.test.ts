import { describe, expect, it } from 'vitest';
import { makeTextDocument, type PromptDocument } from '@meta-prompt/protocol';
import {
  defineDeclarativePlugin,
  type PluginImplementation,
  type PluginManifest,
  type PluginRegistration,
} from '@meta-prompt/plugin-sdk';
import { compilePluginGraph, createRunContext, executePluginPlan } from './index.js';

const manifest: PluginManifest = {
  id: 'example/plugin',
  version: '1.0.0',
  type: 'pipeline',
  contributions: [
    { id: 'first', phase: 'transform' },
    { id: 'second', phase: 'transform', after: ['first'] },
  ],
};

function declarativeRegistration(
  activations: { count: number },
  immutableInputs: boolean[] = [],
  invocationInputs: PromptDocument[] = [],
): PluginRegistration {
  const registration = defineDeclarativePlugin(manifest, [
    {
      contributionId: 'first',
      operation: { kind: 'append-text-block', block: { id: 'first', text: 'first' } },
    },
    {
      contributionId: 'second',
      operation: { kind: 'append-text-block', block: { id: 'second', text: 'second' } },
    },
  ]);
  return {
    manifest: registration.manifest,
    async activate() {
      activations.count += 1;
      const implementation = await registration.activate();
      return {
        invoke(request) {
          invocationInputs.push(request.input);
          immutableInputs.push(
            Object.isFrozen(request.input),
            Object.isFrozen(request.input.content),
            request.input.content.every(Object.isFrozen),
          );
          return implementation.invoke(request);
        },
      };
    },
  };
}

async function execute(registrations: readonly PluginRegistration[]) {
  return executePluginPlan(
    makeTextDocument('input'),
    compilePluginGraph([manifest], [manifest.id]),
    registrations,
    createRunContext('run-failure', () => undefined),
    { recipe: { id: 'recipe', version: '1.0.0' } },
  );
}

function customRegistration(activate: () => PluginImplementation): PluginRegistration {
  return { manifest, activate };
}

describe('executePluginPlan', () => {
  it('emits payloads and phase statuses for a failed invocation', async () => {
    const events: { type: string; data: unknown; dataSchema: string }[] = [];
    const result = await executePluginPlan(
      makeTextDocument('input'),
      compilePluginGraph([manifest], [manifest.id]),
      [
        customRegistration(() => ({
          invoke: async () => {
            throw new Error('hidden');
          },
        })),
      ],
      createRunContext('run-event-payloads', (event) => events.push(event)),
      { recipe: { id: 'recipe', version: '1.0.0' } },
    );

    expect(events).toEqual([
      expect.objectContaining({ type: 'meta-prompt.phase.started', data: { phase: 'transform' } }),
      expect.objectContaining({
        type: 'meta-prompt.plugin.activation-started',
        data: { pluginId: manifest.id, contributionId: 'first' },
      }),
      expect.objectContaining({
        type: 'meta-prompt.plugin.activation-completed',
        data: { pluginId: manifest.id, contributionId: 'first', status: 'success' },
      }),
      expect.objectContaining({
        type: 'meta-prompt.plugin.invocation-started',
        data: { pluginId: manifest.id, contributionId: 'first' },
      }),
      expect.objectContaining({
        type: 'meta-prompt.plugin.invocation-completed',
        data: { pluginId: manifest.id, contributionId: 'first', status: 'failed' },
      }),
      expect.objectContaining({
        type: 'meta-prompt.phase.completed',
        data: { phase: 'transform', status: 'degraded' },
      }),
    ]);
    expect(events.map((event) => event.dataSchema)).toEqual([
      'meta-prompt/event/phase-started-v1',
      'meta-prompt/event/plugin-activation-started-v1',
      'meta-prompt/event/plugin-activation-completed-v1',
      'meta-prompt/event/plugin-invocation-started-v1',
      'meta-prompt/event/plugin-invocation-completed-v1',
      'meta-prompt/event/phase-completed-v1',
    ]);
    expect(events.map((event) => event.data)).toStrictEqual([
      { phase: 'transform' },
      { pluginId: manifest.id, contributionId: 'first' },
      { pluginId: manifest.id, contributionId: 'first', status: 'success' },
      { pluginId: manifest.id, contributionId: 'first' },
      { pluginId: manifest.id, contributionId: 'first', status: 'failed' },
      { phase: 'transform', status: 'degraded' },
    ]);
    expect(events.every((event) => (event as { source?: string }).source === 'core')).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.diagnostics)).toBe(true);
    expect(Object.isFrozen(result.summary.completedPhases)).toBe(true);
    expect(Object.isFrozen(result.summary.failedPhases)).toBe(true);
    expect(result).toMatchObject({
      schemaVersion: '1',
      runId: 'run-event-payloads',
      alternatives: [],
      exposed: {},
      assumptions: [],
      clarifications: [],
      summary: { traceId: 'run-event-payloads' },
    });
    expect(result.summary.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.summary.durationMs).toBeLessThan(10_000);
  });

  it('fails open when a graph contribution has no registration', async () => {
    const events: string[] = [];
    const result = await executePluginPlan(
      makeTextDocument('input'),
      compilePluginGraph([manifest], [manifest.id]),
      [],
      createRunContext('run-missing-registration', (event) => events.push(event.type)),
      { recipe: { id: 'recipe', version: '1.0.0' } },
    );

    expect(result).toMatchObject({
      status: 'degraded',
      primary: { value: 'input' },
      primaryOrigin: 'original',
      diagnostics: [{ code: 'meta-prompt.plugin.activation-failed' }],
      summary: { completedPhases: [], failedPhases: ['transform'] },
    });
    expect(events).toEqual([
      'meta-prompt.phase.started',
      'meta-prompt.plugin.activation-started',
      'meta-prompt.plugin.activation-completed',
      'meta-prompt.phase.completed',
    ]);
  });

  it('returns the original input and no phases for a valid empty graph', async () => {
    const input = makeTextDocument('input');
    const result = await executePluginPlan(
      input,
      compilePluginGraph([{ ...manifest, contributions: [] }], [manifest.id]),
      [],
      createRunContext('run-empty-graph', () => undefined),
      { recipe: { id: 'recipe', version: '1.0.0' } },
    );

    expect(result).toMatchObject({
      status: 'success',
      primary: { value: 'input' },
      primaryOrigin: 'original',
      diagnostics: [],
      summary: { completedPhases: [], failedPhases: [] },
    });
    expect(input).toEqual(makeTextDocument('input'));
  });

  it('transitions across phases and records each completed phase', async () => {
    const phases = ['preflight', 'analyze', 'transform'] as const;
    const multiPhaseManifest: PluginManifest = {
      ...manifest,
      contributions: phases.map((phase) => ({ id: phase, phase })),
    };
    const registration: PluginRegistration = {
      manifest: multiPhaseManifest,
      async activate() {
        return {
          async invoke({ input }) {
            return input;
          },
        };
      },
    };
    const events: string[] = [];
    const result = await executePluginPlan(
      makeTextDocument('input'),
      compilePluginGraph([multiPhaseManifest], [multiPhaseManifest.id]),
      [registration],
      createRunContext('run-multi-phase', (event) => events.push(event.type)),
      { recipe: { id: 'recipe', version: '1.0.0' } },
    );

    expect(result.status).toBe('success');
    expect(result.summary.completedPhases).toEqual(phases);
    expect(result.summary.failedPhases).toEqual([]);
    expect(events.filter((type) => type === 'meta-prompt.phase.started')).toHaveLength(3);
    expect(events.filter((type) => type === 'meta-prompt.phase.completed')).toHaveLength(3);
  });

  it('activates once, invokes in graph order, and emits standard lifecycle events', async () => {
    const activations = { count: 0 };
    const immutableInputs: boolean[] = [];
    const invocationInputs: PromptDocument[] = [];
    const events: string[] = [];
    const input = makeTextDocument('input');
    const result = await executePluginPlan(
      input,
      compilePluginGraph([manifest], [manifest.id]),
      [declarativeRegistration(activations, immutableInputs, invocationInputs)],
      createRunContext('run-success', (event) => events.push(event.type)),
      { recipe: { id: 'recipe', version: '1.0.0' } },
    );

    expect(activations.count).toBe(1);
    expect(immutableInputs).toEqual([true, true, true, true, true, true]);
    expect(invocationInputs[0]).not.toBe(invocationInputs[1]);
    expect(result).toMatchObject({
      status: 'success',
      primary: { value: 'input\nfirst\nsecond' },
      primaryOrigin: 'transformed',
      diagnostics: [],
    });
    expect(input).toEqual(makeTextDocument('input'));
    expect(events).toEqual([
      'meta-prompt.phase.started',
      'meta-prompt.plugin.activation-started',
      'meta-prompt.plugin.activation-completed',
      'meta-prompt.plugin.invocation-started',
      'meta-prompt.plugin.invocation-completed',
      'meta-prompt.plugin.invocation-started',
      'meta-prompt.plugin.invocation-completed',
      'meta-prompt.phase.completed',
    ]);
  });

  it('never activates an unselected registration', async () => {
    let unselectedActivations = 0;
    const unselected: PluginRegistration = {
      manifest: { ...manifest, id: 'example/unselected' },
      activate() {
        unselectedActivations += 1;
        throw new Error('must remain lazy');
      },
    };

    const result = await execute([declarativeRegistration({ count: 0 }), unselected]);

    expect(result.status).toBe('success');
    expect(unselectedActivations).toBe(0);
  });

  it('normalizes activation failure without leaking or retrying', async () => {
    let activations = 0;
    const registration: PluginRegistration = {
      manifest,
      activate() {
        activations += 1;
        throw new Error('secret activation stack');
      },
    };

    const result = await execute([registration]);

    expect(activations).toBe(1);
    expect(result).toMatchObject({
      status: 'degraded',
      primary: { value: 'input' },
      primaryOrigin: 'original',
      diagnostics: [{ code: 'meta-prompt.plugin.activation-failed' }],
    });
    expect(JSON.stringify(result.diagnostics)).not.toContain('secret activation stack');
  });

  it('accepts a valid implementation with an unrelated code property', async () => {
    const registration = customRegistration(() => ({
      code: 'plugin-owned-metadata',
      async invoke({ input }) {
        return input;
      },
    }));

    const result = await execute([registration]);

    expect(result.status).toBe('success');
    expect(result.diagnostics).toEqual([]);
  });

  it('normalizes an invalid activation value', async () => {
    const registration: PluginRegistration = {
      manifest,
      activate: (() => undefined) as unknown as PluginRegistration['activate'],
    };

    const result = await execute([registration]);

    expect(result).toMatchObject({
      status: 'degraded',
      primaryOrigin: 'original',
      diagnostics: [{ code: 'meta-prompt.plugin.activation-failed' }],
    });
  });

  it('rejects an activation object whose invoke member is not callable', async () => {
    const registration: PluginRegistration = {
      manifest,
      activate: (() => ({ invoke: 'not-a-function' })) as unknown as PluginRegistration['activate'],
    };

    const result = await execute([registration]);

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        id: 'diagnostic:meta-prompt.plugin.activation-failed',
        code: 'meta-prompt.plugin.activation-failed',
        category: 'plugin',
      }),
    ]);
  });

  it('selects the registration matching the compiled plugin identity', async () => {
    let wrongActivations = 0;
    const wrong: PluginRegistration = {
      manifest: { ...manifest, id: 'example/wrong' },
      activate() {
        wrongActivations += 1;
        throw new Error('wrong registration');
      },
    };

    const result = await execute([wrong, declarativeRegistration({ count: 0 })]);

    expect(result.status).toBe('success');
    expect(wrongActivations).toBe(0);
  });

  it('normalizes invocation failure without leaking or retrying', async () => {
    let invocations = 0;
    const registration = customRegistration(() => ({
      async invoke() {
        invocations += 1;
        throw new Error('secret invocation stack');
      },
    }));

    const result = await execute([registration]);

    expect(invocations).toBe(1);
    expect(result).toMatchObject({
      status: 'degraded',
      primary: { value: 'input' },
      primaryOrigin: 'original',
      diagnostics: [{ code: 'meta-prompt.plugin.invocation-failed' }],
    });
    expect(JSON.stringify(result.diagnostics)).not.toContain('secret invocation stack');
  });

  it('rejects invalid plugin output without retrying', async () => {
    let invocations = 0;
    const events: string[] = [];
    const registration = customRegistration(() => ({
      async invoke() {
        invocations += 1;
        return { schemaVersion: '1', content: [{ id: 42, text: 'invalid' }] };
      },
    }));

    const result = await executePluginPlan(
      makeTextDocument('input'),
      compilePluginGraph([manifest], [manifest.id]),
      [registration],
      createRunContext('run-invalid-output', (event) => events.push(event.type)),
      { recipe: { id: 'recipe', version: '1.0.0' } },
    );

    expect(invocations).toBe(1);
    expect(result).toMatchObject({
      status: 'degraded',
      primary: { value: 'input' },
      primaryOrigin: 'original',
      diagnostics: [{ code: 'meta-prompt.plugin.invalid-output' }],
    });
    expect(events).toContain('meta-prompt.plugin.invocation-completed');
  });

  it('preserves the last valid transformed artifact after a later failure', async () => {
    let invocations = 0;
    const registration = customRegistration(() => ({
      async invoke({ contributionId, input }) {
        invocations += 1;
        if (contributionId === 'second') throw new Error('later failure');
        const document: PromptDocument = {
          schemaVersion: '1',
          content: [...input.content, { id: 'first', text: 'first' }],
        };
        return document;
      },
    }));

    const result = await execute([registration]);

    expect(invocations).toBe(2);
    expect(result).toMatchObject({
      status: 'degraded',
      primary: { value: 'input\nfirst' },
      primaryOrigin: 'transformed',
      diagnostics: [{ code: 'meta-prompt.plugin.invocation-failed' }],
    });
  });

  it('cannot report success for a failed graph', async () => {
    const result = await executePluginPlan(
      makeTextDocument('input'),
      compilePluginGraph([], ['missing']),
      [],
      createRunContext('run-invalid-graph', () => undefined),
      { recipe: { id: 'recipe', version: '1.0.0' } },
    );

    expect(result).toMatchObject({
      status: 'degraded',
      primary: { value: 'input' },
      primaryOrigin: 'original',
      diagnostics: [
        {
          schemaVersion: '1',
          id: 'diagnostic:meta-prompt.recipe.compile-failed',
          code: 'meta-prompt.recipe.compile-failed',
          category: 'configuration',
          severity: 'error',
          title: 'meta-prompt.recipe.compile-failed',
        },
      ],
    });
  });
});
