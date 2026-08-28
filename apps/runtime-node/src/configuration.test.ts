import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfiguration } from './configuration.js';

const temporaryDirectories: string[] = [];

async function configurationFile(contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'promptiris-configuration-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'promptiris.jsonc');
  await writeFile(path, contents);
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('runtime configuration loading', () => {
  it('loads JSONC, preserves logical secrets, and evaluates capabilities', async () => {
    const path = await configurationFile(`{
      // Project-local tracer input.
      "provider": {
        "bindingFingerprint": "binding-a",
        "apiKey": { "ref": "env:PROMPTIRIS_API_KEY" },
      },
      "capabilities": [
        { "capability": "provider/json", "bindingFingerprint": "binding-a", "requirement": "required" },
        { "capability": "provider/tools", "bindingFingerprint": "binding-a", "requirement": "preferred" },
        { "capability": "provider/vision", "bindingFingerprint": "binding-a", "requirement": "optional" },
      ],
      "evidence": [{
        "evidenceId": "configured-json",
        "capability": "provider/json",
        "bindingFingerprint": "binding-a",
        "state": "supported",
        "source": { "kind": "configuration", "id": "project" },
      }],
    }`);

    const result = await loadConfiguration(path);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toMatchObject({
      provider: { apiKey: { ref: 'env:PROMPTIRIS_API_KEY' } },
    });
    expect(result.resolutions.map(({ outcome }) => outcome)).toEqual([
      'satisfied',
      'fallback',
      'missing',
    ]);
    expect(result.resolutions[0]?.evidence[0]).toEqual({
      evidenceId: 'configured-json',
      capability: 'provider/json',
      bindingFingerprint: 'binding-a',
      state: 'supported',
      source: { kind: 'configuration', id: 'project' },
    });
    expect(result.trace.entries['']?.candidates[0]).toMatchObject({
      sourceId: 'project',
      location: { uri: path },
    });
    expect(result.trace.entries['/provider/apiKey']?.candidates[0]?.preview).toEqual({
      kind: 'redacted',
    });
  });

  it.each([
    ['duplicate key', '{ "capabilities": [], "capabilities": [], "evidence": [] }'],
    ['unknown key', '{ "capabilities": [], "evidence": [], "unknown": true }'],
    [
      'literal secret',
      '{ "provider": { "apiKey": "TOP_SECRET" }, "capabilities": [], "evidence": [] }',
    ],
    [
      'invalid evidence enum',
      '{ "capabilities": [], "evidence": [{ "evidenceId": "x", "capability": "p/x", "bindingFingerprint": "b", "state": "maybe", "source": { "kind": "configuration", "id": "p" } }] }',
    ],
  ])('rejects %s without returning source data', async (_name, contents) => {
    const result = await loadConfiguration(await configurationFile(contents));
    expect(result).toEqual({ ok: false });
    expect(JSON.stringify(result)).not.toContain('TOP_SECRET');
  });

  it('retains conflicting evidence as an inspectable resolution', async () => {
    const path = await configurationFile(`{
      "capabilities": [{ "capability": "p/x", "bindingFingerprint": "b", "requirement": "required" }],
      "evidence": [
        { "evidenceId": "yes", "capability": "p/x", "bindingFingerprint": "b", "state": "supported", "source": { "kind": "configuration", "id": "a" } },
        { "evidenceId": "no", "capability": "p/x", "bindingFingerprint": "b", "state": "unsupported", "source": { "kind": "configuration", "id": "b" } }
      ]
    }`);
    const result = await loadConfiguration(path);
    expect(result.ok && result.resolutions[0]?.outcome).toBe('conflict');
  });

  it('materializes empty capability defaults', async () => {
    const result = await loadConfiguration(await configurationFile('{}'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toEqual({ provider: {}, capabilities: [], evidence: [] });
    expect(result.resolutions).toEqual([]);
  });

  it.each([
    [
      'capability without namespace',
      {
        capabilities: [{ capability: 'plain', bindingFingerprint: 'b', requirement: 'required' }],
        evidence: [],
      },
    ],
    [
      'capability with extra slash',
      {
        capabilities: [{ capability: 'p/x/y', bindingFingerprint: 'b', requirement: 'required' }],
        evidence: [],
      },
    ],
    [
      'capability with whitespace',
      {
        capabilities: [{ capability: 'p/x y', bindingFingerprint: 'b', requirement: 'required' }],
        evidence: [],
      },
    ],
    [
      'empty binding',
      {
        capabilities: [{ capability: 'p/x', bindingFingerprint: ' ', requirement: 'required' }],
        evidence: [],
      },
    ],
    [
      'invalid requirement',
      {
        capabilities: [{ capability: 'p/x', bindingFingerprint: 'b', requirement: 'mandatory' }],
        evidence: [],
      },
    ],
    [
      'missing evidence id',
      {
        capabilities: [],
        evidence: [
          {
            capability: 'p/x',
            bindingFingerprint: 'b',
            state: 'supported',
            source: { kind: 'configuration', id: 'x' },
          },
        ],
      },
    ],
    [
      'empty evidence binding',
      {
        capabilities: [],
        evidence: [
          {
            evidenceId: 'x',
            capability: 'p/x',
            bindingFingerprint: '',
            state: 'supported',
            source: { kind: 'configuration', id: 'x' },
          },
        ],
      },
    ],
    [
      'invalid evidence source',
      {
        capabilities: [],
        evidence: [
          {
            evidenceId: 'x',
            capability: 'p/x',
            bindingFingerprint: 'b',
            state: 'supported',
            source: { kind: 'guess', id: 'x' },
          },
        ],
      },
    ],
    [
      'missing evidence source',
      {
        capabilities: [],
        evidence: [
          {
            evidenceId: 'x',
            capability: 'p/x',
            bindingFingerprint: 'b',
            state: 'supported',
          },
        ],
      },
    ],
    [
      'null evidence source',
      {
        capabilities: [],
        evidence: [
          {
            evidenceId: 'x',
            capability: 'p/x',
            bindingFingerprint: 'b',
            state: 'supported',
            source: null,
          },
        ],
      },
    ],
    [
      'empty evidence source id',
      {
        capabilities: [],
        evidence: [
          {
            evidenceId: 'x',
            capability: 'p/x',
            bindingFingerprint: 'b',
            state: 'supported',
            source: { kind: 'policy', id: '' },
          },
        ],
      },
    ],
    [
      'non-string digest',
      {
        capabilities: [],
        evidence: [
          {
            evidenceId: 'x',
            capability: 'p/x',
            bindingFingerprint: 'b',
            state: 'supported',
            source: { kind: 'profile', id: 'x' },
            digest: 42,
          },
        ],
      },
    ],
  ])('rejects malformed typed capability data: %s', async (_name, value) => {
    expect(await loadConfiguration(await configurationFile(JSON.stringify(value)))).toEqual({
      ok: false,
    });
  });

  it('accepts file URLs and preserves optional evidence digests', async () => {
    const path = await configurationFile(
      JSON.stringify({
        capabilities: [{ capability: 'p/x', bindingFingerprint: 'b', requirement: 'required' }],
        evidence: [
          {
            evidenceId: 'x',
            capability: 'p/x',
            bindingFingerprint: 'b',
            state: 'supported',
            source: { kind: 'profile', id: 'profile-a' },
            digest: 'sha256:evidence',
          },
        ],
      }),
    );
    const result = await loadConfiguration(new URL(`file://${path}`).href);
    expect(result.ok && result.resolutions[0]?.evidence[0]?.digest).toBe('sha256:evidence');
  });

  it.each(['policy', 'configuration', 'profile', 'observation'] as const)(
    'accepts the declared evidence source kind %s',
    async (kind) => {
      const value = {
        capabilities: [{ capability: 'p/x', bindingFingerprint: 'b', requirement: 'required' }],
        evidence: [
          {
            evidenceId: kind,
            capability: 'p/x',
            bindingFingerprint: 'b',
            state: 'supported',
            source: { kind, id: kind },
          },
        ],
      };
      const result = await loadConfiguration(await configurationFile(JSON.stringify(value)));
      expect(result.ok && result.resolutions[0]?.outcome).toBe('satisfied');
    },
  );

  it('rejects missing and non-file resources safely', async () => {
    expect(await loadConfiguration('/path/that/does/not/exist')).toEqual({ ok: false });
    expect(await loadConfiguration('https://example.test/config.jsonc')).toEqual({ ok: false });
  });
});
