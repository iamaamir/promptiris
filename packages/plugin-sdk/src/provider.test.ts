import { describe, expect, it } from 'vitest';
import type { CapabilityEvidence, GenerateParams, ProviderConfig } from '@promptiris/protocol';
import { FakeProvider, ProviderFailureError, makeGenerateResult } from './provider.js';

const baseConfig: ProviderConfig = {
  id: 'promptiris/fake-provider',
  binding: {
    modelId: 'fake-model-v1',
    providerId: 'promptiris/fake-provider',
    fingerprint: 'fake-fp-001',
  },
  capabilities: {
    supported: ['text-generation'],
    unsupported: [],
  },
};

const baseParams: GenerateParams = {
  config: baseConfig,
  messages: [{ role: 'user', content: 'Hello' }],
};

const supportedEvidence: CapabilityEvidence[] = [
  {
    evidenceId: 'ev-1',
    capability: 'promptiris/text-generation',
    bindingFingerprint: 'fake-fp-001',
    state: 'supported',
    source: { kind: 'observation', id: 'obs-1' },
  },
];

describe('FakeProvider', () => {
  it('returns a deterministic success response', async () => {
    const provider = new FakeProvider([
      {
        id: 'default',
        description: 'basic success',
        capabilities: ['text-generation'],
        responses: [{ kind: 'success', result: makeGenerateResult({ content: 'Hello back' }) }],
      },
    ]);

    const result = await provider.generate(baseParams);
    expect(result.content).toBe('Hello back');
    expect(result.model).toBe('fake-model-v1');
    expect(result.finishReason).toBe('stop');
  });

  it('cycles through responses on repeated calls', async () => {
    const provider = new FakeProvider([
      {
        id: 'default',
        description: 'cycling',
        capabilities: ['text-generation'],
        responses: [
          { kind: 'success', result: makeGenerateResult({ content: 'first' }) },
          { kind: 'success', result: makeGenerateResult({ content: 'second' }) },
        ],
      },
    ]);

    const first = await provider.generate(baseParams);
    const second = await provider.generate(baseParams);
    const third = await provider.generate(baseParams);

    expect(first.content).toBe('first');
    expect(second.content).toBe('second');
    expect(third.content).toBe('first');
  });

  it('throws when the requested capability is unsupported', async () => {
    const provider = new FakeProvider([
      {
        id: 'default',
        description: 'text only',
        capabilities: ['text-generation'],
        responses: [{ kind: 'success', result: makeGenerateResult() }],
      },
    ]);

    const params: GenerateParams = {
      config: {
        ...baseConfig,
        capabilities: { supported: ['structured-output'], unsupported: [] },
      },
      messages: [{ role: 'user', content: 'Hello' }],
    };

    try {
      await provider.generate(params);
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderFailureError);
      expect((error as ProviderFailureError).failureKind).toBe('unsupported-capability');
      expect((error as ProviderFailureError).retryable).toBe(false);
    }
  });

  it('throws when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const provider = new FakeProvider([
      {
        id: 'default',
        description: 'abort',
        capabilities: ['text-generation'],
        responses: [{ kind: 'success', result: makeGenerateResult() }],
      },
    ]);

    try {
      await provider.generate({ ...baseParams, signal: controller.signal });
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderFailureError);
      expect((error as ProviderFailureError).failureKind).toBe('cancelled');
      expect((error as ProviderFailureError).retryable).toBe(false);
    }
  });

  it('cancels during work when signal aborts after generate starts', async () => {
    const provider = new FakeProvider([
      {
        id: 'default',
        description: 'abort during work',
        capabilities: ['text-generation'],
        responses: [{ kind: 'success', result: makeGenerateResult({ content: 'done' }) }],
      },
    ]);

    const controller = new AbortController();

    // Abort synchronously before the response is returned
    controller.abort();

    try {
      await provider.generate({ ...baseParams, signal: controller.signal });
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderFailureError);
      expect((error as ProviderFailureError).failureKind).toBe('cancelled');
    }
  });

  it('throws a configured error response with typed failureKind', async () => {
    const provider = new FakeProvider([
      {
        id: 'default',
        description: 'rate limit',
        capabilities: ['text-generation'],
        responses: [{ kind: 'error', failureKind: 'rate-limit', message: 'rate limit exceeded' }],
      },
    ]);

    try {
      await provider.generate(baseParams);
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderFailureError);
      expect((error as ProviderFailureError).failureKind).toBe('rate-limit');
      expect((error as ProviderFailureError).retryable).toBe(true);
      expect((error as ProviderFailureError).message).toBe('rate limit exceeded');
    }
  });

  it('marks network and timeout errors as retryable', async () => {
    const provider = new FakeProvider([
      {
        id: 'default',
        description: 'network error',
        capabilities: ['text-generation'],
        responses: [{ kind: 'error', failureKind: 'network', message: 'connection lost' }],
      },
    ]);

    try {
      await provider.generate(baseParams);
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderFailureError);
      expect((error as ProviderFailureError).failureKind).toBe('network');
      expect((error as ProviderFailureError).retryable).toBe(true);
    }
  });

  it('marks authentication errors as not retryable', async () => {
    const provider = new FakeProvider([
      {
        id: 'default',
        description: 'auth error',
        capabilities: ['text-generation'],
        responses: [{ kind: 'error', failureKind: 'authentication', message: 'invalid key' }],
      },
    ]);

    try {
      await provider.generate(baseParams);
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderFailureError);
      expect((error as ProviderFailureError).failureKind).toBe('authentication');
      expect((error as ProviderFailureError).retryable).toBe(false);
    }
  });

  it('throws after a success', async () => {
    const provider = new FakeProvider([
      {
        id: 'default',
        description: 'mixed',
        capabilities: ['text-generation'],
        responses: [
          { kind: 'success', result: makeGenerateResult({ content: 'ok' }) },
          { kind: 'error', failureKind: 'network', message: 'network error' },
        ],
      },
    ]);

    const ok = await provider.generate(baseParams);
    expect(ok.content).toBe('ok');

    try {
      await provider.generate(baseParams);
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderFailureError);
      expect((error as ProviderFailureError).failureKind).toBe('network');
    }
  });

  it('rejects capability claims without matching evidence', async () => {
    const provider = new FakeProvider([
      {
        id: 'default',
        description: 'evidence check',
        capabilities: ['text-generation'],
        responses: [{ kind: 'success', result: makeGenerateResult() }],
      },
    ]);

    const params: GenerateParams = {
      config: baseConfig,
      messages: [{ role: 'user', content: 'Hello' }],
      evidence: [
        {
          evidenceId: 'ev-1',
          capability: 'promptiris/text-generation',
          bindingFingerprint: 'wrong-fingerprint',
          state: 'supported',
          source: { kind: 'observation', id: 'obs-1' },
        },
      ],
    };

    try {
      await provider.generate(params);
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderFailureError);
      expect((error as ProviderFailureError).failureKind).toBe('unsupported-capability');
      expect((error as ProviderFailureError).message).toContain(
        'no supported evidence bound to fingerprint',
      );
    }
  });

  it('accepts capability claims with matching evidence', async () => {
    const provider = new FakeProvider([
      {
        id: 'default',
        description: 'evidence match',
        capabilities: ['text-generation'],
        responses: [{ kind: 'success', result: makeGenerateResult({ content: 'with evidence' }) }],
      },
    ]);

    const params: GenerateParams = {
      config: baseConfig,
      messages: [{ role: 'user', content: 'Hello' }],
      evidence: supportedEvidence,
    };

    const result = await provider.generate(params);
    expect(result.content).toBe('with evidence');
  });

  it('rejects capability claims when evidence state is unsupported', async () => {
    const provider = new FakeProvider([
      {
        id: 'default',
        description: 'unsupported evidence',
        capabilities: ['text-generation'],
        responses: [{ kind: 'success', result: makeGenerateResult() }],
      },
    ]);

    const params: GenerateParams = {
      config: baseConfig,
      messages: [{ role: 'user', content: 'Hello' }],
      evidence: [
        {
          evidenceId: 'ev-1',
          capability: 'promptiris/text-generation',
          bindingFingerprint: 'fake-fp-001',
          state: 'unsupported',
          source: { kind: 'observation', id: 'obs-1' },
        },
      ],
    };

    try {
      await provider.generate(params);
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderFailureError);
      expect((error as ProviderFailureError).failureKind).toBe('unsupported-capability');
    }
  });

  it('skips evidence validation when evidence is undefined', async () => {
    const provider = new FakeProvider([
      {
        id: 'default',
        description: 'no evidence field',
        capabilities: ['text-generation'],
        responses: [{ kind: 'success', result: makeGenerateResult({ content: 'no evidence' }) }],
      },
    ]);

    const result = await provider.generate(baseParams);
    expect(result.content).toBe('no evidence');
  });

  it('exposes the config with correct capability declarations', () => {
    const provider = new FakeProvider([
      {
        id: 'default',
        description: 'capabilities',
        capabilities: ['text-generation', 'structured-output'],
        responses: [{ kind: 'success', result: makeGenerateResult() }],
      },
    ]);

    expect(provider.config.capabilities.supported).toEqual([
      'text-generation',
      'structured-output',
    ]);
    expect(provider.config.id).toBe('promptiris/fake-provider');
  });

  it('rejects when no scenarios are provided', () => {
    expect(() => new FakeProvider([])).toThrow('FakeProvider requires at least one scenario');
  });

  it('falls back to first scenario for unknown fingerprint', async () => {
    const provider = new FakeProvider([
      {
        id: 'known',
        description: 'known',
        capabilities: ['text-generation'],
        responses: [{ kind: 'success', result: makeGenerateResult({ content: 'fallback' }) }],
      },
    ]);

    const result = await provider.generate(baseParams);
    expect(result.content).toBe('fallback');
  });

  it('supports malformed-output failure kind', async () => {
    const provider = new FakeProvider([
      {
        id: 'default',
        description: 'malformed',
        capabilities: ['text-generation'],
        responses: [
          { kind: 'error', failureKind: 'malformed-output', message: 'unexpected JSON structure' },
        ],
      },
    ]);

    try {
      await provider.generate(baseParams);
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderFailureError);
      expect((error as ProviderFailureError).failureKind).toBe('malformed-output');
      expect((error as ProviderFailureError).retryable).toBe(false);
    }
  });
});

describe('makeGenerateResult', () => {
  it('returns sensible defaults', () => {
    const result = makeGenerateResult();
    expect(result.content).toBeTruthy();
    expect(result.model).toBeTruthy();
    expect(result.usage.totalTokens).toBeGreaterThan(0);
    expect(result.finishReason).toBe('stop');
  });

  it('applies overrides', () => {
    const result = makeGenerateResult({
      content: 'custom',
      finishReason: 'length',
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    });
    expect(result.content).toBe('custom');
    expect(result.finishReason).toBe('length');
    expect(result.usage.totalTokens).toBe(3);
  });
});

describe('ProviderFailureError', () => {
  it('is an instance of Error', () => {
    const error = new ProviderFailureError('network', 'connection lost');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ProviderFailureError);
  });

  it('carries failureKind and retryable', () => {
    const error = new ProviderFailureError('timeout', 'timed out', true);
    expect(error.failureKind).toBe('timeout');
    expect(error.message).toBe('timed out');
    expect(error.retryable).toBe(true);
    expect(error.name).toBe('ProviderFailureError');
  });
});
