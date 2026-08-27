import { describe, expect, it } from 'vitest';
import type { PluginContribution, PluginManifest } from '@meta-prompt/plugin-sdk';
import { compilePluginGraph } from './index.js';

function plugin(id: string, contributions: readonly PluginContribution[]): PluginManifest {
  return { id, version: '1.0.0', type: 'pipeline', contributions };
}

describe('compilePluginGraph', () => {
  it('orders selected contributions independently of discovery order', () => {
    const manifests = [
      plugin('example/render', [{ id: 'render', phase: 'render' }]),
      plugin('example/transform', [
        { id: 'transform-b', phase: 'transform', after: ['transform-a'] },
        { id: 'transform-a', phase: 'transform' },
      ]),
      plugin('example/preflight', [{ id: 'preflight', phase: 'preflight' }]),
    ];

    const first = compilePluginGraph(
      manifests,
      manifests.map(({ id }) => id),
    );
    const second = compilePluginGraph(
      [...manifests].reverse(),
      manifests.map(({ id }) => id).reverse(),
    );

    expect(first).toEqual(second);
    expect(first.contributions.map(({ contribution }) => contribution.id)).toEqual([
      'preflight',
      'transform-a',
      'transform-b',
      'render',
    ]);
  });

  it('returns an immutable plan isolated from mutable manifest input', () => {
    const constraints = ['first'];
    const contribution: PluginContribution = {
      id: 'second',
      phase: 'transform',
      after: constraints,
    };
    const result = compilePluginGraph(
      [plugin('example/pipeline', [{ id: 'first', phase: 'transform' }, contribution])],
      ['example/pipeline'],
    );

    constraints.push('later-mutation');

    expect(result.ok).toBe(true);
    expect(result.contributions[1]?.contribution.after).toEqual(['first']);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.contributions)).toBe(true);
    expect(Object.isFrozen(result.contributions[1])).toBe(true);
    expect(Object.isFrozen(result.contributions[1]?.contribution)).toBe(true);
    expect(Object.isFrozen(result.contributions[1]?.contribution.after)).toBe(true);
  });

  it('returns deterministic diagnostics and no executable partial plan', () => {
    const invalidPhase = { id: 'invalid', phase: 'unknown' } as unknown as PluginContribution;
    const manifests = [
      plugin('one', [
        invalidPhase,
        { id: 'duplicate', phase: 'preflight' },
        { id: 'duplicate', phase: 'transform' },
        { id: 'missing-reference', phase: 'transform', requires: ['absent'] },
        { id: 'reversed', phase: 'preflight', after: ['render'] },
        { id: 'cycle-a', phase: 'transform', after: ['cycle-b'] },
        { id: 'cycle-b', phase: 'transform', after: ['cycle-a'] },
      ]),
      plugin('two', [{ id: 'render', phase: 'render', conflicts: ['one'] }]),
    ];

    const first = compilePluginGraph(manifests, ['one', 'two', 'absent-plugin']);
    const second = compilePluginGraph([...manifests].reverse(), ['two', 'absent-plugin', 'one']);

    expect(first).toEqual(second);
    expect(first.ok).toBe(false);
    expect(first.contributions).toEqual([]);
    expect(first.diagnostics.map(({ code }) => code)).toEqual([
      'cycle',
      'duplicate-contribution-id',
      'missing-referenced-contribution',
      'missing-selected-plugin',
      'reversed-cross-phase-edge',
      'selected-conflict',
      'unknown-phase',
    ]);
  });

  it('rejects duplicate selected plugin identities', () => {
    const duplicate = plugin('example/duplicate', [{ id: 'one', phase: 'transform' }]);

    const result = compilePluginGraph([duplicate, { ...duplicate }], ['example/duplicate']);

    expect(result).toMatchObject({ ok: false, contributions: [] });
    expect(result.diagnostics.map(({ code }) => code)).toEqual(['duplicate-plugin-id']);
  });
});
