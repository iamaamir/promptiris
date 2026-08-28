import { describe, expect, it } from 'vitest';
import type { JsonValue } from '@promptiris/protocol';
import { parseJsonc, validateSecretReference } from './configuration-jsonc.js';

describe('parseJsonc', () => {
  it('accepts comments and trailing commas and freezes the complete value', () => {
    const result = parseJsonc('{\n // note\n "nested": {"items": [1,],},\n}', {
      sourceId: 'project',
      uri: 'file:///config.jsonc',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ nested: { items: [1] } });
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(Object.isFrozen((result.value as { nested: JsonValue }).nested)).toBe(true);
      expect(result.source).toEqual({ sourceId: 'project', uri: 'file:///config.jsonc' });
    }
  });

  it('rejects duplicates at every nested path, including escaped keys', () => {
    const result = parseJsonc('{"a":{"x":1,"x":2},"a/b":true,"a/b":false}', { sourceId: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(
        result.diagnostics.filter((item) => item.code === 'promptiris.config.duplicate-key'),
      ).toHaveLength(2);
  });

  it('rejects malformed comments and empty input with safe locations', () => {
    for (const text of ['/* unterminated', '']) {
      const result = parseJsonc(text, { sourceId: 'x', uri: 'config' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics.length).toBeGreaterThan(0);
        const [first] = result.diagnostics;
        expect(first).toBeDefined();
        if (!first) continue;
        expect(first).not.toHaveProperty('raw');
        expect(first.location?.line).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('returns the exact safe syntax diagnostic contract', () => {
    expect(parseJsonc('{"x": }', { sourceId: 'project', uri: 'config.jsonc' })).toEqual({
      ok: false,
      diagnostics: [
        {
          schemaVersion: '1',
          id: 'configuration.promptiris.config.invalid-jsonc',
          code: 'promptiris.config.invalid-jsonc',
          category: 'configuration',
          severity: 'error',
          title: 'Invalid configuration',
          detail: 'JSONC syntax is invalid.',
          sourceId: 'project',
          location: { uri: 'config.jsonc', line: 1, column: 7 },
        },
      ],
    });
  });

  it('computes exact CRLF source coordinates', () => {
    const result = parseJsonc('{\r\n  "x": }', { sourceId: 'project', uri: 'config.jsonc' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.location).toEqual({
      uri: 'config.jsonc',
      line: 2,
      column: 8,
    });
  });

  it('uses the error offset rather than trailing source lines', () => {
    const result = parseJsonc('{"x":,\n"y": 1}', { sourceId: 'project' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.location).toEqual({ line: 1, column: 6 });
  });

  it('does not conflate escaped and literal property paths', () => {
    expect(parseJsonc('{"a/b": 1, "a~1b": 2, "a": {"b": 3}}', { sourceId: 'project' }).ok).toBe(
      true,
    );
  });

  it.each([
    ['null', null],
    ['true', true],
    ['1', 1],
    ['"text"', 'text'],
    ['[1, false, null]', [1, false, null]],
  ])('accepts every JSON value family: %s', (text, expected) => {
    const result = parseJsonc(text, { sourceId: 'primitive' });
    expect(result.ok && result.value).toEqual(expected);
  });
});

describe('validateSecretReference', () => {
  it.each([
    [{ ref: 'env:OPENAI_API_KEY' }, true],
    [{ ref: 'keychain:service.account' }, true],
    [{ ref: 'plugin:acme/vault-key' }, true],
    [{ ref: 'env:' }, false],
    [{ ref: 'OPENAI_API_KEY' }, false],
    [{ ref: 'env:KEY', extra: 'nope' }, false],
    [{}, false],
    [null, false],
    [[], false],
    [{ ref: 42 }, false],
    [{ ref: 'ENV:KEY' }, false],
    [{ ref: 'env:KEY WITH SPACE' }, false],
    [{ ref: 'env::KEY' }, false],
    [{ ref: '!env:KEY' }, false],
    ['env:KEY', false],
  ])('validates %j', (value, expected) => expect(validateSecretReference(value)).toBe(expected));
});
