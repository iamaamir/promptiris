import { describe, expect, it } from 'vitest';
import { makeTextDocument } from '@meta-prompt/protocol';
import { definePlugin, identityArtifact } from './index.js';

describe('plugin SDK primitives', () => {
  it('defensively clones and deeply freezes data-only manifests', () => {
    const after = ['example/first'];
    const metadata = { tags: ['stable'] };
    const manifest = definePlugin({
      id: 'example/identity',
      version: '1.0.0',
      type: 'recipe',
      contributions: [
        {
          id: 'example/second',
          phase: 'transform',
          requires: [],
          before: [],
          after,
          conflicts: [],
        },
      ],
      metadata,
    });

    after.push('example/mutated');
    metadata.tags.push('mutated');

    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.contributions)).toBe(true);
    expect(Object.isFrozen(manifest.contributions?.[0])).toBe(true);
    expect(Object.isFrozen(manifest.contributions?.[0]?.after)).toBe(true);
    expect(manifest.contributions?.[0]?.after).toEqual(['example/first']);
    expect(Object.isFrozen(manifest.metadata.tags)).toBe(true);
    expect(manifest.metadata.tags).toEqual(['stable']);
  });

  it('accepts a minimal manifest without contributions', () => {
    const manifest = definePlugin({ id: 'example/minimal', version: '1.0.0', type: 'guard' });

    expect(manifest).toEqual({ id: 'example/minimal', version: '1.0.0', type: 'guard' });
  });

  it('rejects executable and non-JSON manifest extensions', () => {
    const executable = {
      id: 'example/executable',
      version: '1.0.0',
      type: 'pipeline' as const,
      activate: () => undefined,
    };
    const nonFinite = {
      id: 'example/non-finite',
      version: '1.0.0',
      type: 'pipeline' as const,
      weight: Number.POSITIVE_INFINITY,
    };

    expect(() => definePlugin(executable)).toThrow(/only JSON data/i);
    expect(() => definePlugin(nonFinite)).toThrow(/only JSON data/i);
  });

  it.each([
    ['undefined', undefined],
    ['symbol', Symbol('manifest')],
    ['bigint', 1n],
    ['date', new Date('2026-01-01T00:00:00.000Z')],
    [
      'class instance',
      new (class ManifestValue {
        readonly value = 'not-plain';
      })(),
    ],
  ])('rejects %s values anywhere in a manifest', (_label, value) => {
    const manifest = {
      id: 'example/invalid-value',
      version: '1.0.0',
      type: 'guard' as const,
      extension: value,
    };

    expect(() => definePlugin(manifest)).toThrow(/only JSON data/i);
  });

  it('preserves JSON arrays and null while rejecting non-plain nested objects', () => {
    const nullPrototype = Object.create(null) as { nested: string[] };
    nullPrototype.nested = ['ok'];
    const manifest = definePlugin({
      id: 'example/json-data',
      version: '1.0.0',
      type: 'guard' as const,
      extension: { nullable: null, values: [1, 'two', true], nullPrototype },
    });

    expect(manifest.extension.nullable).toBeNull();
    expect(manifest.extension.values).toEqual([1, 'two', true]);
    expect(manifest.extension.nullPrototype).toEqual({ nested: ['ok'] });
  });

  it('rejects cycles, symbol keys, and accessors', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const symbolKeyed = { [Symbol('hidden')]: 'value' };
    const accessor = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: () => 'computed',
    });
    const base = { id: 'example/invalid-shape', version: '1.0.0', type: 'guard' as const };

    expect(() => definePlugin({ ...base, extension: cyclic })).toThrow(/only JSON data/i);
    expect(() => definePlugin({ ...base, extension: symbolKeyed })).toThrow(/only JSON data/i);
    expect(() => definePlugin({ ...base, extension: accessor })).toThrow(/only JSON data/i);
  });

  it('accepts shared JSON references without mistaking aliases for cycles', () => {
    const shared = { value: 'shared' };
    const manifest = definePlugin({
      id: 'example/shared-reference',
      version: '1.0.0',
      type: 'guard' as const,
      extension: { first: shared, second: shared },
    });

    expect(manifest.extension).toEqual({
      first: { value: 'shared' },
      second: { value: 'shared' },
    });
  });

  it('renders identity artifacts from all text blocks', () => {
    const document = makeTextDocument('first');
    document.content.push({ id: 'second', text: 'second' });

    const artifact = identityArtifact(document);

    expect(artifact).toEqual({
      schemaVersion: '1',
      id: 'artifact:identity',
      kind: 'meta-prompt/prompt',
      mediaType: 'text/plain',
      value: 'first\nsecond',
    });
    expect(Object.isFrozen(artifact)).toBe(false);
  });
});
