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
    const registration = customRegistration(() => ({
      async invoke() {
        invocations += 1;
        return { schemaVersion: '1', content: [{ id: 42, text: 'invalid' }] };
      },
    }));

    const result = await execute([registration]);

    expect(invocations).toBe(1);
    expect(result).toMatchObject({
      status: 'degraded',
      primary: { value: 'input' },
      primaryOrigin: 'original',
      diagnostics: [{ code: 'meta-prompt.plugin.invalid-output' }],
    });
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
      diagnostics: [{ code: 'meta-prompt.recipe.compile-failed' }],
    });
  });
});
