import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { resolveConfiguration, type ConfigPolicy } from './configuration-resolution.js';
import type { SchemaRule } from './configuration-schema.js';

describe('resolveConfiguration', () => {
  const schema: SchemaRule = {
    type: 'object',
    merge: true,
    properties: {
      'a/b': { type: 'string', default: 'default' },
      nested: { type: 'object', merge: true, properties: { x: { type: 'integer', default: 2 } } },
      replace: { type: 'object', properties: { x: { type: 'integer' } } },
      list: {
        type: 'array',
        items: { type: 'object', properties: { x: { type: 'integer' } } },
        merge: 'union',
      },
      n: { type: 'integer', default: 1 },
    },
  };
  it('resolves precedence, defaults, merge and trace', () => {
    const result = resolveConfiguration({
      schema,
      layers: [
        {
          sourceId: 'low',
          value: { 'a/b': 'low', nested: { x: 3 }, replace: { x: 1 }, list: [{ x: 1 }] },
        },
        {
          sourceId: 'high',
          value: { 'a/b': 'high', replace: { x: 4 }, list: [{ x: 1 }, { x: 2 }] },
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toMatchObject({
      'a/b': 'high',
      nested: { x: 3 },
      replace: { x: 4 },
      list: [{ x: 1 }, { x: 2 }],
      n: 1,
    });
    expect(result.trace.entries['/a~1b']?.candidates[0]?.disposition).toBe('overridden');
    expect(result.trace.entries['']?.candidates.map(({ disposition }) => disposition)).toEqual([
      'accepted',
      'accepted',
    ]);
    expect(result.trace.entries['']?.merge).toBe('merge');
    expect(result.trace.entries['/list']?.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          disposition: 'accepted',
          reason: 'contributes through schema merge',
        }),
      ]),
    );
    expect(result.trace.entries['/n']?.effectiveSource).toBe('default');
    expect(Object.isFrozen(result.trace)).toBe(true);
  });
  it('traces unspecified arrays as replacement and preserves source locations safely', () => {
    const result = resolveConfiguration({
      schema: { type: 'array', items: { type: 'string' } },
      layers: [
        { sourceId: 'low', value: ['a'], location: { uri: 'project.jsonc', line: 2 } },
        { sourceId: 'high', value: ['b'] },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toEqual(['b']);
    expect(result.trace.entries['']?.merge).toBe('replace');
    expect(result.trace.entries['']?.candidates[0]).toMatchObject({
      disposition: 'overridden',
      location: { uri: 'project.jsonc', line: 2 },
    });
    expect(Object.isFrozen(result.trace.entries['']?.candidates)).toBe(true);
  });
  it('returns the exact scalar provenance contract', () => {
    const result = resolveConfiguration({
      schema: { type: 'string' },
      layers: [
        { sourceId: 'low', value: 'first' },
        { sourceId: 'high', value: 'second' },
      ],
    });
    expect(result).toEqual({
      ok: true,
      config: 'second',
      trace: {
        entries: {
          '': {
            pointer: '',
            schemaRule: 'string',
            candidates: [
              {
                sourceId: 'low',
                disposition: 'overridden',
                preview: { kind: 'literal', value: 'first' },
                reason: 'overridden by higher-precedence candidate',
              },
              {
                sourceId: 'high',
                disposition: 'accepted',
                preview: { kind: 'literal', value: 'second' },
                reason: 'highest-precedence candidate',
              },
            ],
            merge: 'replace',
            effectiveSource: 'high',
          },
        },
      },
      policies: [],
    });
  });
  it('applies schema defaults before append and resolves defaults without layers', () => {
    const appended = resolveConfiguration({
      schema: {
        type: 'array',
        items: { type: 'integer' },
        merge: 'append',
        default: [0],
      },
      layers: [
        { sourceId: 'low', value: [1] },
        { sourceId: 'high', value: [2] },
      ],
    });
    expect(appended.ok && appended.config).toEqual([0, 1, 2]);
    if (appended.ok)
      expect(
        appended.trace.entries['']?.candidates.map(({ disposition, reason }) => ({
          disposition,
          reason,
        })),
      ).toEqual([
        { disposition: 'accepted', reason: 'contributes through schema merge' },
        { disposition: 'accepted', reason: 'contributes through schema merge' },
      ]);

    const duplicates = resolveConfiguration({
      schema: { type: 'array', items: { type: 'integer' }, merge: 'append' },
      layers: [
        { sourceId: 'low', value: [1] },
        { sourceId: 'high', value: [1] },
      ],
    });
    expect(duplicates.ok && duplicates.config).toEqual([1, 1]);

    const defaults = resolveConfiguration({
      schema: {
        type: 'object',
        merge: true,
        properties: { nested: { type: 'integer', default: 3 } },
      },
      layers: [],
    });
    expect(defaults.ok && defaults.config).toEqual({ nested: 3 });
  });

  it('replaces object units instead of resurrecting lower properties', () => {
    const result = resolveConfiguration({
      schema: {
        type: 'object',
        properties: {
          retained: { type: 'integer' },
          defaulted: { type: 'integer', default: 9 },
        },
      },
      layers: [
        { sourceId: 'low', value: { retained: 1 } },
        { sourceId: 'high', value: {} },
      ],
    });
    expect(result.ok && result.config).toEqual({});
  });

  it('preserves sibling fields while forcing a nested value', () => {
    const nestedSchema: SchemaRule = {
      type: 'object',
      merge: true,
      properties: {
        nested: {
          type: 'object',
          merge: true,
          properties: { x: { type: 'integer' }, sibling: { type: 'integer' } },
        },
      },
    };
    const result = resolveConfiguration({
      schema: nestedSchema,
      layers: [{ sourceId: 'project', value: { nested: { x: 1, sibling: 2 } } }],
      policies: [{ policyId: 'force-x', action: 'forced', pointer: '/nested/x', value: 3 }],
    });
    expect(result.ok && result.config).toEqual({ nested: { x: 3, sibling: 2 } });
  });
  it('unions structurally equal objects regardless of key order', () => {
    const result = resolveConfiguration({
      schema: {
        type: 'array',
        merge: 'union',
        items: {
          type: 'object',
          properties: { a: { type: 'integer' }, b: { type: 'integer' } },
        },
      },
      layers: [
        { sourceId: 'low', value: [{ a: 1, b: 2 }] },
        { sourceId: 'high', value: [{ b: 2, a: 1 }] },
      ],
    });
    expect(result.ok && result.config).toEqual([{ a: 1, b: 2 }]);
  });
  it('does not collapse distinct primitive, array, and object union members', () => {
    const result = resolveConfiguration({
      schema: { type: 'array', merge: 'union', items: { type: 'number' } },
      layers: [
        { sourceId: 'low', value: [1, 2] },
        { sourceId: 'high', value: [2, 3] },
      ],
    });
    expect(result.ok && result.config).toEqual([1, 2, 3]);
  });

  it('merges object defaults below explicit layers', () => {
    const result = resolveConfiguration({
      schema: {
        type: 'object',
        merge: true,
        default: { low: 1 },
        properties: { low: { type: 'integer' }, high: { type: 'integer' } },
      },
      layers: [{ sourceId: 'project', value: { high: 2 } }],
    });
    expect(result.ok && result.config).toEqual({ low: 1, high: 2 });
  });
  it('applies all policy actions and rejects invalid pointers', () => {
    const policies: ConfigPolicy[] = [
      { policyId: 'a', action: 'allowed', pointer: '/n' },
      { policyId: 'f', action: 'forced', pointer: '/n', value: 8 },
      { policyId: 'c', action: 'clamped', pointer: '/n', max: 5 },
    ];
    const result = resolveConfiguration({
      schema,
      layers: [{ sourceId: 'x', value: {} }],
      policies,
    });
    expect(result.ok && result.config).toMatchObject({ n: 5 });
    expect(
      resolveConfiguration({
        schema,
        layers: [{ sourceId: 'x', value: {} }],
        policies: [{ policyId: 'bad', action: 'allowed', pointer: '/missing' }],
      }).ok,
    ).toBe(false);
    expect(
      resolveConfiguration({
        schema: {
          type: 'object',
          merge: true,
          properties: { xs: { type: 'array', items: { type: 'integer' } } },
        },
        layers: [{ sourceId: 'x', value: { xs: [1] } }],
        policies: [{ policyId: 'nested-array', action: 'forced', pointer: '/xs/0', value: 2 }],
      }).ok,
    ).toBe(false);
    expect(
      resolveConfiguration({
        schema,
        layers: [{ sourceId: 'x', value: { n: 1 } }],
        policies: [{ policyId: 'deny', action: 'denied', pointer: '/n' }],
      }).ok,
    ).toBe(false);
  });
  it('validates forced and clamped policies atomically', () => {
    const base = [{ sourceId: 'project', value: { n: 10 } }] as const;
    const clamped = resolveConfiguration({
      schema,
      layers: base,
      policies: [
        {
          policyId: 'limit',
          action: 'clamped',
          pointer: '/n',
          min: 2,
          max: 5,
          sourceId: 'host',
          reason: 'bounded',
        },
      ],
    });
    expect(clamped.ok && clamped.config).toMatchObject({ n: 5 });
    if (clamped.ok)
      expect(clamped.policies).toEqual([
        {
          policyId: 'limit',
          decision: 'clamped',
          pointer: '/n',
          sourceId: 'host',
          reason: 'bounded',
        },
      ]);

    const failures: ConfigPolicy[][] = [
      [{ policyId: 'bad-pointer', action: 'allowed', pointer: '/n~2x' }],
      [{ policyId: 'scalar-child', action: 'allowed', pointer: '/n/x' }],
      [{ policyId: 'bad-force', action: 'forced', pointer: '/n', value: 'not-an-integer' }],
      [{ policyId: 'bad-bounds', action: 'clamped', pointer: '/n', min: 5, max: 2 }],
      [{ policyId: 'bad-type', action: 'clamped', pointer: '/a~1b', max: 2 }],
    ];
    for (const policies of failures)
      expect(resolveConfiguration({ schema, layers: base, policies }).ok).toBe(false);

    const nestedForce = resolveConfiguration({
      schema,
      layers: [{ sourceId: 'project', value: { nested: { x: 1 } } }],
      policies: [{ policyId: 'nested', action: 'forced', pointer: '/nested/x', value: 4 }],
    });
    expect(nestedForce.ok && nestedForce.config).toMatchObject({ nested: { x: 4 } });

    const rootForce = resolveConfiguration({
      schema: { type: 'integer' },
      layers: [{ sourceId: 'project', value: 1 }],
      policies: [{ policyId: 'root', action: 'forced', pointer: '', value: 2 }],
    });
    expect(rootForce.ok && rootForce.config).toBe(2);

    const escapedForce = resolveConfiguration({
      schema: {
        type: 'object',
        merge: true,
        properties: { '~x/y': { type: 'integer' } },
      },
      layers: [{ sourceId: 'project', value: { '~x/y': 1 } }],
      policies: [{ policyId: 'escaped', action: 'forced', pointer: '/~0x~1y', value: 2 }],
    });
    expect(escapedForce.ok && escapedForce.config).toEqual({ '~x/y': 2 });
  });

  it('records a denial for an absent schema field without mutating configuration', () => {
    const result = resolveConfiguration({
      schema: { type: 'object', merge: true, properties: { optional: { type: 'string' } } },
      layers: [{ sourceId: 'project', value: {} }],
      policies: [{ policyId: 'deny-optional', action: 'denied', pointer: '/optional' }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toEqual({});
    expect(result.policies[0]?.decision).toBe('denied');
    expect(result.policies[0]?.reason).toBe('Policy denied applied.');
  });
  it('returns exact safe policy failures and clamps both bounds', () => {
    const invalidPointer = resolveConfiguration({
      schema,
      layers: [{ sourceId: 'project', value: {} }],
      policies: [{ policyId: 'bad', action: 'allowed', pointer: 'n' }],
    });
    expect(invalidPointer).toEqual({
      ok: false,
      diagnostic: {
        schemaVersion: '1',
        id: 'promptiris.config.invalid',
        code: 'promptiris.config.invalid',
        category: 'configuration',
        severity: 'error',
        title: 'Invalid configuration',
        detail: 'Policy bad references an invalid pointer.',
      },
    });
    const denied = resolveConfiguration({
      schema,
      layers: [{ sourceId: 'project', value: { n: 1 } }],
      policies: [{ policyId: 'locked', action: 'denied', pointer: '/n' }],
    });
    expect(denied).toMatchObject({
      ok: false,
      diagnostic: { detail: 'Policy locked denied configuration.' },
    });
    for (const [value, expected] of [
      [-5, 0],
      [15, 10],
      [5, 5],
    ] as const) {
      const result = resolveConfiguration({
        schema,
        layers: [{ sourceId: 'project', value: { n: value } }],
        policies: [{ policyId: 'range', action: 'clamped', pointer: '/n', min: 0, max: 10 }],
      });
      expect(result.ok && (result.config as { n: number }).n).toBe(expected);
    }
    const equalBounds = resolveConfiguration({
      schema,
      layers: [{ sourceId: 'project', value: { n: 4 } }],
      policies: [{ policyId: 'fixed', action: 'clamped', pointer: '/n', min: 3, max: 3 }],
    });
    expect(equalBounds.ok && (equalBounds.config as { n: number }).n).toBe(3);

    const invalidClamp = resolveConfiguration({
      schema,
      layers: [{ sourceId: 'project', value: { n: 1 } }],
      policies: [{ policyId: 'bad-range', action: 'clamped', pointer: '/n', min: 2, max: 1 }],
    });
    expect(invalidClamp).toMatchObject({
      ok: false,
      diagnostic: { detail: 'Policy bad-range is invalid.' },
    });
  });

  it('rejects an invalid lower layer even when a valid higher layer overrides it', () => {
    expect(
      resolveConfiguration({
        schema: { type: 'integer' },
        layers: [
          { sourceId: 'invalid-low', value: 'wrong' },
          { sourceId: 'valid-high', value: 2 },
        ],
      }).ok,
    ).toBe(false);
  });

  it('omits an effective source when neither a candidate nor default exists', () => {
    const result = resolveConfiguration({
      schema: {
        type: 'object',
        merge: true,
        properties: { optional: { type: 'string' } },
      },
      layers: [{ sourceId: 'project', value: {} }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trace.entries['/optional']).not.toHaveProperty('effectiveSource');
  });
  it('preserves inputs and is invariant under repeated resolution', () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        const input = { n };
        const result = resolveConfiguration({ schema, layers: [{ sourceId: 'x', value: input }] });
        expect(result.ok).toBe(true);
        expect(input.n).toBe(n);
        if (result.ok)
          expect(result.config).toEqual(
            resolveConfiguration({ schema, layers: [{ sourceId: 'x', value: input }] }).ok &&
              result.config,
          );
      }),
      { numRuns: 25 },
    );
  });
});
