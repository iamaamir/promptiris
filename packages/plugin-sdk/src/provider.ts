import type {
  ProviderConfiguration,
  ProviderFailure,
  ProviderGenerateRequest,
  ProviderGenerateResult,
} from '@promptiris/protocol';
import {
  validateProviderFailure,
  validateProviderGenerateRequest,
  validateProviderGenerateResult,
} from '@promptiris/protocol';

export type {
  GenerateMessage,
  ModelBinding,
  ProviderConfiguration,
  ProviderErrorKind,
  ProviderFailure,
  ProviderGenerateRequest,
  ProviderGenerateResult,
  ProviderUsage,
} from '@promptiris/protocol';

/** Runtime-only controls. They are deliberately excluded from portable JSON schemas. @public */
export interface ProviderExecutionContext {
  readonly signal?: AbortSignal;
}

/** The portable, non-streaming Provider baseline. @public */
export interface Provider {
  readonly configuration: ProviderConfiguration;
  generate(
    request: ProviderGenerateRequest,
    context?: ProviderExecutionContext,
  ): Promise<ProviderGenerateResult>;
  close?(): Promise<void> | void;
}

/** @public */
export type FakeProviderResponse =
  | { readonly kind: 'success'; readonly value: unknown }
  | { readonly kind: 'failure'; readonly value: unknown };

/** Deterministic, request-addressed responses for Provider conformance tests. @public */
export interface FakeProviderScenario {
  readonly requestId: string;
  readonly responses: readonly FakeProviderResponse[];
}

/** A normalized Provider failure that preserves portable failure data. @public */
export class ProviderFailureError extends Error {
  readonly failure: ProviderFailure;
  constructor(failure: ProviderFailure) {
    super(failure.message);
    this.name = 'ProviderFailureError';
    this.failure = failure;
  }
}

const providerFailure = (kind: ProviderFailure['kind'], message: string): ProviderFailure => ({
  schemaVersion: '1',
  kind,
  message,
  retryable: false,
  diagnostics: [],
});

/** Deterministic, in-memory Provider used by provider and Host conformance tests. @public */
export class FakeProvider implements Provider {
  readonly configuration: ProviderConfiguration;
  readonly #scenarios: ReadonlyMap<string, readonly FakeProviderResponse[]>;
  readonly #cursors = new Map<string, number>();
  #closed = false;
  constructor(configuration: ProviderConfiguration, scenarios: readonly FakeProviderScenario[]) {
    this.configuration = configuration;
    this.#scenarios = new Map(
      scenarios.map((scenario) => [scenario.requestId, scenario.responses]),
    );
  }
  async generate(
    request: ProviderGenerateRequest,
    context: ProviderExecutionContext = {},
  ): Promise<ProviderGenerateResult> {
    if (this.#closed)
      throw new ProviderFailureError(providerFailure('unknown', 'provider is closed'));
    if (!validateProviderGenerateRequest(request))
      throw new ProviderFailureError(
        providerFailure('malformed-output', 'invalid provider request'),
      );
    this.#assertCapabilities(request);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (context.signal?.aborted)
      throw new ProviderFailureError(providerFailure('cancelled', 'generation cancelled'));
    return this.#consumeResponse(request);
  }
  #consumeResponse(request: ProviderGenerateRequest): ProviderGenerateResult {
    const response = this.#nextResponse(request.id);
    if (response.kind === 'failure') {
      if (!validateProviderFailure(response.value))
        throw new ProviderFailureError(
          providerFailure('malformed-output', 'invalid provider failure'),
        );
      throw new ProviderFailureError(response.value);
    }
    if (!validateProviderGenerateResult(response.value))
      throw new ProviderFailureError(
        providerFailure('malformed-output', 'invalid provider result'),
      );
    if (response.value.requestId !== request.id)
      throw new ProviderFailureError(
        providerFailure('malformed-output', 'provider result request does not match'),
      );
    if (response.value.bindingFingerprint !== this.configuration.binding.fingerprint)
      throw new ProviderFailureError(
        providerFailure('malformed-output', 'provider result binding does not match'),
      );
    return response.value;
  }
  close(): void {
    this.#closed = true;
  }
  #assertCapabilities(request: ProviderGenerateRequest): void {
    for (const capability of request.requiredCapabilities) {
      const supported = this.configuration.evidence.some(
        (evidence) =>
          evidence.capability === capability &&
          evidence.bindingFingerprint === this.configuration.binding.fingerprint &&
          evidence.state === 'supported',
      );
      if (!supported)
        throw new ProviderFailureError(
          providerFailure('unsupported-capability', `capability is not evidenced: ${capability}`),
        );
    }
  }
  #nextResponse(requestId: string): FakeProviderResponse {
    const responses = this.#scenarios.get(requestId) ?? [];
    const index = this.#cursors.get(requestId) ?? 0;
    const response = responses[index % responses.length];
    if (response === undefined)
      throw new ProviderFailureError(
        providerFailure('unknown', `no scenario for request: ${requestId}`),
      );
    this.#cursors.set(requestId, index + 1);
    return response;
  }
}
