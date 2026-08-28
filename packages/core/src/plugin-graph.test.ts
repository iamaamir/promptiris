import { describe, expect, it } from 'vitest';
import type { PluginContribution, PluginManifest } from '@promptiris/plugin-sdk';
import { compilePluginGraph } from './index.js';

function plugin(id: string, contributions: readonly PluginContribution[]): PluginManifest {
  return { id, version: '1.0.0', type: 'pipeline', contributions };
}

describe('compilePluginGraph', () => {
  it('deduplicates selected ids while retaining deterministic diagnostics', () => {
    const result = compilePluginGraph([], ['missing', 'missing']);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      id: 'diagnostic:missing-selected-plugin:missing',
      code: 'missing-selected-plugin',
      category: 'plugin-graph',
      severity: 'error',
      title: 'missing-selected-plugin',
      detail: 'missing',
    });
    expect(Object.isFrozen(result.diagnostics[0])).toBe(true);
  });

  it('orders diagnostics with the same code by their stable identity', () => {
    const result = compilePluginGraph([], ['z-missing', 'a-missing']);

    expect(result.diagnostics.map(({ id }) => id)).toEqual([
      'diagnostic:missing-selected-plugin:a-missing',
      'diagnostic:missing-selected-plugin:z-missing',
    ]);
  });

  it('reports selected conflicts against plugin ids and contribution ids', () => {
    const result = compilePluginGraph(
      [plugin('example/pipeline', [{ id: 'one', phase: 'transform', conflicts: ['other'] }])],
      ['example/pipeline', 'other'],
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map(({ code, detail }) => ({ code, detail }))).toEqual([
      { code: 'missing-selected-plugin', detail: 'other' },
      { code: 'selected-conflict', detail: 'one:other' },
    ]);
    expect(result.contributions).toEqual([]);
  });

  it('supports before, requires, and after constraints in a valid graph', () => {
    const result = compilePluginGraph(
      [
        plugin('example/pipeline', [
          { id: 'first', phase: 'transform', before: ['last'] },
          {
            id: 'middle',
            phase: 'transform',
            requires: ['first'],
            after: ['first'],
            before: ['last'],
          },
          { id: 'last', phase: 'transform' },
        ]),
      ],
      ['example/pipeline'],
    );

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.contributions.map(({ contribution }) => contribution.id)).toEqual([
      'first',
      'middle',
      'last',
    ]);
  });

  it('returns an empty graph when a selected plugin has no contributions', () => {
    const result = compilePluginGraph(
      [{ id: 'example/empty', version: '1.0.0', type: 'pipeline' }],
      ['example/empty'],
    );

    expect(result).toMatchObject({ ok: true, contributions: [], diagnostics: [] });
  });

  it('ignores conflicts with unselected or nonexistent contributions', () => {
    const result = compilePluginGraph(
      [plugin('example/pipeline', [{ id: 'only', phase: 'transform', conflicts: ['other'] }])],
      ['example/pipeline'],
    );

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it('reports an unknown phase once without invalid relation diagnostics', () => {
    const result = compilePluginGraph(
      [
        plugin('example/pipeline', [
          { id: 'invalid', phase: 'unknown', after: ['valid'] } as unknown as PluginContribution,
          { id: 'valid', phase: 'transform' },
        ]),
      ],
      ['example/pipeline'],
    );

    expect(result.ok).toBe(false);
    expect(result.contributions).toEqual([]);
    expect(result.diagnostics.map(({ code, detail }) => ({ code, detail }))).toEqual([
      { code: 'unknown-phase', detail: 'invalid:unknown' },
    ]);
  });

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
    expect(first.diagnostics.map(({ code, detail }) => ({ code, detail }))).toEqual([
      {
        code: 'cycle',
        detail: 'cycle-a,cycle-b',
      },
      { code: 'duplicate-contribution-id', detail: 'duplicate' },
      { code: 'missing-referenced-contribution', detail: 'missing-reference:absent' },
      { code: 'missing-selected-plugin', detail: 'absent-plugin' },
      { code: 'reversed-cross-phase-edge', detail: 'reversed:render' },
      { code: 'selected-conflict', detail: 'render:one' },
      { code: 'unknown-phase', detail: 'invalid:unknown' },
    ]);
  });

  it('rejects reversed before constraints across phases', () => {
    const result = compilePluginGraph(
      [
        plugin('example/reversed-before', [
          { id: 'render', phase: 'render', before: ['transform'] },
          { id: 'transform', phase: 'transform' },
        ]),
      ],
      ['example/reversed-before'],
    );

    expect(result.diagnostics.map(({ code, detail }) => ({ code, detail }))).toEqual([
      { code: 'reversed-cross-phase-edge', detail: 'render:transform' },
    ]);
  });

  it('reports only the unvisited nodes in a deterministic cycle detail', () => {
    const result = compilePluginGraph(
      [
        plugin('example/cycle', [
          { id: 'done', phase: 'preflight' },
          { id: 'z-cycle', phase: 'transform', after: ['a-cycle'] },
          { id: 'a-cycle', phase: 'transform', after: ['z-cycle'] },
        ]),
      ],
      ['example/cycle'],
    );

    expect(result.diagnostics.map(({ code, detail }) => ({ code, detail }))).toEqual([
      { code: 'cycle', detail: 'a-cycle,z-cycle' },
    ]);
  });

  it('accepts arbitrary plugin identities when no conflict was declared', () => {
    const result = compilePluginGraph(
      [plugin('Stryker was here', [{ id: 'only', phase: 'transform' }])],
      ['Stryker was here'],
    );

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it('rejects duplicate selected plugin identities', () => {
    const duplicate = plugin('example/duplicate', [{ id: 'one', phase: 'transform' }]);

    const result = compilePluginGraph([duplicate, { ...duplicate }], ['example/duplicate']);

    expect(result).toMatchObject({ ok: false, contributions: [] });
    expect(result.diagnostics.map(({ code }) => code)).toEqual(['duplicate-plugin-id']);
  });
});
