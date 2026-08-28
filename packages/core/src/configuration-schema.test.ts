import { describe, expect, it } from 'vitest';
import type { JsonValue } from '@promptiris/protocol';
import {
  configPointer,
  deepFrozenClone,
  safePreview,
  validateConfig,
  type SchemaRule,
} from './configuration-schema.js';

describe('configuration schema', () => {
  it.each([
    ['string', 'x'],
    ['number', 1],
    ['integer', 2],
    ['boolean', true],
    ['null', null],
  ])('validates %s', (type, value) =>
    expect(validateConfig({ type } as SchemaRule, value).ok).toBe(true),
  );
  it.each([
    [{ type: 'string' }, true],
    [{ type: 'number' }, '1'],
    [{ type: 'integer' }, 1.5],
    [{ type: 'boolean' }, 1],
    [{ type: 'null' }, false],
  ] satisfies readonly (readonly [SchemaRule, unknown])[])(
    'does not accept another scalar family',
    (schema, value) => expect(validateConfig(schema, value).ok).toBe(false),
  );
  it('validates nullable, defaults, nested unknown keys and arrays', () => {
    const schema: SchemaRule = {
      type: 'object',
      properties: { n: { type: 'integer' }, xs: { type: 'array', items: { type: 'string' } } },
    };
    expect(validateConfig(schema, { n: 1, xs: ['a'] }).ok).toBe(true);
    expect(validateConfig({ type: 'string', default: 'x' }, undefined).ok).toBe(true);
    expect(validateConfig({ type: 'string', default: 'x' }, 'explicit')).toEqual({
      ok: true,
      value: 'explicit',
    });
    expect(validateConfig({ type: 'string', nullable: true }, null).ok).toBe(true);
    expect(validateConfig({ type: 'object', properties: {}, nullable: true }, null)).toEqual({
      ok: true,
      value: null,
    });
    expect(
      validateConfig({ type: 'array', items: { type: 'string' }, nullable: true }, null),
    ).toEqual({ ok: true, value: null });
    expect(validateConfig(schema, { n: 1, extra: 'secret' }).ok).toBe(false);
  });
  it.each([
    [{ type: 'string' }, 1],
    [{ type: 'number' }, Number.NaN],
    [{ type: 'number' }, Number.POSITIVE_INFINITY],
    [{ type: 'integer' }, 1.5],
    [{ type: 'null' }, 'not-null'],
    [{ type: 'null' }, { ref: 'env:TOKEN' }],
    [{ type: 'object', properties: {} }, null],
    [{ type: 'array', items: { type: 'string' } }, 'not-an-array'],
  ] satisfies readonly (readonly [SchemaRule, unknown])[])(
    'rejects invalid root values',
    (schema, value) => {
      const result = validateConfig(schema, value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.diagnostic.detail).toContain('at /.');
    },
  );
  it('reports an escaped pointer without exposing the rejected value', () => {
    const result = validateConfig(
      {
        type: 'object',
        properties: {
          'a/b': {
            type: 'object',
            properties: { '~items': { type: 'array', items: { type: 'integer' } } },
          },
        },
      },
      { 'a/b': { '~items': [1, 'TOP_SECRET'] } },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic.detail).toContain('/a~1b/~0items/1');
      expect(result.diagnostic.detail).not.toContain('TOP_SECRET');
    }
  });
  it('handles references, escaping, safe output and immutable clones', () => {
    expect(validateConfig({ type: 'secret-reference' }, { ref: 'env:TOKEN' }).ok).toBe(true);
    expect(configPointer('/a', '~x/y')).toBe('/a/~0x~1y');
    const preview = safePreview({ type: 'secret-reference' }, { ref: 'env:TOP_SECRET' });
    expect(preview).toEqual({ kind: 'secret-reference', scheme: 'env' });
    expect(safePreview({ type: 'string', sensitive: true }, 'TOP_SECRET')).toEqual({
      kind: 'redacted',
    });
    expect(safePreview({ type: 'array', items: { type: 'string' } }, ['x'])).toEqual({
      kind: 'redacted',
    });
    expect(safePreview({ type: 'object', properties: {} }, {})).toEqual({ kind: 'redacted' });
    expect(safePreview({ type: 'number' }, 3)).toEqual({ kind: 'literal', value: 3 });
    expect(safePreview({ type: 'string' }, { ref: 'env:TOKEN' })).toEqual({
      kind: 'literal',
      value: { ref: 'env:TOKEN' },
    });
    const clone = deepFrozenClone({ nested: ['x'] });
    expect(Object.isFrozen(clone) && Object.isFrozen((clone as { nested: JsonValue }).nested)).toBe(
      true,
    );
  });
  it('returns the exact schema diagnostic contract', () => {
    expect(validateConfig({ type: 'integer' }, 'TOP_SECRET')).toEqual({
      ok: false,
      diagnostic: {
        schemaVersion: '1',
        id: 'promptiris.config.invalid',
        code: 'promptiris.config.invalid',
        category: 'configuration',
        severity: 'error',
        title: 'Invalid configuration',
        detail: 'Value does not match schema at /.',
      },
    });
  });
});
