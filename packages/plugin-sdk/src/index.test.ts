import { describe, expect, it } from 'vitest';
import { makeTextDocument } from '@meta-prompt/protocol';
import { definePlugin, identityArtifact } from './index.js';

describe('plugin SDK primitives', () => {
  it('freezes defined manifests', () => {
    const after = ['example/first'];
    const manifest = definePlugin({
      id: 'example/identity',
      version: '1.0.0',
      type: 'recipe',
      contributions: [{ id: 'example/second', phase: 'transform', after }],
    });

    after.push('example/mutated');

    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.contributions)).toBe(true);
    expect(Object.isFrozen(manifest.contributions?.[0])).toBe(true);
    expect(Object.isFrozen(manifest.contributions?.[0]?.after)).toBe(true);
    expect(manifest.contributions?.[0]?.after).toEqual(['example/first']);
  });

  it('renders identity artifacts from all text blocks', () => {
    const document = makeTextDocument('first');
    document.content.push({ id: 'second', text: 'second' });

    expect(identityArtifact(document).value).toBe('first\nsecond');
  });
});
