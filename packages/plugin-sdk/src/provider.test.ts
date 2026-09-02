import { describe, expect, it } from 'vitest';
import type {
  ProviderConfiguration,
  ProviderGenerateRequest,
  ProviderGenerateResult,
} from '@promptiris/protocol';
import {
  FakeProvider,
  ProviderFailureError,
  type Provider,
  type ProviderGenerateRequest as PublicRequest,
} from './index.js';

const configuration: ProviderConfiguration = {
  schemaVersion: '1',
  binding: { provider: 'example/provider', model: 'test', fingerprint: 'binding-a' },
  evidence: [
    {
      evidenceId: 'text',
      capability: 'provider/text',
      bindingFingerprint: 'binding-a',
      state: 'supported',
      source: { kind: 'configuration', id: 'test' },
    },
  ],
};

const request: ProviderGenerateRequest = {
  schemaVersion: '1',
  id: 'request-a',
  messages: [{ role: 'user', content: 'hello' }],
  requiredCapabilities: ['provider/text'],
};

const result = (content: string): ProviderGenerateResult => ({
  schemaVersion: '1',
  requestId: 'request-a',
  bindingFingerprint: 'binding-a',
  content,
  finishReason: 'stop',
  diagnostics: [],
});

describe('FakeProvider', () => {
  it('replays deterministic successful responses and implements the public interface', async () => {
    const provider: Provider = new FakeProvider(configuration, [
      {
        requestId: request.id,
        responses: [
          { kind: 'success', value: result('first') },
          { kind: 'success', value: result('second') },
        ],
      } as const,
    ]);

    await expect(provider.generate(request)).resolves.toMatchObject({ content: 'first' });
    await expect(provider.generate(request)).resolves.toMatchObject({ content: 'second' });
    const exported: PublicRequest = request;
    expect(exported.id).toBe(request.id);
  });

  it('requires exact, binding-scoped evidence for every requested capability', async () => {
    const provider = new FakeProvider(
      {
        ...configuration,
        evidence: [
          {
            evidenceId: 'tools',
            capability: 'provider/tools',
            bindingFingerprint: 'binding-a',
            state: 'supported',
            source: { kind: 'configuration', id: 'test' },
          },
        ],
      } as const,
      [{ requestId: request.id, responses: [{ kind: 'success', value: result('unused') }] }],
    );

    await expect(provider.generate(request)).rejects.toMatchObject({
      failure: {
        kind: 'unsupported-capability',
        message: 'capability is not evidenced: provider/text',
        retryable: false,
      } as const,
    });
  });

  it.each([
    [
      'wrong fingerprint',
      {
        evidenceId: 'text',
        capability: 'provider/text',
        bindingFingerprint: 'other',
        state: 'supported' as const,
        source: { kind: 'configuration' as const, id: 'test' },
      } as const,
    ],
    [
      'unsupported state',
      {
        evidenceId: 'text',
        capability: 'provider/text',
        bindingFingerprint: 'binding-a',
        state: 'unsupported' as const,
        source: { kind: 'configuration' as const, id: 'test' },
      } as const,
    ],
  ])('rejects capability evidence with %s', async (_label, evidence) => {
    const provider = new FakeProvider({ ...configuration, evidence: [evidence] }, [
      { requestId: request.id, responses: [{ kind: 'success', value: result('unused') }] },
    ]);
    await expect(provider.generate(request)).rejects.toMatchObject({
      failure: {
        kind: 'unsupported-capability',
        message: 'capability is not evidenced: provider/text',
      },
    });
  });

  it('accepts one matching capability among unrelated evidence', async () => {
    const provider = new FakeProvider(
      {
        ...configuration,
        evidence: [
          {
            evidenceId: 'unrelated',
            capability: 'provider/tools',
            bindingFingerprint: 'binding-a',
            state: 'unsupported',
            source: { kind: 'configuration', id: 'test' },
          },
          configuration.evidence[0]!,
        ],
      },
      [{ requestId: request.id, responses: [{ kind: 'success', value: result('accepted') }] }],
    );

    await expect(provider.generate(request)).resolves.toMatchObject({ content: 'accepted' });
  });

  it('honours cancellation before and during generation', async () => {
    const provider = new FakeProvider(configuration, [
      { requestId: request.id, responses: [{ kind: 'success', value: result('unused') }] },
    ]);
    const before = new AbortController();
    before.abort();
    await expect(provider.generate(request, { signal: before.signal })).rejects.toMatchObject({
      failure: { kind: 'cancelled', message: 'generation cancelled', retryable: false },
    });

    const during = new AbortController();
    const pending = provider.generate(request, { signal: during.signal });
    during.abort();
    await expect(pending).rejects.toMatchObject({
      failure: { kind: 'cancelled', message: 'generation cancelled', retryable: false },
    });
  });

  it('normalizes malformed provider responses', async () => {
    const provider = new FakeProvider(configuration, [
      {
        requestId: request.id,
        responses: [{ kind: 'success', value: { content: 'missing portable fields' } }],
      },
    ]);

    await expect(provider.generate(request)).rejects.toMatchObject({
      failure: {
        kind: 'malformed-output',
        message: 'invalid provider result',
        retryable: false,
      },
    });
  });

  it('rejects an invalid provider request with its precise failure', async () => {
    const provider = new FakeProvider(configuration, []);
    await expect(
      provider.generate({ ...request, id: '' } as ProviderGenerateRequest),
    ).rejects.toEqual(
      expect.objectContaining({
        failure: expect.objectContaining({
          kind: 'malformed-output',
          message: 'invalid provider request',
          retryable: false,
        }),
      }),
    );
  });

  it('rejects an invalid portable failure', async () => {
    const provider = new FakeProvider(configuration, [
      { requestId: request.id, responses: [{ kind: 'failure', value: { kind: 'network' } }] },
    ]);
    await expect(provider.generate(request)).rejects.toMatchObject({
      failure: { kind: 'malformed-output', message: 'invalid provider failure', retryable: false },
    });
  });

  it.each([
    ['timeout', true],
    ['rate-limit', true],
    ['network', true],
    ['authentication', false],
    ['unknown', false],
  ] as const)('preserves retryability for %s failures', async (kind, retryable) => {
    const provider = new FakeProvider(configuration, [
      {
        requestId: request.id,
        responses: [
          {
            kind: 'failure',
            value: { schemaVersion: '1', kind, message: kind, retryable, diagnostics: [] },
          },
        ],
      },
    ]);
    await expect(provider.generate(request)).rejects.toMatchObject({
      failure: { kind, retryable },
    });
  });

  it('preserves classified portable failures and retryability', async () => {
    const provider = new FakeProvider(configuration, [
      {
        requestId: request.id,
        responses: [
          {
            kind: 'failure',
            value: {
              schemaVersion: '1',
              kind: 'rate-limit',
              message: 'slow down',
              retryable: true,
              diagnostics: [],
            },
          },
        ],
      },
    ]);

    await expect(provider.generate(request)).rejects.toEqual(
      expect.objectContaining({
        name: 'ProviderFailureError',
        failure: expect.objectContaining({ kind: 'rate-limit', retryable: true }),
      }),
    );
  });

  it('rejects calls after close', async () => {
    const provider = new FakeProvider(configuration, [
      { requestId: request.id, responses: [{ kind: 'success', value: result('unused') }] },
    ]);
    provider.close();
    await expect(provider.generate(request)).rejects.toMatchObject({
      name: 'ProviderFailureError',
      failure: { kind: 'unknown', message: 'provider is closed', retryable: false },
    });
  });

  it.each([
    [
      'request',
      { ...result('bad'), requestId: 'request-b' },
      'provider result request does not match',
    ],
    [
      'binding',
      { ...result('bad'), bindingFingerprint: 'binding-b' },
      'provider result binding does not match',
    ],
  ] as const)('rejects a result with mismatched %s', async (_label, value, message) => {
    const provider = new FakeProvider(configuration, [
      { requestId: request.id, responses: [{ kind: 'success', value }] },
    ]);
    await expect(provider.generate(request)).rejects.toMatchObject({
      failure: { kind: 'malformed-output', message, retryable: false },
    });
  });

  it.each([
    ['missing', []],
    ['empty', [{ requestId: request.id, responses: [] }]],
  ] as const)('reports a %s scenario precisely', async (_label, scenarios) => {
    const provider = new FakeProvider(configuration, scenarios);
    await expect(provider.generate(request)).rejects.toMatchObject({
      failure: { kind: 'unknown', message: 'no scenario for request: request-a', retryable: false },
    });
  });
});
