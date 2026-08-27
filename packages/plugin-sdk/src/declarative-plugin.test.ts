import { describe, expect, it } from 'vitest';
import { makeTextDocument } from '@meta-prompt/protocol';
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
      signal: new AbortController().signal,
    });

    expect(JSON.parse(JSON.stringify(registration.manifest))).toEqual(registration.manifest);
    expect(output).toEqual({
      schemaVersion: '1',
      content: [
        { id: 'input-1', text: 'original' },
        { id: 'two', text: 'two' },
      ],
    });
    expect(input).toEqual(makeTextDocument('original'));
  });
});
