import { describe, expect, it } from 'vitest';
import providerAjvOptions from './provider-ajv-options.json' with { type: 'json' };
import {
  validateProviderConfiguration,
  validateProviderFailure,
  validateProviderGenerateRequest,
  validateProviderGenerateResult,
} from './index.js';

const configuration = {
  schemaVersion: '1',
  binding: {
    provider: 'example/provider',
    model: 'small-model',
    endpoint: 'https://provider.example.test/v1',
    fingerprint: 'binding-a',
  },
  evidence: [
    {
      evidenceId: 'text',
      capability: 'provider/text',
      bindingFingerprint: 'binding-a',
      state: 'supported',
      source: { kind: 'configuration', id: 'project' },
    },
  ],
} as const;

describe('portable Provider contract', () => {
  it('pins strict AJV validation in an inspectable policy artifact', () => {
    expect(providerAjvOptions).toEqual({ strict: true });
  });

  it('validates configuration with binding-scoped evidence', () => {
    expect(validateProviderConfiguration(configuration)).toBe(true);
    expect(
      validateProviderConfiguration({
        ...configuration,
        evidence: [{ ...configuration.evidence[0], capability: 'not namespaced' }],
      }),
    ).toBe(false);
  });

  it('requires lowercase 64-hex sha256 evidence digests', () => {
    const digest = `sha256:${'a'.repeat(64)}`;
    const withDigest = { ...configuration, evidence: [{ ...configuration.evidence[0], digest }] };

    expect(validateProviderConfiguration(withDigest)).toBe(true);
    for (const invalidDigest of [
      `sha256:${'a'.repeat(63)}`,
      `sha256:${'a'.repeat(65)}`,
      `sha256:${'A'.repeat(64)}`,
      `sha256:${'g'.repeat(64)}`,
      `sha512:${'a'.repeat(64)}`,
      `xsha256:${'a'.repeat(64)}`,
    ]) {
      expect(
        validateProviderConfiguration({
          ...configuration,
          evidence: [{ ...configuration.evidence[0], digest: invalidDigest }],
        }),
      ).toBe(false);
    }

    expect(
      validateProviderConfiguration({
        ...configuration,
        evidence: [
          configuration.evidence[0],
          { ...configuration.evidence[0], evidenceId: 'bad', digest: `x${digest}` },
        ],
      }),
    ).toBe(false);
  });

  it('rejects unknown properties and does not coerce or default values', () => {
    const request = {
      schemaVersion: '1',
      id: 'request-a',
      messages: [{ role: 'user', content: 'hello' }],
      requiredCapabilities: ['provider/text'],
    } as const;

    expect(validateProviderGenerateRequest({ ...request, maxOutputTokens: '12' })).toBe(false);
    expect(validateProviderGenerateRequest({ ...request, defaultsApplied: true })).toBe(false);
    expect(
      validateProviderGenerateRequest({
        ...request,
        messages: [{ ...request.messages[0], traceId: 'x' }],
      }),
    ).toBe(false);

    const failure = {
      schemaVersion: '1',
      kind: 'network',
      message: 'offline',
      retryable: true,
      diagnostics: [],
    } as const;
    expect(validateProviderFailure({ ...failure, retryable: 'true' })).toBe(false);
    expect(validateProviderFailure({ ...failure, diagnostics: undefined })).toBe(false);
  });

  it('validates portable requests and rejects runtime controls', () => {
    const request = {
      schemaVersion: '1',
      id: 'request-a',
      messages: [{ role: 'user', content: 'hello' }],
      requiredCapabilities: ['provider/text'],
      maxOutputTokens: 12,
      temperature: 0.3,
      providerOptions: { 'example/reasoning': false },
    } as const;
    expect(validateProviderGenerateRequest(request)).toBe(true);
    expect(validateProviderGenerateRequest({ ...request, signal: {} })).toBe(false);
    expect(
      validateProviderGenerateRequest({
        ...request,
        requiredCapabilities: ['provider/text', 'provider/text'],
      }),
    ).toBe(false);
  });

  it('validates normalized results and failures with safe diagnostics', () => {
    expect(
      validateProviderGenerateResult({
        schemaVersion: '1',
        requestId: 'request-a',
        bindingFingerprint: 'binding-a',
        content: 'hello',
        finishReason: 'stop',
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
        diagnostics: [],
      }),
    ).toBe(true);
    expect(
      validateProviderFailure({
        schemaVersion: '1',
        kind: 'rate-limit',
        message: 'slow down',
        retryable: true,
        diagnostics: [
          {
            schemaVersion: '1',
            id: 'provider-1',
            code: 'provider/rate-limit',
            category: 'provider',
            severity: 'warning',
            title: 'Rate limited',
          },
        ],
      }),
    ).toBe(true);
    expect(
      validateProviderGenerateResult({
        schemaVersion: '1',
        requestId: 'request-a',
        bindingFingerprint: 'binding-a',
        content: 'hello',
        finishReason: 'error',
        diagnostics: [],
      }),
    ).toBe(false);
  });
});
