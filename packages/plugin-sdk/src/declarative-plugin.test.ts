import { describe, expect, it } from 'vitest';
import { makeTextDocument } from '@promptiris/protocol';
import { defineDeclarativePlugin, type PluginManifest, type PluginRegistration } from './index.js';

describe('defineDeclarativePlugin', () => {
  it('keeps its manifest data-only and invokes only the selected operation', async () => {
    const manifest: PluginManifest = {
      id: 'example/declarative',
      version: '1.0.0',
      type: 'pipeline',
      contributions: [
        { id: 'append-one', phase: 'transform' },
        { id: 'append-two', phase: 'transform' },
      ],
    };
    const registration: PluginRegistration = defineDeclarativePlugin(manifest, [
      {
        contributionId: 'append-one',
        operation: { kind: 'append-text-block', block: { id: 'one', text: 'one' } },
      },
      {
        contributionId: 'append-two',
        operation: { kind: 'append-text-block', block: { id: 'two', text: 'two' } },
      },
    ]);
    const input = makeTextDocument('original');

    const implementation = await registration.activate();
    const output = await implementation.invoke({
      contributionId: 'append-two',
      input,
      revision: 0,
      signal: new AbortController().signal,
    });

    expect(JSON.parse(JSON.stringify(registration.manifest))).toEqual(registration.manifest);
    expect(Object.isFrozen(registration)).toBe(true);
    expect(Object.isFrozen(registration.manifest)).toBe(true);
    expect(Object.isFrozen(implementation)).toBe(true);
    expect(output).toEqual({
      patches: [
        {
          schemaVersion: '1',
          id: 'example/declarative:append-two',
          baseRevision: 0,
          operations: [{ type: 'insert-content-block', block: { id: 'two', text: 'two' } }],
        },
      ],
    });
    expect(input).toEqual(makeTextDocument('original'));
  });

  it('rejects duplicate and missing declarative contribution definitions', async () => {
    const manifest: PluginManifest = {
      id: 'example/invalid-declarative',
      version: '1.0.0',
      type: 'pipeline',
      contributions: [{ id: 'append', phase: 'transform' }],
    };
    const definition = {
      contributionId: 'append',
      operation: { kind: 'append-text-block' as const, block: { id: 'extra', text: 'extra' } },
    };

    expect(() => defineDeclarativePlugin(manifest, [definition, definition])).toThrow(/duplicate/i);
    const implementation = await defineDeclarativePlugin(manifest, [definition]).activate();
    await expect(
      implementation.invoke({
        contributionId: 'missing',
        input: makeTextDocument('original'),
        revision: 0,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/not defined/i);
  });
});
