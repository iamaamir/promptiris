import { describe, expect, it } from 'vitest';
import { makeTextDocument, type PromptDocument } from '@promptiris/protocol';
import {
  defineDeclarativePlugin,
  type PluginImplementation,
  type PluginManifest,
  type PluginRegistration,
} from '@promptiris/plugin-sdk';
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
      expect.objectContaining({ type: 'promptiris.phase.started', data: { phase: 'transform' } }),
      expect.objectContaining({
        type: 'promptiris.plugin.activation-started',
        data: { pluginId: manifest.id, contributionId: 'first' },
      }),
      expect.objectContaining({
        type: 'promptiris.plugin.activation-completed',
        data: { pluginId: manifest.id, contributionId: 'first', status: 'success' },
      }),
      expect.objectContaining({
        type: 'promptiris.plugin.invocation-started',
        data: { pluginId: manifest.id, contributionId: 'first' },
      }),
      expect.objectContaining({
        type: 'promptiris.plugin.invocation-completed',
        data: { pluginId: manifest.id, contributionId: 'first', status: 'failed' },
      }),
      expect.objectContaining({
        type: 'promptiris.phase.completed',
        data: { phase: 'transform', status: 'degraded' },
      }),
    ]);
    expect(events.map((event) => event.dataSchema)).toEqual([
      'promptiris/event/phase-started-v1',
      'promptiris/event/plugin-activation-started-v1',
      'promptiris/event/plugin-activation-completed-v1',
      'promptiris/event/plugin-invocation-started-v1',
      'promptiris/event/plugin-invocation-completed-v1',
      'promptiris/event/phase-completed-v1',
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
      diagnostics: [{ code: 'promptiris.plugin.activation-failed' }],
      summary: { completedPhases: [], failedPhases: ['transform'] },
    });
    expect(events).toEqual([
      'promptiris.phase.started',
      'promptiris.plugin.activation-started',
      'promptiris.plugin.activation-completed',
      'promptiris.phase.completed',
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

  it('rejects artifact proposals with missing identity or invalid classification', async () => {
    for (const artifact of [
      { kind: 'example/output', mediaType: '', value: 'x', classification: 'public' },
      { kind: 'output', mediaType: 'text/plain', value: 'x', classification: 'public' },
      { kind: 'example/output', mediaType: 'text/plain', value: 'x', classification: 'private' },
    ]) {
      const result = await execute([
        customRegistration(() => ({
          invoke: async () => ({ artifacts: [artifact] }) as never,
        })),
      ]);
      expect(result.diagnostics).toEqual([
        expect.objectContaining({ code: 'promptiris.plugin.invalid-output' }),
      ]);
      expect(result.primaryOrigin).toBe('original');
    }
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
          async invoke() {
            return {};
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
    expect(events.filter((type) => type === 'promptiris.phase.started')).toHaveLength(3);
    expect(events.filter((type) => type === 'promptiris.phase.completed')).toHaveLength(3);
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
      'promptiris.phase.started',
      'promptiris.plugin.activation-started',
      'promptiris.plugin.activation-completed',
      'promptiris.plugin.invocation-started',
      'promptiris.plugin.invocation-completed',
      'promptiris.plugin.invocation-started',
      'promptiris.plugin.invocation-completed',
      'promptiris.phase.completed',
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
      diagnostics: [{ code: 'promptiris.plugin.activation-failed' }],
    });
    expect(JSON.stringify(result.diagnostics)).not.toContain('secret activation stack');
  });

  it('accepts a valid implementation with an unrelated code property', async () => {
    const registration = customRegistration(() => ({
      code: 'plugin-owned-metadata',
      async invoke() {
        return {};
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
      diagnostics: [{ code: 'promptiris.plugin.activation-failed' }],
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
        id: 'diagnostic:promptiris.plugin.activation-failed',
        code: 'promptiris.plugin.activation-failed',
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
      diagnostics: [{ code: 'promptiris.plugin.invocation-failed' }],
    });
    expect(JSON.stringify(result.diagnostics)).not.toContain('secret invocation stack');
  });

  it('rejects invalid plugin output without retrying', async () => {
    let invocations = 0;
    const events: string[] = [];
    const registration = customRegistration(() => ({
      async invoke() {
        invocations += 1;
        return { schemaVersion: '1', content: [{ id: 42, text: 'invalid' }] } as never;
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
      diagnostics: [{ code: 'promptiris.plugin.invalid-output' }],
    });
    expect(events).toContain('promptiris.plugin.invocation-completed');
  });

  it('preserves the last valid transformed artifact after a later failure', async () => {
    let invocations = 0;
    const registration = customRegistration(() => ({
      async invoke({ contributionId, revision }) {
        invocations += 1;
        if (contributionId === 'second') throw new Error('later failure');
        return {
          patches: [
            {
              schemaVersion: '1',
              id: 'example/plugin:first',
              baseRevision: revision,
              operations: [{ type: 'insert-content-block', block: { id: 'first', text: 'first' } }],
            },
          ],
        };
      },
    }));

    const result = await execute([registration]);

    expect(invocations).toBe(2);
    expect(result).toMatchObject({
      status: 'degraded',
      primary: { value: 'input\nfirst' },
      primaryOrigin: 'transformed',
      diagnostics: [{ code: 'promptiris.plugin.invocation-failed' }],
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
          id: 'diagnostic:promptiris.recipe.compile-failed',
          code: 'promptiris.recipe.compile-failed',
          category: 'configuration',
          severity: 'error',
          title: 'promptiris.recipe.compile-failed',
        },
      ],
    });
  });

  it('stamps Artifact provenance and exposes only Recipe-authorized public kinds', async () => {
    const registration = customRegistration(() => ({
      async invoke({ contributionId }) {
        if (contributionId === 'second') return {};
        return {
          artifacts: [
            {
              kind: 'example/output',
              mediaType: 'text/plain',
              value: 'enhanced',
              dataSchema: { uri: 'https://example.test/output.schema.json' },
              digest: `sha256:${'a'.repeat(64)}`,
              classification: 'public',
              extensions: { 'example/plugin/state': { confidence: 1 } },
            },
            {
              kind: 'example/alternate',
              mediaType: 'text/plain',
              value: 'alternate',
              classification: 'public',
            },
            {
              kind: 'example/internal',
              mediaType: 'application/json',
              value: { hidden: true },
              classification: 'internal',
            },
            {
              kind: 'example/sensitive',
              mediaType: 'text/plain',
              value: 'secret',
              classification: 'sensitive',
            },
            {
              kind: 'example/unselected',
              mediaType: 'text/plain',
              value: 'not selected',
              classification: 'public',
            },
          ],
        };
      },
    }));

    const result = await executePluginPlan(
      makeTextDocument('input'),
      compilePluginGraph([manifest], [manifest.id]),
      [registration],
      createRunContext('run-artifacts', () => undefined),
      {
        recipe: { id: 'recipe', version: '1.0.0' },
        artifacts: {
          primaryKind: 'example/output',
          alternativeKinds: ['example/output', 'example/alternate'],
          exposedKinds: ['example/output', 'example/internal'],
        },
      },
    );

    expect(result.primary).toEqual({
      schemaVersion: '1',
      id: 'artifact:run-artifacts:0',
      kind: 'example/output',
      mediaType: 'text/plain',
      value: 'enhanced',
      dataSchema: { uri: 'https://example.test/output.schema.json' },
      digest: `sha256:${'a'.repeat(64)}`,
      classification: 'public',
      provenance: {
        pluginId: 'example/plugin',
        contributionId: 'first',
        invocationId: 'run-artifacts:example/plugin:first',
        phase: 'transform',
        parentArtifactIds: [],
        patchIds: [],
      },
      extensions: { 'example/plugin/state': { confidence: 1 } },
    });
    expect(result.primaryOrigin).toBe('transformed');
    expect(result.alternatives).toEqual([
      expect.objectContaining({ kind: 'example/alternate', value: 'alternate' }),
    ]);
    expect(result.exposed).toEqual({ 'example/output': [result.primary] });
    expect(JSON.stringify(result)).not.toContain('hidden');
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result.alternatives).not.toContainEqual(
      expect.objectContaining({ kind: 'example/unselected' }),
    );
  });

  it('normalizes rejected typed Patches and preserves the last accepted document', async () => {
    const registration = customRegistration(() => ({
      async invoke() {
        return {
          patches: [
            {
              schemaVersion: '1',
              id: 'stale',
              baseRevision: 1,
              operations: [{ type: 'insert-content-block', block: { id: 'never', text: 'never' } }],
            },
          ],
        };
      },
    }));

    const result = await execute([registration]);

    expect(result).toMatchObject({
      status: 'degraded',
      primary: { value: 'input' },
      primaryOrigin: 'original',
      diagnostics: [{ code: 'promptiris.patch.stale-revision' }],
    });
  });

  it('rejects Artifact extensions outside the producing Plugin namespace', async () => {
    const registration = customRegistration(() => ({
      async invoke() {
        return {
          artifacts: [
            {
              kind: 'example/output',
              mediaType: 'text/plain',
              value: 'hidden',
              classification: 'public',
              extensions: { 'other/plugin/state': true },
            },
          ],
        };
      },
    }));

    const result = await execute([registration]);

    expect(result).toMatchObject({
      status: 'degraded',
      primary: { value: 'input' },
      diagnostics: [{ code: 'promptiris.plugin.invalid-output' }],
    });
  });

  it.each([
    ['null output', null],
    ['unknown output member', { extra: true }],
    ['non-array patches', { patches: {} }],
    ['null Artifact', { artifacts: [null] }],
    [
      'missing Artifact identity',
      { artifacts: [{ mediaType: 'text/plain', value: 'x', classification: 'public' }] },
    ],
    [
      'invalid Artifact classification',
      {
        artifacts: [
          { kind: 'example/output', mediaType: 'text/plain', value: 'x', classification: 'secret' },
        ],
      },
    ],
    [
      'non-JSON Artifact value',
      {
        artifacts: [
          {
            kind: 'example/output',
            mediaType: 'text/plain',
            value: undefined,
            classification: 'public',
          },
        ],
      },
    ],
    [
      'non-JSON Artifact extension',
      {
        artifacts: [
          {
            kind: 'example/output',
            mediaType: 'text/plain',
            value: 'x',
            classification: 'public',
            extensions: { 'example/plugin/state': undefined },
          },
        ],
      },
    ],
  ])('normalizes %s as invalid Plugin output', async (_label, output) => {
    const registration = customRegistration(() => ({
      async invoke() {
        return output as never;
      },
    }));

    const result = await execute([registration]);

    expect(result).toMatchObject({
      status: 'degraded',
      primary: { value: 'input' },
      diagnostics: [{ code: 'promptiris.plugin.invalid-output' }],
    });
  });
});
