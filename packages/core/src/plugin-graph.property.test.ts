import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { PluginManifest } from '@promptiris/plugin-sdk';
import { compilePluginGraph } from './index.js';

const identifier = fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/);
const scenarios = fc.uniqueArray(
  fc.record({ id: identifier, discovery: fc.integer(), selection: fc.integer() }),
  { minLength: 1, maxLength: 12, selector: ({ id }) => id },
);

function rankedIds(
  entries: readonly {
    readonly id: string;
    readonly discovery: number;
    readonly selection: number;
  }[],
  rank: 'discovery' | 'selection',
): string[] {
  return [...entries]
    .sort((left, right) => left[rank] - right[rank] || left.id.localeCompare(right.id))
    .map(({ id }) => id);
}

describe('compilePluginGraph properties', () => {
  it('is independent of manifest discovery and selection order', () => {
    fc.assert(
      fc.property(scenarios, (entries) => {
        const manifests = rankedIds(entries, 'discovery').map<PluginManifest>((id) => ({
          id: `plugin/${id}`,
          version: '1.0.0',
          type: 'pipeline',
          contributions: [{ id, phase: 'transform' }],
        }));
        const selected = rankedIds(entries, 'selection').map((id) => `plugin/${id}`);
        const result = compilePluginGraph(manifests, selected);
        const expected = entries
          .map(({ id }) => id)
          .sort((left, right) => left.localeCompare(right));

        expect(result.ok).toBe(true);
        expect(result.contributions.map(({ contribution }) => contribution.id)).toEqual(expected);
      }),
      { seed: 20260827, numRuns: 200 },
    );
  });

  it('preserves a generated dependency chain regardless of contribution order', () => {
    fc.assert(
      fc.property(scenarios, (entries) => {
        const expected = entries
          .map(({ id }) => id)
          .sort((left, right) => left.localeCompare(right));
        const contributions = rankedIds(entries, 'discovery').map((id) => {
          const index = expected.indexOf(id);
          return index === 0
            ? { id, phase: 'transform' as const }
            : { id, phase: 'transform' as const, after: expected.slice(index - 1, index) };
        });
        const manifest: PluginManifest = {
          id: 'plugin/generated-chain',
          version: '1.0.0',
          type: 'pipeline',
          contributions,
        };
        const result = compilePluginGraph([manifest], [manifest.id]);

        expect(result.ok).toBe(true);
        expect(result.contributions.map(({ contribution }) => contribution.id)).toEqual(expected);
      }),
      { seed: 20260828, numRuns: 200 },
    );
  });
});
