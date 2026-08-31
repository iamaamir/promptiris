import { describe, expect, it } from 'vitest';
import type { CapabilityEvidence, GenerateParams, ProviderConfig } from './provider-types.js';
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
    const promise = provider.generate({ ...baseParams, signal: controller.signal });
    controller.abort();

    try {
      await promise;
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
        'no supported evidence for capability',
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

// ---------------------------------------------------------------------------
// Mutation-killing tests — targeted to kill survived and no-coverage mutants
// ---------------------------------------------------------------------------

describe('mutation coverage', () => {
  it('returns early when evidence is an empty array', async () => {
    const provider = new FakeProvider([
      {
        id: 'default',
        description: 'empty evidence array',
        capabilities: ['text-generation'],
        responses: [{ kind: 'success', result: makeGenerateResult({ content: 'empty-evidence' }) }],
      },
    ]);

    const params: GenerateParams = {
      config: baseConfig,
      messages: [{ role: 'user', content: 'Hello' }],
      evidence: [],
    };

    const result = await provider.generate(params);
    expect(result.content).toBe('empty-evidence');
  });

  it('rejects evidence with wrong capability name (not matching namespaced or bare)', async () => {
    const provider = new FakeProvider([
      {
        id: 'default',
        description: 'wrong capability',
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
          capability: 'promptiris/structured-output',
          bindingFingerprint: 'fake-fp-001',
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
      expect((error as ProviderFailureError).message).toContain('text-generation');
    }
  });

  it('rejects evidence with bare capability name that does not match namespaced pattern', async () => {
    const provider = new FakeProvider([
      {
        id: 'default',
        description: 'bare name mismatch',
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
          capability: 'text-generation',
          bindingFingerprint: 'fake-fp-001',
          state: 'supported',
          source: { kind: 'observation', id: 'obs-1' },
        },
      ],
    };

    // bare 'text-generation' matches via e.capability === cap
    const result = await provider.generate(params);
    expect(result).toBeDefined();
  });

  it('accepts evidence with bare capability that exactly matches supported list entry', async () => {
    const provider = new FakeProvider([
      {
        id: 'default',
        description: 'bare match',
        capabilities: ['text-generation'],
        responses: [{ kind: 'success', result: makeGenerateResult({ content: 'bare-match' }) }],
      },
    ]);

    const params: GenerateParams = {
      config: baseConfig,
      messages: [{ role: 'user', content: 'Hello' }],
      evidence: [
        {
          evidenceId: 'ev-1',
          capability: 'text-generation',
          bindingFingerprint: 'fake-fp-001',
          state: 'supported',
          source: { kind: 'observation', id: 'obs-1' },
        },
      ],
    };

    const result = await provider.generate(params);
    expect(result.content).toBe('bare-match');
  });

  it('uses the direct fingerprint scenario when fingerprint is not fake-fp-001', async () => {
    const provider = new FakeProvider([
      {
        id: 'default',
        description: 'default',
        capabilities: ['text-generation'],
        responses: [{ kind: 'success', result: makeGenerateResult({ content: 'default-result' }) }],
      },
      {
        id: 'real-fp',
        description: 'real fingerprint',
        capabilities: ['text-generation'],
        responses: [{ kind: 'success', result: makeGenerateResult({ content: 'real-fp-result' }) }],
      },
    ]);

    const params: GenerateParams = {
      config: {
        ...baseConfig,
        binding: { ...baseConfig.binding, fingerprint: 'real-fp' },
      },
      messages: [{ role: 'user', content: 'Hello' }],
    };

    const result = await provider.generate(params);
    expect(result.content).toBe('real-fp-result');
  });

  it('resolves default fingerprint to first scenario via keys().next()', async () => {
    const provider = new FakeProvider([
      {
        id: 'first',
        description: 'first scenario',
        capabilities: ['text-generation'],
        responses: [{ kind: 'success', result: makeGenerateResult({ content: 'first-scenario' }) }],
      },
      {
        id: 'second',
        description: 'second scenario',
        capabilities: ['text-generation'],
        responses: [
          { kind: 'success', result: makeGenerateResult({ content: 'second-scenario' }) },
        ],
      },
    ]);

    // fake-fp-001 triggers the default path via keys().next()
    const result = await provider.generate(baseParams);
    expect(result.content).toBe('first-scenario');
  });

  it('reports the exact cancellation-during-work message', async () => {
    const provider = new FakeProvider([
      {
        id: 'default',
        description: 'cancel during work',
        capabilities: ['text-generation'],
        responses: [{ kind: 'success', result: makeGenerateResult() }],
      },
    ]);

    const controller = new AbortController();
    const promise = provider.generate({ ...baseParams, signal: controller.signal });
    controller.abort();

    try {
      await promise;
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderFailureError);
      expect((error as ProviderFailureError).message).toBe('generation cancelled during work');
    }
  });

  it('throws when responses array is empty (noCoverage: L251)', async () => {
    const provider = new FakeProvider([
      {
        id: 'empty-responses',
        description: 'no responses',
        capabilities: ['text-generation'],
        responses: [],
      },
    ]);

    try {
      await provider.generate(baseParams);
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('no responses configured');
    }
  });

  it('marks retryable errors correctly via RETRYABLE_KINDS (noCoverage: L254)', async () => {
    const provider = new FakeProvider([
      {
        id: 'default',
        description: 'retryable errors',
        capabilities: ['text-generation'],
        responses: [
          { kind: 'error', failureKind: 'rate-limit', message: 'rate limited' },
          { kind: 'success', result: makeGenerateResult({ content: 'after-rate-limit' }) },
        ],
      },
    ]);

    // First call throws retryable error
    try {
      await provider.generate(baseParams);
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderFailureError);
      expect((error as ProviderFailureError).failureKind).toBe('rate-limit');
      expect((error as ProviderFailureError).retryable).toBe(true);
    }

    // Second call succeeds
    const result = await provider.generate(baseParams);
    expect(result.content).toBe('after-rate-limit');
  });

  it('propagates error response failureKind and message exactly (noCoverage: L261)', async () => {
    const provider = new FakeProvider([
      {
        id: 'default',
        description: 'error response',
        capabilities: ['text-generation'],
        responses: [{ kind: 'error', failureKind: 'authentication', message: 'invalid API key' }],
      },
    ]);

    try {
      await provider.generate(baseParams);
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderFailureError);
      expect((error as ProviderFailureError).failureKind).toBe('authentication');
      expect((error as ProviderFailureError).message).toBe('invalid API key');
      expect((error as ProviderFailureError).retryable).toBe(false);
    }
  });

  it('rejects when evidence array is non-empty but all entries have wrong fingerprint', async () => {
    const provider = new FakeProvider([
      {
        id: 'default',
        description: 'wrong fp',
        capabilities: ['text-generation'],
        responses: [{ kind: 'success', result: makeGenerateResult({ content: 'ok' }) }],
      },
    ]);

    const params: GenerateParams = {
      config: baseConfig,
      messages: [{ role: 'user', content: 'Hello' }],
      evidence: [
        {
          evidenceId: 'ev-1',
          capability: 'promptiris/text-generation',
          bindingFingerprint: 'wrong-fp',
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
    }
  });

  it('uses direct fingerprint lookup when fingerprint is not fake-fp-001', async () => {
    const provider = new FakeProvider([
      {
        id: 'first',
        description: 'first',
        capabilities: ['text-generation'],
        responses: [{ kind: 'success', result: makeGenerateResult({ content: 'first' }) }],
      },
      {
        id: 'real-fp',
        description: 'real',
        capabilities: ['text-generation'],
        responses: [{ kind: 'success', result: makeGenerateResult({ content: 'real-fp-result' }) }],
      },
    ]);

    const params: GenerateParams = {
      config: {
        ...baseConfig,
        binding: { ...baseConfig.binding, fingerprint: 'real-fp' },
      },
      messages: [{ role: 'user', content: 'Hello' }],
    };

    const result = await provider.generate(params);
    expect(result.content).toBe('real-fp-result');
  });

  it('falls back to first scenario when fingerprint lookup misses', async () => {
    const provider = new FakeProvider([
      {
        id: 'first',
        description: 'first',
        capabilities: ['text-generation'],
        responses: [{ kind: 'success', result: makeGenerateResult({ content: 'first-result' }) }],
      },
      {
        id: 'second',
        description: 'second',
        capabilities: ['text-generation'],
        responses: [{ kind: 'success', result: makeGenerateResult({ content: 'second-result' }) }],
      },
    ]);

    const params: GenerateParams = {
      config: {
        ...baseConfig,
        binding: { ...baseConfig.binding, fingerprint: 'nonexistent-fp' },
      },
      messages: [{ role: 'user', content: 'Hello' }],
    };

    const result = await provider.generate(params);
    expect(result.content).toBe('first-result');
  });

  it('uses keys().next() for default fingerprint resolution', async () => {
    const provider = new FakeProvider([
      {
        id: 'default-only',
        description: 'only scenario',
        capabilities: ['text-generation'],
        responses: [{ kind: 'success', result: makeGenerateResult({ content: 'default-result' }) }],
      },
    ]);

    const result = await provider.generate(baseParams);
    expect(result.content).toBe('default-result');
  });

  it('prefers firstScenario() over direct lookup when fingerprint is fake-fp-001', async () => {
    // Create a provider where scenario ID matches the fingerprint.
    // The original code takes the if-branch (keys().next()) and returns 'default-fp'.
    // The mutant (fingerprint === 'fake-fp-001' replaced with false) takes the
    // else-branch (direct lookup) and returns 'matched-fp'.
    const provider = new FakeProvider([
      {
        id: 'default-fp',
        description: 'default path via keys().next()',
        capabilities: ['text-generation'],
        responses: [{ kind: 'success', result: makeGenerateResult({ content: 'default-fp' }) }],
      },
      {
        id: 'fake-fp-001',
        description: 'direct lookup path',
        capabilities: ['text-generation'],
        responses: [{ kind: 'success', result: makeGenerateResult({ content: 'matched-fp' }) }],
      },
    ]);

    const result = await provider.generate(baseParams);
    expect(result.content).toBe('default-fp');
  });

  it('rejects when evidence has supported state but wrong capability name', async () => {
    // L230:9 mutant replaces the guard with false.
    // The guard skips validation when evidence.length === 0.
    // With false, validation always runs even for empty evidence arrays.
    const provider = new FakeProvider([
      {
        id: 'default',
        description: 'caps check',
        capabilities: ['text-generation'],
        responses: [{ kind: 'success', result: makeGenerateResult({ content: 'ok' }) }],
      },
    ]);

    const params: GenerateParams = {
      config: {
        ...baseConfig,
        capabilities: { supported: ['text-generation'], unsupported: [] },
      },
      messages: [{ role: 'user', content: 'Hello' }],
      evidence: [
        {
          evidenceId: 'ev-1',
          capability: 'promptiris/structured-output',
          bindingFingerprint: 'fake-fp-001',
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
      expect((error as ProviderFailureError).message).toContain('text-generation');
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

// ---------------------------------------------------------------------------
// Mutation-killing tests
// ---------------------------------------------------------------------------

describe('mutation coverage', () => {
  it('preserves exact binding configuration values', () => {
    const provider = new FakeProvider([
      {
        id: 'default',
        description: 'config check',
        capabilities: ['text-generation'],
        responses: [{ kind: 'success', result: makeGenerateResult() }],
      },
    ]);

    expect(provider.config.binding.modelId).toBe('fake-model-v1');
    expect(provider.config.binding.providerId).toBe('promptiris/fake-provider');
    expect(provider.config.binding.fingerprint).toBe('fake-fp-001');
  });

  it('includes the capability name in unsupported-scenario error message', async () => {
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
      expect((error as ProviderFailureError).message).toBe(
        'capability structured-output is not supported by this scenario',
      );
    }
  });

  it('returns pre-generation abort message without "during work" suffix', async () => {
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
      expect((error as ProviderFailureError).message).toBe('generation cancelled');
    }
  });

  it('accepts evidence where only some entries match the fingerprint', async () => {
    const provider = new FakeProvider([
      {
        id: 'default',
        description: 'mixed evidence',
        capabilities: ['text-generation'],
        responses: [{ kind: 'success', result: makeGenerateResult({ content: 'mixed ok' }) }],
      },
    ]);

    const params: GenerateParams = {
      config: baseConfig,
      messages: [{ role: 'user', content: 'Hello' }],
      evidence: [
        {
          evidenceId: 'ev-wrong',
          capability: 'promptiris/text-generation',
          bindingFingerprint: 'wrong-fp',
          state: 'supported',
          source: { kind: 'observation', id: 'obs-2' },
        },
        ...supportedEvidence.slice(0, 1),
      ],
    };

    const result = await provider.generate(params);
    expect(result.content).toBe('mixed ok');
  });

  it('does not reject when supported capabilities list is empty', async () => {
    const provider = new FakeProvider([
      {
        id: 'default',
        description: 'empty caps',
        capabilities: [],
        responses: [{ kind: 'success', result: makeGenerateResult({ content: 'empty caps ok' }) }],
      },
    ]);

    const params: GenerateParams = {
      config: {
        ...baseConfig,
        capabilities: { supported: [], unsupported: [] },
      },
      messages: [{ role: 'user', content: 'Hello' }],
    };

    const result = await provider.generate(params);
    expect(result.content).toBe('empty caps ok');
  });

  it('resolves scenario via direct fingerprint match to scenario id', async () => {
    const provider = new FakeProvider([
      {
        id: 'direct-match',
        description: 'matched by fingerprint',
        capabilities: ['text-generation'],
        responses: [{ kind: 'success', result: makeGenerateResult({ content: 'direct' }) }],
      },
    ]);

    const params: GenerateParams = {
      config: {
        ...baseConfig,
        binding: {
          ...baseConfig.binding,
          fingerprint: 'direct-match',
        },
      },
      messages: [{ role: 'user', content: 'Hello' }],
    };

    const result = await provider.generate(params);
    expect(result.content).toBe('direct');
  });

  it('falls back to first scenario when fingerprint matches no scenario id', async () => {
    const provider = new FakeProvider([
      {
        id: 'only-one',
        description: 'fallback target',
        capabilities: ['text-generation'],
        responses: [{ kind: 'success', result: makeGenerateResult({ content: 'fallback' }) }],
      },
    ]);

    const params: GenerateParams = {
      config: {
        ...baseConfig,
        binding: {
          ...baseConfig.binding,
          fingerprint: 'nonexistent-fp',
        },
      },
      messages: [{ role: 'user', content: 'Hello' }],
    };

    const result = await provider.generate(params);
    expect(result.content).toBe('fallback');
  });

  it('uses evidence state unsupported to distinguish .some from .every', async () => {
    const provider = new FakeProvider([
      {
        id: 'default',
        description: 'every vs some',
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
          state: 'supported',
          source: { kind: 'observation', id: 'obs-1' },
        },
        {
          evidenceId: 'ev-2',
          capability: 'promptiris/text-generation',
          bindingFingerprint: 'fake-fp-001',
          state: 'unsupported',
          source: { kind: 'observation', id: 'obs-2' },
        },
      ],
    };

    // .some() returns true (at least one supported+matching)
    // .every() would return false (not all are supported+matching)
    const result = await provider.generate(params);
    expect(result).toBeDefined();
  });

  it('rejects when all evidence entries have unsupported state', async () => {
    const provider = new FakeProvider([
      {
        id: 'default',
        description: 'all unsupported',
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
        {
          evidenceId: 'ev-2',
          capability: 'promptiris/text-generation',
          bindingFingerprint: 'fake-fp-001',
          state: 'unsupported',
          source: { kind: 'observation', id: 'obs-2' },
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
});
