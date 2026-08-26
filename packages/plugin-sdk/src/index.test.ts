import { describe, expect, it } from 'vitest';
import { makeTextDocument } from '@meta-prompt/protocol';
import { definePlugin, identityArtifact } from './index.js';

describe('plugin SDK primitives', () => {
  it('freezes defined manifests', () => {
    const manifest = definePlugin({ id: 'example/identity', version: '1.0.0', type: 'recipe' });

    expect(Object.isFrozen(manifest)).toBe(true);
  });

  it('renders identity artifacts from all text blocks', () => {
    const document = makeTextDocument('first');
    document.content.push({ id: 'second', text: 'second' });

    expect(identityArtifact(document).value).toBe('first\nsecond');
  });
});
