import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { definePlugin } from './index.js';

function isDeeplyFrozen(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return true;
  return Object.isFrozen(value) && Object.values(value).every(isDeeplyFrozen);
}

describe('definePlugin properties', () => {
  it('round trips and deeply freezes arbitrary JSON metadata', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (metadata) => {
        const expected = structuredClone(metadata);
        const manifest = definePlugin({
          id: 'example/property-manifest',
          version: '1.0.0',
          type: 'guard',
          metadata,
        });

        expect(manifest.metadata).toEqual(expected);
        expect(isDeeplyFrozen(manifest)).toBe(true);
        if (typeof metadata === 'object' && metadata !== null) {
          expect(manifest.metadata).not.toBe(metadata);
        }
      }),
      { seed: 20260829, numRuns: 200 },
    );
  });
});
