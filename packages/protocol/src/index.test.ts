import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  ContentLengthDecoder,
  encodeMessage,
  isPromptDocument,
  makeTextDocument,
  MAX_FRAME_BYTES,
  validateJsonValue,
  validatePromptDocument,
  validatePatch,
  validateProviderConfig,
  validateGenerateResult,
  validateProviderError,
  validateCapabilityEvidence,
  validateGenerateParams,
} from './index.js';
describe('Content-Length protocol', () => {
  it('models redacted configuration and binding-scoped capability contracts', () => {
    const inspect = {
      schemaVersion: '1',
      redacted: true,
      config: { credentials: { apiKey: { ref: 'env:OPENAI_API_KEY' } } },
      configTrace: {
        entries: {
          '/credentials/apiKey': {
            pointer: '/credentials/apiKey',
            schemaRule: 'secret-ref',
            candidates: [
              {
                sourceId: 'user',
                disposition: 'rejected',
                reason: 'secret',
                preview: { kind: 'secret-reference', scheme: 'env' },
              },
            ],
            merge: 'replace',
          },
        },
      },
      policies: [
        { policyId: 'host/policy', decision: 'denied', pointer: '/network', reason: 'disabled' },
      ],
      resolutions: [
        {
          capability: 'provider/text',
          bindingFingerprint: 'sha256:x',
          requirement: 'required',
          outcome: 'missing',
          evidence: [],
        },
      ],
      permissionHints: [{ effect: 'network', scope: 'api.openai.com' }],
    } satisfies import('./index.js').InspectResult;
    expect(JSON.stringify(inspect)).not.toContain('sk-');
    expect(inspect.configTrace.entries['/credentials/apiKey']?.pointer).toBe('/credentials/apiKey');
  });
  it('round trips fragmented frames', () => {
    const frame = encodeMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '1' },
    });
    const decoder = new ContentLengthDecoder();
    expect(decoder.push(frame.subarray(0, 10))).toEqual([]);
    expect(decoder.push(frame.subarray(10))).toEqual([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1' } },
    ]);
  });
  it('creates a text document', () =>
    expect(makeTextDocument('hello').content[0]?.text).toBe('hello'));
  it('validates the portable Prompt Document contract', () => {
    const valid = makeTextDocument('hello');
    expect(validatePromptDocument(valid)).toBe(true);
    expect(validatePromptDocument({ ...valid, extra: true })).toBe(false);
    expect(
      validatePromptDocument({ schemaVersion: '1', content: [{ id: 42, text: 'hello' }] }),
    ).toBe(false);
  });
  it('enforces sha256 digests and patch preconditions', () => {
    const digest = `sha256:${'a'.repeat(64)}`;
    expect(
      validatePromptDocument({
        schemaVersion: '1',
        content: [{ id: 'input', text: 'x' }],
        context: [{ uri: 'urn:x', digest }],
      }),
    ).toBe(true);
    expect(
      validatePromptDocument({
        schemaVersion: '1',
        content: [{ id: 'input', text: 'x' }],
        context: [{ uri: 'urn:x', digest: 'bad' }],
      }),
    ).toBe(false);
    expect(
      validatePatch({
        schemaVersion: '1',
        id: 'p',
        baseRevision: 0,
        operations: [{ type: 'remove-content-block', blockId: 'input', expectedDigest: digest }],
      }),
    ).toBe(true);
    expect(
      validatePatch({
        schemaVersion: '1',
        id: 'p',
        baseRevision: 0,
        operations: [{ type: 'remove-content-block', blockId: 'input' }],
      }),
    ).toBe(false);
  });
  it('validates rich Prompt Documents without confusing context and input', () => {
    const document = {
      schemaVersion: '1',
      content: [{ id: 'input', text: 'keep TOKEN' }],
      context: [
        { id: 'context', text: 'host supplied' },
        {
          uri: 'file:///tmp/reference.txt',
          mediaType: 'text/plain',
          digest: `sha256:${'a'.repeat(64)}`,
        },
      ],
      constraints: [{ id: 'host/intent', kind: 'promptiris/semantic', value: { retain: true } }],
      protections: [
        {
          id: 'host/token',
          selector: {
            blockId: 'input',
            revision: 0,
            range: { unit: 'unicode-scalar', start: 5, end: 10 },
            quote: { exact: 'TOKEN' },
          },
        },
      ],
      extensions: { 'host/metadata': { source: 'test', ordinal: 1 } },
    } as const;

    expect(validatePromptDocument(document)).toBe(true);
    expect(isPromptDocument(document)).toBe(true);
  });
  it('rejects malformed rich Prompt Document members', () => {
    const base = makeTextDocument('input');

    expect(validatePromptDocument({ ...base, extensions: { unowned: true } })).toBe(false);
    expect(validatePromptDocument({ ...base, extensions: { 'host/value': undefined } })).toBe(
      false,
    );
    expect(
      validatePromptDocument({
        ...base,
        protections: [
          {
            id: 'host/value',
            selector: {
              blockId: 'input-1',
              revision: 0,
              range: { unit: 'unicode-scalar', start: 0, end: 1, extra: true },
              quote: { exact: 'i' },
            },
          },
        ],
      }),
    ).toBe(false);
  });
  it('validates the complete typed Patch union', () => {
    const digest = `sha256:${'b'.repeat(64)}`;
    const patch = {
      schemaVersion: '1',
      id: 'patch-1',
      baseRevision: 0,
      operations: [
        {
          type: 'replace-text',
          selector: {
            blockId: 'input',
            revision: 0,
            range: { unit: 'unicode-scalar', start: 0, end: 1 },
            quote: { exact: 'a' },
          },
          text: 'A',
        },
        { type: 'insert-content-block', block: { id: 'second', text: 'second' } },
        {
          type: 'replace-content-block',
          blockId: 'second',
          expectedDigest: digest,
          block: { id: 'second', text: 'replacement' },
        },
        { type: 'remove-content-block', blockId: 'second', expectedDigest: digest },
        { type: 'set-namespaced-extension', key: 'example/plugin/state', value: [1, true] },
      ],
    } as const;

    expect(validatePatch(patch)).toBe(true);
  });
  it('recognizes portable JSON values without accepting JavaScript-only values', () => {
    expect(validateJsonValue({ nested: [null, true, 1, 'text'] })).toBe(true);
    expect(validateJsonValue(undefined)).toBe(false);
    expect(validateJsonValue(() => undefined)).toBe(false);
    expect(validateJsonValue(Number.POSITIVE_INFINITY)).toBe(false);
  });
  it.each([
    ['unknown operation', { type: 'execute-code' }],
    ['shallow selector', { type: 'replace-text', selector: {}, text: 'x' }],
    [
      'nested selector extension',
      {
        type: 'replace-text',
        selector: {
          blockId: 'input',
          revision: 0,
          range: { unit: 'unicode-scalar', start: 0, end: 1, fuzzy: true },
          quote: { exact: 'a' },
        },
        text: 'x',
      },
    ],
    ['missing digest', { type: 'remove-content-block', blockId: 'input' }],
    [
      'invalid extension namespace',
      { type: 'set-namespaced-extension', key: 'unowned', value: true },
    ],
  ])('rejects a Patch with %s', (_label, operation) => {
    expect(
      validatePatch({
        schemaVersion: '1',
        id: 'patch-1',
        baseRevision: 0,
        operations: [operation],
      }),
    ).toBe(false);
  });
  it.each([
    [null, false],
    ['text', false],
    [{ schemaVersion: '2', content: [] }, false],
    [{ schemaVersion: '1', content: 'text' }, false],
    [{ schemaVersion: '1', content: [null] }, false],
    [{ schemaVersion: '1', content: [{ id: 1, text: '' }] }, false],
    [{ schemaVersion: '1', content: [{ id: 'input', text: 1 }] }, false],
    [makeTextDocument('valid'), true],
  ])('recognizes Prompt Document shape %#', (candidate, expected) => {
    expect(isPromptDocument(candidate)).toBe(expected);
  });
  it('rejects duplicate content lengths', () => {
    const decoder = new ContentLengthDecoder();
    expect(() =>
      decoder.push(Buffer.from('Content-Length: 2\r\nContent-Length: 2\r\n\r\n{}')),
    ).toThrow('invalid Content-Length header');
  });
  it('rejects oversized frames before reading their body', () => {
    const decoder = new ContentLengthDecoder();
    expect(() =>
      decoder.push(Buffer.from(`Content-Length: ${String(MAX_FRAME_BYTES + 1)}\r\n\r\n`)),
    ).toThrow('JSON-RPC frame exceeds maximum size');
  });
  it('rejects oversized encoded messages', () => {
    const huge = 'x'.repeat(MAX_FRAME_BYTES);
    expect(() =>
      encodeMessage({ jsonrpc: '2.0', id: 1, method: 'oversized', params: huge }),
    ).toThrow('JSON-RPC frame exceeds maximum size');
  });
  it('accepts an encoded message exactly at the frame limit', () => {
    const empty = JSON.stringify({ jsonrpc: '2.0', id: 1, result: '' });
    const value = 'x'.repeat(MAX_FRAME_BYTES - Buffer.byteLength(empty));
    expect(
      encodeMessage({ jsonrpc: '2.0', id: 1, result: value }).subarray(0, 40).toString('ascii'),
    ).toContain(String(MAX_FRAME_BYTES));
  });
  it('rejects frames without exactly one valid length', () => {
    expect(() => new ContentLengthDecoder().push(Buffer.from('X-Test: 2\r\n\r\n{}'))).toThrow(
      'invalid Content-Length header',
    );
    expect(() =>
      new ContentLengthDecoder().push(Buffer.from('Content-Length: nope\r\n\r\n{}')),
    ).toThrow('invalid Content-Length header');
    expect(() => new ContentLengthDecoder().push(Buffer.from('\r\n\r\n'))).toThrow(
      'invalid Content-Length header',
    );
  });
  it('parses only exact Content-Length header names and values', () => {
    const decoder = new ContentLengthDecoder();
    expect(
      decoder.push(
        Buffer.from('X-Content-Length: 2\r\nContent-Length:2\r\nContent-Length-Junk: 2\r\n\r\n{}'),
      ),
    ).toEqual([{}]);
    expect(
      new ContentLengthDecoder().push(
        Buffer.from('Content-Length: 2junk\r\nContent-Length: 2\r\n\r\n{}'),
      ),
    ).toEqual([{}]);
  });
  it('accepts an incomplete frame whose declared body is exactly the limit', () => {
    expect(
      new ContentLengthDecoder().push(
        Buffer.from(`Content-Length: ${String(MAX_FRAME_BYTES)}\r\n\r\n`),
      ),
    ).toEqual([]);
  });
  it('buffers incomplete bodies and decodes consecutive frames', () => {
    const first = encodeMessage({ jsonrpc: '2.0', id: 1, result: 'first' });
    const second = encodeMessage({ jsonrpc: '2.0', id: 2, result: 'second' });
    const decoder = new ContentLengthDecoder();
    expect(decoder.push(first.subarray(0, first.length - 1))).toEqual([]);
    expect(decoder.push(Buffer.concat([first.subarray(first.length - 1), second]))).toEqual([
      { jsonrpc: '2.0', id: 1, result: 'first' },
      { jsonrpc: '2.0', id: 2, result: 'second' },
    ]);
  });
  it('surfaces malformed JSON bodies', () => {
    expect(() =>
      new ContentLengthDecoder().push(Buffer.from('Content-Length: 1\r\n\r\n{')),
    ).toThrow();
  });
  it('requires every block in a Prompt Document to be valid', () => {
    expect(
      isPromptDocument({
        schemaVersion: '1',
        content: [
          { id: 'valid', text: 'valid' },
          { id: 'invalid', text: 1 },
        ],
      }),
    ).toBe(false);
  });
  it('round trips arbitrary Unicode payloads across arbitrary chunk boundaries', () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 1, max: 32 }), (text, chunkSize) => {
        const message = { jsonrpc: '2.0' as const, id: 1, method: 'echo', params: { text } };
        const frame = encodeMessage(message);
        const decoder = new ContentLengthDecoder();
        const decoded = [];
        for (let offset = 0; offset < frame.length; offset += chunkSize) {
          decoded.push(...decoder.push(frame.subarray(offset, offset + chunkSize)));
        }
        expect(decoded).toEqual([message]);
      }),
      { seed: 20260826, numRuns: 200 },
    );
  });
});

describe('Provider schema validation', () => {
  it('validates a complete ProviderConfig', () => {
    expect(
      validateProviderConfig({
        id: 'promptiris/test-provider',
        binding: {
          modelId: 'model-1',
          providerId: 'promptiris/test-provider',
          fingerprint: 'fp-001',
        },
        capabilities: { supported: ['text-generation'], unsupported: [] },
      }),
    ).toBe(true);
  });

  it('rejects ProviderConfig with missing binding', () => {
    expect(
      validateProviderConfig({
        id: 'promptiris/test-provider',
        capabilities: { supported: [], unsupported: [] },
      }),
    ).toBe(false);
  });

  it('rejects ProviderConfig with invalid capability', () => {
    expect(
      validateProviderConfig({
        id: 'promptiris/test-provider',
        binding: { modelId: 'm', providerId: 'promptiris/test-provider', fingerprint: 'f' },
        capabilities: { supported: ['magic-wand'], unsupported: [] },
      }),
    ).toBe(false);
  });

  it('validates a complete GenerateResult', () => {
    expect(
      validateGenerateResult({
        content: 'hello',
        model: 'test-model',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: 'stop',
      }),
    ).toBe(true);
  });

  it('rejects GenerateResult with invalid finishReason', () => {
    expect(
      validateGenerateResult({
        content: 'hello',
        model: 'test-model',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: 'timeout',
      }),
    ).toBe(false);
  });

  it('validates a complete ProviderError', () => {
    expect(
      validateProviderError({ kind: 'network', message: 'connection lost', retryable: true }),
    ).toBe(true);
  });

  it('rejects ProviderError with invalid kind', () => {
    expect(
      validateProviderError({ kind: 'quota-exceeded', message: 'limit', retryable: false }),
    ).toBe(false);
  });

  it('rejects non-objects for all validators', () => {
    expect(validateProviderConfig(null)).toBe(false);
    expect(validateGenerateResult(undefined)).toBe(false);
    expect(validateProviderError('error')).toBe(false);
  });

  it('accepts GenerateResult with diagnostics', () => {
    expect(
      validateGenerateResult({
        content: 'hello',
        model: 'test-model',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: 'stop',
        diagnostics: [
          {
            schemaVersion: '1',
            id: 'd1',
            code: 'W001',
            category: 'quality',
            severity: 'warning',
            title: 'low quality',
          },
        ],
      }),
    ).toBe(true);
  });

  it('accepts ProviderError with cause', () => {
    expect(
      validateProviderError({
        kind: 'network',
        message: 'connection lost',
        retryable: true,
        cause: { code: 'ECONNREFUSED' },
      }),
    ).toBe(true);
  });

  it('validates a complete CapabilityEvidence', () => {
    expect(
      validateCapabilityEvidence({
        evidenceId: 'ev-1',
        capability: 'provider/text-generation',
        bindingFingerprint: 'sha256:abc123',
        state: 'supported',
        source: { kind: 'observation', id: 'obs-1' },
      }),
    ).toBe(true);
  });

  it('rejects CapabilityEvidence with invalid state', () => {
    expect(
      validateCapabilityEvidence({
        evidenceId: 'ev-1',
        capability: 'provider/text-generation',
        bindingFingerprint: 'sha256:abc123',
        state: 'enabled',
        source: { kind: 'observation', id: 'obs-1' },
      }),
    ).toBe(false);
  });

  it('rejects CapabilityEvidence with missing source', () => {
    expect(
      validateCapabilityEvidence({
        evidenceId: 'ev-1',
        capability: 'provider/text-generation',
        bindingFingerprint: 'sha256:abc123',
        state: 'supported',
      }),
    ).toBe(false);
  });

  it('validates a complete GenerateParams', () => {
    expect(
      validateGenerateParams({
        config: {
          id: 'promptiris/test',
          binding: { modelId: 'm', providerId: 'promptiris/test', fingerprint: 'f' },
          capabilities: { supported: ['text-generation'], unsupported: [] },
        },
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).toBe(true);
  });

  it('rejects GenerateParams with empty messages', () => {
    expect(
      validateGenerateParams({
        config: {
          id: 'promptiris/test',
          binding: { modelId: 'm', providerId: 'promptiris/test', fingerprint: 'f' },
          capabilities: { supported: ['text-generation'], unsupported: [] },
        },
        messages: [],
      }),
    ).toBe(false);
  });

  it('rejects GenerateParams with invalid message role', () => {
    expect(
      validateGenerateParams({
        config: {
          id: 'promptiris/test',
          binding: { modelId: 'm', providerId: 'promptiris/test', fingerprint: 'f' },
          capabilities: { supported: ['text-generation'], unsupported: [] },
        },
        messages: [{ role: 'tool', content: 'hi' }],
      }),
    ).toBe(false);
  });

  it('rejects GenerateParams with missing config', () => {
    expect(
      validateGenerateParams({
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).toBe(false);
  });

  it('rejects GenerateParams with invalid temperature', () => {
    expect(
      validateGenerateParams({
        config: {
          id: 'promptiris/test',
          binding: { modelId: 'm', providerId: 'promptiris/test', fingerprint: 'f' },
          capabilities: { supported: ['text-generation'], unsupported: [] },
        },
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 5,
      }),
    ).toBe(false);
  });

  it('rejects CapabilityEvidence and GenerateParams for non-objects', () => {
    expect(validateCapabilityEvidence(null)).toBe(false);
    expect(validateCapabilityEvidence(undefined)).toBe(false);
    expect(validateGenerateParams(null)).toBe(false);
    expect(validateGenerateParams('bad')).toBe(false);
  });
});
